import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { docLibraryRoutes } from "../src/routes/doc-library";
import { docLibraryOpenRoutes } from "../src/routes/doc-library-open";
import { docLibraryWedriveRoutes } from "../src/routes/doc-library-wedrive";
import { runMirrorDrain } from "../src/services/wedrive/mirror-run";
import { getWedriveSettings, saveWedriveSetting } from "../src/services/wedrive/settings";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 微盘镜像的接口：看状态、初始化、开关、恢复、对全公司开放、重试。微盘那一头是假的。

const authState = vi.hoisted(() => ({
  sub: "boss",
  roles: ["manager"],
  authMethod: "wecom_oauth"
}));
const bridge = vi.hoisted(() => ({ call: async () => ({ errcode: 0 }) }));

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

vi.mock("../src/services/wecom-api", async (original) => ({
  ...(await original()),
  fetchWeComAccessToken: async () => "token-1"
}));

// 路由用的是真的客户端和真的 bridge 调用方，只把「发到 bridge」这一步换成假微盘
vi.mock("../src/services/wecom-approval-push", async (original) => ({
  ...(await original()),
  fetchViaBridgeStrict: async (_env, url, options) =>
    bridge.call(new URL(url).pathname.split("/").pop(), options.body)
}));

describe.skipIf(!hasSqlite)("微盘镜像接口", () => {
  let h;
  let fake;

  const as = (sub, roles, authMethod = "wecom_oauth") => {
    authState.sub = sub;
    authState.roles = roles;
    authState.authMethod = authMethod;
  };
  const request = async (method, path, payload) => {
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryOpenRoutes);
    app.route("/api/v1/doc-library", docLibraryWedriveRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    const response = await app.request(
      `https://api.test/api/v1/doc-library${path}`,
      {
        method,
        headers: {
          authorization: "Bearer test-token",
          ...(payload === undefined ? {} : { "content-type": "application/json" })
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      },
      h.env
    );
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, data: body.data, message: body.error?.message };
  };
  const status = async () => (await request("GET", "/wedrive/status")).data;
  /** 模拟队列消费者跑一趟 */
  const drain = () => runMirrorDrain(h.env, { notify: async () => {} });
  const row = (id) => h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
  const setRow = (id, patch) => {
    const keys = Object.keys(patch);
    h.database
      .prepare(`UPDATE doc_file SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((key) => patch[key]), id);
  };
  const mirrorMessages = () => h.queued.filter((event) => event.type === "WAREHOUSE_DOC_MIRROR");
  const setup = async () => {
    const res = await request("POST", "/wedrive/setup");
    expect(res.status).toBe(200);
    return res.data;
  };

  beforeEach(() => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    bridge.call = fake.call;
    h.seed.member("li", "keeper");
    h.seed.member("wang", "doc_admin");
    as("boss", ["manager"]);
  });

  it("没初始化时的状态：initialized false，各数字是 0，待镜像的是全部最新资料的份数", async () => {
    const old = h.seed.docFile({});
    h.seed.docFile({ supersedes_id: old });
    h.seed.docFile({});
    h.seed.docFile({ deleted_at: "2026-11-12T00:00:00.000Z" });
    expect(await status()).toEqual({
      initialized: false,
      enabled: false,
      space_open: false,
      paused_reason: null,
      counts: { pending: 2, syncing: 0, synced: 0, failed: 0, skipped: 0 },
      calls_this_month: 0,
      monthly_budget: 900,
      mirror_max_mb: 100
    });
  });

  it("初始化：建了一个没有成员的空间「设备资料库」，镜像打开，开始排空", async () => {
    const ids = [h.seed.docFile({}), h.seed.docFile({})];
    const data = await setup();
    expect(fake.calls[0]).toMatchObject({
      api: "space_create",
      body: { space_name: "设备资料库" }
    });
    expect([...fake.spaces.values()][0].members).toEqual([]);
    expect(data).toMatchObject({ initialized: true, enabled: true, space_open: false });
    expect(mirrorMessages()).toHaveLength(1);
    expect(await drain()).toMatchObject({ processed: 2, stopped: "done" });
    expect(ids.map((id) => row(id).mirror_status)).toEqual(["synced", "synced"]);
    const after = await status();
    expect(after.counts).toEqual({ pending: 0, syncing: 0, synced: 2, failed: 0, skipped: 0 });
    // 建空间 1 + 建目录 1 + 直传 2
    expect(after.calls_this_month).toBe(4);
  });

  it("再初始化一次：409", async () => {
    await setup();
    const again = await request("POST", "/wedrive/setup");
    expect(again.status).toBe(409);
    expect(again.message).toBe("微盘空间已经建过了");
    expect(fake.callsTo("space_create")).toHaveLength(1);
  });

  it("企微不让建（48002）：502，带上错误码，没记下空间 ID", async () => {
    fake.failNext("space_create", 48002);
    const res = await request("POST", "/wedrive/setup");
    expect(res.status).toBe(502);
    expect(res.message).toContain("48002");
    expect(await getWedriveSettings(h.env)).toMatchObject({ space_id: null, enabled: false });
    expect(mirrorMessages()).toHaveLength(0);
  });

  it("建空间时连不上企微（超时）：502，说清楚是连不上，没记下空间 ID", async () => {
    fake.failNext("space_create", "timeout");
    const res = await request("POST", "/wedrive/setup");
    expect(res.status).toBe(502);
    expect(res.message).toBe("连不上企业微信的微盘接口：bridge proxy timeout");
    expect((await getWedriveSettings(h.env)).space_id).toBeNull();
  });

  it("关掉镜像后上传资料：不发微盘请求；再打开：补上", async () => {
    await setup();
    expect((await request("PUT", "/wedrive/settings", { enabled: false })).data.enabled).toBe(
      false
    );
    const id = h.seed.docFile({});
    const before = fake.calls.length;
    expect(await drain()).toMatchObject({ processed: 0, stopped: "inactive" });
    expect(fake.calls.length).toBe(before);
    const messages = mirrorMessages().length;
    const on = await request("PUT", "/wedrive/settings", { enabled: true });
    expect(on.status).toBe(200);
    expect(on.data.enabled).toBe(true);
    expect(mirrorMessages()).toHaveLength(messages + 1);
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(row(id).mirror_status).toBe("synced");
  });

  it("暂停后 resume：清掉原因，接着做", async () => {
    await setup();
    const id = h.seed.docFile({});
    await saveWedriveSetting(h.env, { paused_reason: "本月微盘接口调用次数已经用到预算" }, "x");
    expect((await status()).paused_reason).toContain("调用次数");
    expect(await drain()).toMatchObject({ stopped: "paused" });
    const messages = mirrorMessages().length;
    const res = await request("PUT", "/wedrive/settings", { resume: true });
    expect(res.status).toBe(200);
    expect(res.data.paused_reason).toBeNull();
    expect(mirrorMessages()).toHaveLength(messages + 1);
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(row(id).mirror_status).toBe("synced");
  });

  it("改设置：内容不对 400；还没初始化 409", async () => {
    expect((await request("PUT", "/wedrive/settings", { enabled: true })).status).toBe(409);
    await setup();
    for (const bad of [{}, { enabled: "yes" }, { resume: false }, { enabled: 1 }]) {
      expect((await request("PUT", "/wedrive/settings", bad)).status).toBe(400);
    }
    expect((await getWedriveSettings(h.env)).enabled).toBe(true);
  });

  it("对全公司开放：调了 space_acl_add（根部门、只能下载）；还有没镜像完的时 409", async () => {
    expect((await request("POST", "/wedrive/open")).status).toBe(409);
    h.seed.docFile({});
    h.seed.docFile({});
    await setup();
    const early = await request("POST", "/wedrive/open");
    expect(early.status).toBe(409);
    expect(early.message).toBe("还有 2 份资料没镜像完，等它们完成再开放");
    expect(fake.callsTo("space_acl_add")).toHaveLength(0);
    await drain();
    const opened = await request("POST", "/wedrive/open");
    expect(opened.status).toBe(200);
    expect(opened.data.space_open).toBe(true);
    expect([...fake.spaces.values()][0].members).toEqual([{ type: 2, departmentid: 1, auth: 1 }]);
    const again = await request("POST", "/wedrive/open");
    expect(again.status).toBe(409);
    expect(fake.callsTo("space_acl_add")).toHaveLength(1);
  });

  it("开放时企微报错：502，没记成已开放", async () => {
    await setup();
    fake.failNext("space_acl_add", 640027);
    const res = await request("POST", "/wedrive/open");
    expect(res.status).toBe(502);
    expect(res.message).toContain("640027");
    expect((await getWedriveSettings(h.env)).space_open).toBe(false);
  });

  it("开放时连不上企微（超时）：502，没记成已开放", async () => {
    await setup();
    fake.failNext("space_acl_add", "timeout");
    const res = await request("POST", "/wedrive/open");
    expect(res.status).toBe(502);
    expect(res.message).toContain("连不上企业微信的微盘接口");
    expect((await getWedriveSettings(h.env)).space_open).toBe(false);
  });

  it("开放之后新传的资料走分块上传，不给成员推卡片", async () => {
    await setup();
    await request("POST", "/wedrive/open");
    h.seed.docFile({});
    await drain();
    expect(fake.callsTo("file_upload")).toHaveLength(0);
    expect(fake.callsTo("file_upload_init")).toHaveLength(1);
    expect(fake.cards).toEqual([]);
  });

  it("重新同步一份；全部重试失败的", async () => {
    await setup();
    const [a, b, c] = [h.seed.docFile({}), h.seed.docFile({}), h.seed.docFile({})];
    setRow(a, { mirror_status: "synced", mirror_attempts: 1 });
    setRow(b, { mirror_status: "failed", mirror_attempts: 5, mirror_error: "超时" });
    setRow(c, { mirror_status: "failed", mirror_attempts: 2, mirror_error: "超时" });
    const messages = mirrorMessages().length;
    as("wang", ["operator"]);
    expect((await request("POST", `/file/${a}/remirror`)).status).toBe(200);
    expect(row(a)).toMatchObject({ mirror_status: "pending", mirror_attempts: 0 });
    expect(mirrorMessages()).toHaveLength(messages + 1);
    expect((await request("POST", "/file/99999/remirror")).status).toBe(404);

    as("boss", ["manager"]);
    const retried = await request("POST", "/wedrive/retry-failed");
    expect(retried.status).toBe(200);
    expect(retried.data.requeued).toBe(2);
    for (const id of [b, c]) {
      expect(row(id)).toMatchObject({
        mirror_status: "pending",
        mirror_attempts: 0,
        mirror_error: null
      });
    }
    expect(mirrorMessages()).toHaveLength(messages + 2);
    expect((await request("POST", "/wedrive/retry-failed")).data.requeued).toBe(0);
  });

  it("已删除的资料不能重新同步：404", async () => {
    await setup();
    const id = h.seed.docFile({ deleted_at: "2026-11-12T00:00:00.000Z" });
    as("wang", ["operator"]);
    expect((await request("POST", `/file/${id}/remirror`)).status).toBe(404);
  });

  it("权限：操作员都是 403；资料管理员能看状态、能重新同步一份，不能初始化、开关、开放；智能体身份 403", async () => {
    await setup();
    const id = h.seed.docFile({});
    const managerOnly = [
      ["POST", "/wedrive/setup"],
      ["PUT", "/wedrive/settings", { enabled: false }],
      ["POST", "/wedrive/open"],
      ["POST", "/wedrive/retry-failed"]
    ];
    const everything = [
      ...managerOnly,
      ["GET", "/wedrive/status"],
      ["POST", `/file/${id}/remirror`]
    ];
    const statusOf = async ([method, path, payload]) =>
      (await request(method, path, payload)).status;

    as("zhang", ["operator"]);
    for (const call of everything) expect(await statusOf(call)).toBe(403);
    as("zhang", ["site_manager"]);
    for (const call of everything) expect(await statusOf(call)).toBe(403);

    for (const sub of ["wang", "li"]) {
      as(sub, ["operator"]);
      expect(await statusOf(["GET", "/wedrive/status"])).toBe(200);
      expect(await statusOf(["POST", `/file/${id}/remirror`])).toBe(200);
      for (const call of managerOnly) expect(await statusOf(call)).toBe(403);
    }

    // 经理不是资料管理员：能管开关，不能点单份的重新同步
    as("boss", ["manager"]);
    expect(await statusOf(["GET", "/wedrive/status"])).toBe(200);
    expect(await statusOf(["POST", `/file/${id}/remirror`])).toBe(403);

    as("bot", ["super_admin"], "mcp_agent");
    for (const call of everything) expect(await statusOf(call)).toBe(403);
    // 上面这些 403 一个都没改到东西
    expect(await getWedriveSettings(h.env)).toMatchObject({ enabled: true, space_open: false });
  });

  it("资料列表和详情的行里有镜像状态", async () => {
    const id = h.seed.docFile({});
    setRow(id, { mirror_status: "failed", mirror_error: "超时" });
    as("zhang", ["operator"]);
    const list = await request("GET", "/file");
    expect(list.data[0]).toMatchObject({ mirror_status: "failed", mirror_error: "超时" });
    const detail = await request("GET", `/file/${id}`);
    expect(detail.data).toMatchObject({ mirror_status: "failed", mirrored_at: null });
  });

  it("原来的资料接口不受影响：没登录还是 401，登录了照常能看", async () => {
    h.seed.docFile({});
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryWedriveRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    const anonymous = await app.request("https://api.test/api/v1/doc-library/tree", {}, h.env);
    expect(anonymous.status).toBe(401);
    expect((await request("GET", "/tree")).status).toBe(200);
  });
});
