import { beforeEach, describe, expect, it, vi } from "vitest";

import { warehouseLegacyStubRoutes } from "../src/routes/warehouse-legacy-stub";
import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({
  sub: "u1",
  roles: ["super_admin"],
  authMethod: "wecom_oauth"
}));

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

const NONE = {
  is_keeper: false,
  is_doc_admin: false,
  can_scrap: false,
  can_unscrap: false,
  can_manage_settings: false,
  can_create_kit: false
};

describe.skipIf(!hasSqlite)("库房权限和设置", () => {
  let h;
  const as = (sub, roles, authMethod = "wecom_oauth") => {
    authState.sub = sub;
    authState.roles = roles;
    authState.authMethod = authMethod;
  };
  const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);

  beforeEach(() => {
    h = createWarehouseHarness();
    as("u1", ["super_admin"]);
  });

  it.each([
    [
      "super_admin",
      [],
      {
        is_keeper: true,
        is_doc_admin: true,
        can_scrap: true,
        can_unscrap: true,
        can_manage_settings: true,
        can_create_kit: true
      }
    ],
    ["manager", [], { ...NONE, can_scrap: true, can_manage_settings: true, can_create_kit: true }],
    [
      "operator",
      ["keeper"],
      { ...NONE, is_keeper: true, is_doc_admin: true, can_create_kit: true }
    ],
    ["operator", ["doc_admin"], { ...NONE, is_doc_admin: true }],
    ["site_manager", [], { ...NONE, can_create_kit: true }],
    ["finance", [], NONE]
  ])("角色 %s 加成员身份 %j 的能力", async (role, memberships, expected) => {
    for (const membership of memberships) h.seed.member("u2", membership);
    as("u2", [role]);
    const result = await call("GET", "/warehouse/me");
    expect(result).toEqual({ status: 200, body: { success: true, data: expected } });
  });

  it("智能体令牌即使是超管也没有任何能力", async () => {
    as("u1", ["super_admin"], "mcp_agent");
    expect((await call("GET", "/warehouse/me")).body.data).toEqual(NONE);
  });

  it("经理可以加库管，库管自己不能加人", async () => {
    as("boss", ["manager"]);
    expect(
      (await call("POST", "/warehouse/member", { userid: "lizhen", role: "keeper" })).status
    ).toBe(201);
    expect(
      (await call("POST", "/warehouse/member", { userid: "lizhen", role: "keeper" })).status
    ).toBe(200);

    as("lizhen", ["operator"]);
    const denied = await call("POST", "/warehouse/member", { userid: "other", role: "keeper" });
    expect(denied).toEqual({
      status: 403,
      body: { success: false, error: { message: "只有经理或超级管理员可以操作" } }
    });

    const members = await call("GET", "/warehouse/member");
    expect(members.body.data.map((m) => [m.userid, m.role, m.added_by_userid])).toEqual([
      ["lizhen", "keeper", "boss"]
    ]);
  });

  it("移除成员", async () => {
    h.seed.member("lizhen", "keeper");
    as("boss", ["manager"]);
    expect((await call("DELETE", "/warehouse/member/lizhen/keeper")).status).toBe(200);
    expect((await call("GET", "/warehouse/member")).body.data).toEqual([]);
  });

  it("成员角色不对时 400", async () => {
    const result = await call("POST", "/warehouse/member", { userid: "x", role: "admin" });
    expect(result.status).toBe(400);
  });

  it("设置：照片数 10 被拒绝，0 可以；默认检查人可以清空", async () => {
    as("boss", ["manager"]);
    expect(await call("GET", "/warehouse/settings")).toEqual({
      status: 200,
      body: {
        success: true,
        data: {
          default_inspector_userid: null,
          return_inspection_photo_count: 3,
          notify_enabled: false
        }
      }
    });
    const rejected = await call("PUT", "/warehouse/settings", {
      return_inspection_photo_count: 10
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toBe("返库检查照片数必须是 0 到 9 之间的整数");

    const saved = await call("PUT", "/warehouse/settings", {
      default_inspector_userid: "lizhen",
      return_inspection_photo_count: 0
    });
    expect(saved.body.data).toEqual({
      default_inspector_userid: "lizhen",
      return_inspection_photo_count: 0,
      notify_enabled: false
    });

    const cleared = await call("PUT", "/warehouse/settings", { default_inspector_userid: null });
    expect(cleared.body.data).toEqual({
      default_inspector_userid: null,
      return_inspection_photo_count: 0,
      notify_enabled: false
    });
  });

  it("设置：通知开关只收布尔值，能开能关", async () => {
    as("boss", ["manager"]);
    const rejected = await call("PUT", "/warehouse/settings", { notify_enabled: "yes" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toBe("通知开关只能是开或关");

    const on = await call("PUT", "/warehouse/settings", { notify_enabled: true });
    expect(on.body.data.notify_enabled).toBe(true);
    expect((await call("GET", "/warehouse/settings")).body.data.notify_enabled).toBe(true);

    const off = await call("PUT", "/warehouse/settings", { notify_enabled: false });
    expect(off.body.data.notify_enabled).toBe(false);
  });

  it("库管不能改设置", async () => {
    h.seed.member("lizhen", "keeper");
    as("lizhen", ["operator"]);
    expect(
      (await call("PUT", "/warehouse/settings", { return_inspection_photo_count: 2 })).status
    ).toBe(403);
  });

  it("设备类别：库管可以建，重名 409，可以改名和停用，列表按排序", async () => {
    h.seed.member("lizhen", "keeper");
    as("lizhen", ["operator"]);
    const first = await call("POST", "/warehouse/device-category", {
      name: "顶管机",
      sort_order: 2
    });
    expect(first.status).toBe(201);
    await call("POST", "/warehouse/device-category", { name: "发电机", sort_order: 1 });
    expect(await call("POST", "/warehouse/device-category", { name: " 顶管机 " })).toEqual({
      status: 409,
      body: { success: false, error: { message: "类别已存在" } }
    });
    const id = first.body.data.id;
    expect(
      (await call("PUT", `/warehouse/device-category/${id}`, { status: "disabled" })).status
    ).toBe(200);
    const list = await call("GET", "/warehouse/device-category");
    expect(list.body.data.map((c) => [c.name, c.status])).toEqual([
      ["发电机", "active"],
      ["顶管机", "disabled"]
    ]);
  });

  it("操作员不能建类别，财务能看类别", async () => {
    as("op", ["operator"]);
    expect((await call("POST", "/warehouse/device-category", { name: "泵" })).status).toBe(403);
    as("fin", ["finance"]);
    expect((await call("GET", "/warehouse/device-category")).status).toBe(200);
  });

  it("和旧接口占位按 index.ts 的顺序一起挂载时互不影响", async () => {
    const mountLikeIndex = (app) => {
      mountWarehouseRoutes(app);
      app.route("/api/v1/warehouse", warehouseLegacyStubRoutes);
    };
    expect((await callWh(h, mountLikeIndex, "GET", "/warehouse/me")).status).toBe(200);
    expect(await callWh(h, mountLikeIndex, "GET", "/warehouse/stock-order")).toEqual({
      status: 200,
      body: { success: true, data: [] }
    });
    expect((await callWh(h, mountLikeIndex, "POST", "/warehouse/stock-order", {})).status).toBe(
      410
    );
  });

  it("请求体不是 JSON 对象时 400", async () => {
    const result = await call("POST", "/warehouse/device-category", [1, 2]);
    expect(result).toEqual({
      status: 400,
      body: { success: false, error: { message: "请求内容格式不对" } }
    });
  });
});
