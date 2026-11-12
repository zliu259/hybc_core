import { beforeEach, describe, expect, it, vi } from "vitest";

import { warehouseLegacyStubRoutes } from "../src/routes/warehouse-legacy-stub";
import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { getMaterial } from "../src/services/warehouse/material";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 盘点接口：路径、状态码、谁能看谁能改。业务规则在 service 的测试里。

const authState = vi.hoisted(() => ({ sub: "kp", roles: ["operator"], authMethod: "wecom_oauth" }));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: authState.sub,
    username: authState.sub,
    nickname: authState.sub,
    avatar: "",
    roles: authState.roles,
    permissions: [],
    tokenId: `token-${authState.sub}`,
    type: "access",
    auth_method: authState.authMethod,
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("盘点路由", () => {
  let h;
  let cement;

  const as = (sub, roles, authMethod = "wecom_oauth") =>
    Object.assign(authState, { sub, roles, authMethod });
  const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
  /** 和 index.ts 一样的顺序：新路由在前，旧接口占位在后 */
  const mountLikeIndex = (app) => {
    mountWarehouseRoutes(app);
    app.route("/api/v1/warehouse", warehouseLegacyStubRoutes);
  };

  beforeEach(() => {
    h = createWarehouseHarness();
    h.seed.member("kp", "keeper");
    cement = h.seed.material({ name: "水泥", unit: "袋", quantity: 10 });
    h.seed.device({ device_code: "SB-0001" });
    as("kp", ["operator"]);
  });

  it("库管走完一遍：发起、录数、扫设备、完成，返回的东西对得上", async () => {
    const started = await call("POST", "/warehouse/stocktake", { scope: "all" });
    expect(started.status).toBe(201);
    const st = started.body.data;
    expect(st).toMatchObject({ status: "counting", material_total: 1, device_expected: 1 });
    const lineId = st.material_lines[0].id;

    const saved = await call("PUT", `/warehouse/stocktake/${st.id}/material-line/${lineId}`, {
      counted_qty: 8,
      note: "少两袋"
    });
    expect(saved).toMatchObject({
      status: 200,
      body: { success: true, data: { id: lineId, counted_qty: 8, book_qty: 10, diff: -2 } }
    });

    const scanned = await call("POST", `/warehouse/stocktake/${st.id}/device-scan`, {
      device_code: "SB-0001",
      found: true
    });
    expect(scanned).toMatchObject({
      status: 200,
      body: { success: true, data: { unexpected: false, hint: null, line: { found: 1 } } }
    });

    const detail = await call("GET", `/warehouse/stocktake/${st.id}`);
    expect(detail).toMatchObject({
      status: 200,
      body: { data: { version: 3, material_counted: 1, material_diff: 1, device_found: 1 } }
    });

    const completed = await call("POST", `/warehouse/stocktake/${st.id}/complete`, { version: 3 });
    expect(completed.status).toBe(200);
    expect(completed.body.data).toMatchObject({
      replayed: false,
      stocktake: { status: "done", completed_by_userid: "kp" }
    });
    expect(completed.body.data.adjust_doc.doc_no).toMatch(/^KFD-/);
    expect((await getMaterial(h.env, cement)).quantity).toBe(8);

    // 完成之后只读
    const late = await call("PUT", `/warehouse/stocktake/${st.id}/material-line/${lineId}`, {
      counted_qty: 9
    });
    expect(late).toMatchObject({
      status: 409,
      body: { success: false, error: { message: "这次盘点已经结束，不能再改" } }
    });
  });

  it("取消：返回已取消的盘点", async () => {
    const st = (await call("POST", "/warehouse/stocktake", { scope: "material" })).body.data;
    const cancelled = await call("POST", `/warehouse/stocktake/${st.id}/cancel`, { reason: "点错了" });
    expect(cancelled).toMatchObject({
      status: 200,
      body: { success: true, data: { status: "cancelled", cancel_reason: "点错了" } }
    });
  });

  it("已有进行中的盘点时再发起：409，带单号", async () => {
    const st = (await call("POST", "/warehouse/stocktake", { scope: "material" })).body.data;
    expect(await call("POST", "/warehouse/stocktake", { scope: "all" })).toEqual({
      status: 409,
      body: {
        success: false,
        error: { message: `已有进行中的盘点 ${st.stocktake_no}，先完成或取消它` }
      }
    });
  });

  it("GET /warehouse/stocktake 由新路由回答，不是旧占位的空数组", async () => {
    await call("POST", "/warehouse/stocktake", { scope: "material" });
    const res = await callWh(h, mountLikeIndex, "GET", "/warehouse/stocktake");
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ status: "counting", material_total: 1 });
    const filtered = await callWh(h, mountLikeIndex, "GET", "/warehouse/stocktake?status=done");
    expect(filtered.body).toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it("操作员能看列表和详情，不能发起、录数、完成、取消", async () => {
    const st = (await call("POST", "/warehouse/stocktake", { scope: "all" })).body.data;
    as("op", ["operator"]);
    expect((await call("GET", "/warehouse/stocktake")).status).toBe(200);
    const detail = await call("GET", `/warehouse/stocktake/${st.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.material_lines).toHaveLength(1);
    const forbidden = { success: false, error: { message: "只有库管可以操作" } };
    expect(await call("POST", "/warehouse/stocktake", { scope: "all" })).toEqual({
      status: 403,
      body: forbidden
    });
    for (const [method, path] of [
      ["PUT", `/warehouse/stocktake/${st.id}/material-line/${st.material_lines[0].id}`],
      ["POST", `/warehouse/stocktake/${st.id}/device-scan`],
      ["POST", `/warehouse/stocktake/${st.id}/complete`],
      ["POST", `/warehouse/stocktake/${st.id}/cancel`]
    ]) {
      expect((await call(method, path, {})).status).toBe(403);
    }
  });

  // 智能体令牌的读由 authMiddleware 里的只读白名单拦（agent-readonly.test.ts 钉住盘点路径不在白名单里）；
  // 这里的假身份不经过那道闸，只能验证写接口自己的 requireHuman。
  it("智能体身份即使是超管也不能发起盘点", async () => {
    as("kp", ["super_admin"], "mcp_agent");
    expect(await call("POST", "/warehouse/stocktake", { scope: "all" })).toEqual({
      status: 403,
      body: { success: false, error: { message: "智能体不能执行库房写操作" } }
    });
  });

  it("不是数字的 id、不存在的盘点：404；请求体不是对象：400", async () => {
    expect(await call("GET", "/warehouse/stocktake/abc")).toEqual({
      status: 404,
      body: { success: false, error: { message: "盘点不存在" } }
    });
    expect(await call("GET", "/warehouse/stocktake/999")).toEqual({
      status: 404,
      body: { success: false, error: { message: "盘点不存在" } }
    });
    expect((await call("POST", "/warehouse/stocktake/abc/complete", { version: 1 })).status).toBe(404);
    expect(await call("POST", "/warehouse/stocktake", [1, 2])).toEqual({
      status: 400,
      body: { success: false, error: { message: "请求内容格式不对" } }
    });
  });

  it("完成的时候和别人的录入撞上：409「数据已变化，请刷新后重试」", async () => {
    const st = (await call("POST", "/warehouse/stocktake", { scope: "material" })).body.data;
    await call("PUT", `/warehouse/stocktake/${st.id}/material-line/${st.material_lines[0].id}`, {
      counted_qty: 8
    });
    let armed = true;
    h.hooks.beforeStatement = (info) => {
      if (!armed || info?.kind !== "batch") return;
      armed = false;
      h.database.prepare("UPDATE stocktake SET version = version + 1 WHERE id = ?").run(st.id);
    };
    const res = await call("POST", `/warehouse/stocktake/${st.id}/complete`, { version: 2 });
    h.hooks.beforeStatement = null;
    expect(res).toEqual({
      status: 409,
      body: { success: false, error: { message: "数据已变化，请刷新后重试" } }
    });
    expect((await getMaterial(h.env, cement)).quantity).toBe(10);
  });

  it("service 抛出的未知错误是 500，不是 401", async () => {
    const st = (await call("POST", "/warehouse/stocktake", { scope: "material" })).body.data;
    h.hooks.beforeStatement = (info) => {
      if (info?.kind === "batch") throw new Error("boom");
    };
    const res = await call("POST", `/warehouse/stocktake/${st.id}/cancel`, {});
    h.hooks.beforeStatement = null;
    expect(res).toEqual({
      status: 500,
      body: { success: false, error: { message: "服务器出错，请稍后重试" } }
    });
  });
});
