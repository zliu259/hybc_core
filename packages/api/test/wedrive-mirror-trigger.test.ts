import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { docLibraryRoutes } from "../src/routes/doc-library";
import { docLibraryOpenRoutes } from "../src/routes/doc-library-open";
import { saveWedriveSetting } from "../src/services/wedrive/settings";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 资料的上传、替换、修改、删除都要触发镜像；触发那一步出任何问题都不能让这些接口失败。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "liu",
    username: "liu",
    nickname: "liu",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-liu",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("资料的写操作会触发镜像", () => {
  let h;

  const request = async (method, path, init = {}) => {
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryOpenRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    const response = await app.request(
      `https://api.test/api/v1/doc-library${path}`,
      { method, ...init },
      h.env
    );
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  };
  const json = (method, path, payload) =>
    request(method, path, {
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  /** 走完一次上传（一片），返回新资料的 id */
  const upload = async (extra = {}) => {
    const init = await json("POST", "/upload/init", { file_name: "合格证.pdf", file_size: 100 });
    const token = init.body.data.upload_token;
    const part = await request("PUT", `/upload/part?token=${encodeURIComponent(token)}&part=1`, {
      body: new Uint8Array(100).fill(7)
    });
    const done = await json("POST", "/upload/complete", {
      upload_token: token,
      parts: [{ part_number: part.body.data.part_number, etag: part.body.data.etag }],
      title: "合格证",
      doc_category: "cert",
      ...extra
    });
    return { status: done.status, id: done.body.data?.id };
  };
  const row = (id) => h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
  const markSynced = (id) =>
    h.database
      .prepare(
        "UPDATE doc_file SET mirror_status = 'synced', mirror_attempts = 2, mirror_error = '旧的' WHERE id = ?"
      )
      .run(id);
  const mirrorMessages = () => h.queued.filter((event) => event.type === "WAREHOUSE_DOC_MIRROR");
  const breakMirrorTrigger = () => {
    h.hooks.beforeStatement = ({ sql }) => {
      if (sql.includes("mirror_status = 'pending'")) throw new Error("D1 掉线");
    };
  };

  beforeEach(async () => {
    h = createWarehouseHarness();
    h.seed.member("liu", "doc_admin");
    await saveWedriveSetting(h.env, { space_id: "s.fake.1", enabled: true }, "test");
  });

  it("上传完成：新资料是 pending，发了消息", async () => {
    const done = await upload();
    expect(done.status).toBe(201);
    expect(row(done.id)).toMatchObject({ mirror_status: "pending", mirror_attempts: 0 });
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("替换：新旧两份都被标成 pending", async () => {
    const old = h.seed.docFile({ title: "合格证" });
    markSynced(old);
    const done = await upload({ supersedes_id: old });
    expect(done.status).toBe(201);
    expect(row(old)).toMatchObject({
      mirror_status: "pending",
      mirror_attempts: 0,
      mirror_error: null
    });
    expect(row(done.id).mirror_status).toBe("pending");
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("改标题：这份被标成 pending", async () => {
    const id = h.seed.docFile({});
    markSynced(id);
    const res = await json("PUT", `/file/${id}`, {
      version: 0,
      title: "新标题",
      doc_category: "manual"
    });
    expect(res.status).toBe(200);
    expect(row(id)).toMatchObject({ mirror_status: "pending", mirror_attempts: 0 });
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("删除：这份被标成 pending（等着从微盘删掉）", async () => {
    const id = h.seed.docFile({});
    markSynced(id);
    expect((await json("DELETE", `/file/${id}`, { version: 0 })).status).toBe(200);
    expect(row(id)).toMatchObject({ mirror_status: "pending", mirror_attempts: 0 });
    expect(row(id).deleted_at).not.toBeNull();
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("镜像没开：接口照常，状态是 pending，不发消息", async () => {
    await saveWedriveSetting(h.env, { enabled: false }, "test");
    const done = await upload();
    expect(done.status).toBe(201);
    expect(row(done.id).mirror_status).toBe("pending");
    expect(mirrorMessages()).toHaveLength(0);
  });

  it("完成请求重发（记录已经在了）：不再触发一次", async () => {
    const init = await json("POST", "/upload/init", { file_name: "a.pdf", file_size: 100 });
    const token = init.body.data.upload_token;
    const part = await request("PUT", `/upload/part?token=${encodeURIComponent(token)}&part=1`, {
      body: new Uint8Array(100)
    });
    const payload = {
      upload_token: token,
      parts: [{ part_number: part.body.data.part_number, etag: part.body.data.etag }],
      title: "合格证",
      doc_category: "cert"
    };
    expect((await json("POST", "/upload/complete", payload)).status).toBe(201);
    expect((await json("POST", "/upload/complete", payload)).status).toBe(200);
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("触发镜像那一步抛错：上传、改、删的接口照常成功", async () => {
    const id = h.seed.docFile({});
    const other = h.seed.docFile({});
    breakMirrorTrigger();
    expect((await upload()).status).toBe(201);
    expect(
      (await json("PUT", `/file/${id}`, { version: 0, title: "新标题", doc_category: "manual" }))
        .status
    ).toBe(200);
    expect((await json("DELETE", `/file/${other}`, { version: 0 })).status).toBe(200);
    expect(row(id).title).toBe("新标题");
    expect(row(other).deleted_at).not.toBeNull();
  });
});
