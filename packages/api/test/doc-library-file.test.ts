import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { docLibraryRoutes } from "../src/routes/doc-library";
import { docLibraryOpenRoutes } from "../src/routes/doc-library-open";
import { uploadRoutes } from "../src/routes/upload";
import { getDocFile, getDocTree, listDocFiles } from "../src/services/doc-library/query";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 改资料信息、删除、取查看地址。

const authState = vi.hoisted(() => ({
  sub: "liu",
  roles: ["operator"],
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

type Harness = ReturnType<typeof createWarehouseHarness>;

describe.skipIf(!hasSqlite)("资料的修改、删除、查看地址", () => {
  let h: Harness;
  let env: Env;

  const as = (sub: string, roles: string[], authMethod = "wecom_oauth") => {
    authState.sub = sub;
    authState.roles = roles;
    authState.authMethod = authMethod;
  };
  const request = async (
    method: string,
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {}
  ) => {
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryOpenRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    app.route("/api/v1/upload", uploadRoutes);
    const response = await app.request(
      `https://api.test/api/v1${path}`,
      {
        method,
        headers: {
          ...(path.startsWith("/upload/object") ? {} : { authorization: "Bearer test-token" }),
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          ...headers
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      },
      h.env
    );
    const raw = await response.text();
    let body: { success?: boolean; data?: Record<string, never>; error?: { message: string } } = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    return { status: response.status, body, raw, headers: response.headers };
  };
  const versionOf = (id: number) =>
    Number(
      (
        h.database.prepare("SELECT version FROM doc_file WHERE id = ?").get(id) as {
          version: number;
        }
      ).version
    );
  const addShare = (docId: number, token: string) =>
    h.database
      .prepare(
        "INSERT INTO doc_share (token, doc_file_id, expires_at, created_by_userid, created_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', 'liu', '2026-11-12T00:00:00.000Z')"
      )
      .run(token, docId);
  const revokedAt = (token: string) =>
    (
      h.database.prepare("SELECT revoked_at FROM doc_share WHERE token = ?").get(token) as {
        revoked_at: string | null;
      }
    ).revoked_at;

  beforeEach(() => {
    h = createWarehouseHarness();
    env = h.env as unknown as Env;
    h.seed.member("liu", "doc_admin");
    as("liu", ["operator"]);
  });

  it("改标题、资料类别、归属、有效期", async () => {
    const device = h.seed.device();
    const id = h.seed.docFile({ title: "旧标题" });
    const res = await request("PUT", `/doc-library/file/${id}`, {
      version: 0,
      title: "合格证",
      doc_category: "cert",
      device_id: device,
      valid_until: "2027-06-30"
    });
    expect(res.status).toBe(200);
    expect(await getDocFile(env, id)).toMatchObject({
      title: "合格证",
      doc_category: "cert",
      device_id: device,
      device_category_id: null,
      valid_until: "2027-06-30",
      version: 1,
      scope: "device"
    });
  });

  it("两个人拿同一个版本先后改：第二个被拦，内容是第一个人的", async () => {
    const id = h.seed.docFile({ title: "原来的" });
    const body = (title: string) => ({ version: 0, title, doc_category: "manual" });
    expect((await request("PUT", `/doc-library/file/${id}`, body("第一个人"))).status).toBe(200);
    const second = await request("PUT", `/doc-library/file/${id}`, body("第二个人"));
    expect(second.status).toBe(409);
    expect(second.body.error!.message).toBe("数据已变化，请刷新后重试");
    expect((await getDocFile(env, id))?.title).toBe("第一个人");
  });

  it("改的时候字段填错、资料不存在、是旧版本都拒绝", async () => {
    const v1 = h.seed.docFile({});
    h.seed.docFile({ supersedes_id: v1 });
    const id = h.seed.docFile({});
    expect(
      (
        await request("PUT", `/doc-library/file/${id}`, {
          version: 0,
          title: "",
          doc_category: "manual"
        })
      ).status
    ).toBe(400);
    expect(
      (await request("PUT", `/doc-library/file/${id}`, { title: "x", doc_category: "manual" }))
        .status
    ).toBe(400);
    expect(
      (
        await request("PUT", "/doc-library/file/99999", {
          version: 0,
          title: "x",
          doc_category: "manual"
        })
      ).status
    ).toBe(404);
    const old = await request("PUT", `/doc-library/file/${v1}`, {
      version: 0,
      title: "x",
      doc_category: "manual"
    });
    expect(old.status).toBe(409);
    expect(old.body.error!.message).toBe("旧版本不能修改");
  });

  it("删除后列表、详情、目录树都没有它，它的对外链接作废；再删一次是不存在", async () => {
    const id = h.seed.docFile({});
    addShare(id, "t1");
    expect((await request("DELETE", `/doc-library/file/${id}`, { version: 0 })).status).toBe(200);
    expect((await listDocFiles(env, { include_history: "1" })).total).toBe(0);
    expect(await getDocFile(env, id)).toBeNull();
    expect((await getDocTree(env)).total).toBe(0);
    expect(revokedAt("t1")).not.toBeNull();
    const row = h.database
      .prepare("SELECT deleted_by_userid FROM doc_file WHERE id = ?")
      .get(id) as {
      deleted_by_userid: string;
    };
    expect(row.deleted_by_userid).toBe("liu");
    // 文件本身还在存储里（只做软删除）
    expect(h.files.objects.size).toBe(1);
    expect((await request("DELETE", `/doc-library/file/${id}`, { version: 1 })).status).toBe(404);
  });

  it("删除新版后旧版重新出现；旧版本身不能删；版本不对被拦", async () => {
    const v1 = h.seed.docFile({ title: "v1" });
    const v2 = h.seed.docFile({ title: "v2", supersedes_id: v1 });
    const old = await request("DELETE", `/doc-library/file/${v1}`, { version: 0 });
    expect(old.status).toBe(409);
    expect(old.body.error!.message).toBe("旧版本不能删除，只能删除最新版");
    expect((await request("DELETE", `/doc-library/file/${v2}`, { version: 5 })).status).toBe(409);
    expect(
      (await request("DELETE", `/doc-library/file/${v2}`, { version: versionOf(v2) })).status
    ).toBe(200);
    expect((await listDocFiles(env, {})).items.map((row) => row.title)).toEqual(["v1"]);
  });

  /** 让「别人的操作」正好落在本次请求写库之前（前面的检查都已经过了）。只插一次。 */
  const justBeforeWrite = (other: () => void) => {
    let armed = true;
    h.hooks.beforeStatement = (info?: { kind: string }) => {
      if (!armed || info?.kind !== "batch") return;
      armed = false;
      other();
    };
  };

  it("删的时候别人正好把它替换了：删不掉，不会出现两个都是最新版", async () => {
    const a = h.seed.docFile({ title: "A" });
    const b = h.seed.docFile({ title: "B", supersedes_id: a });
    justBeforeWrite(() => h.seed.docFile({ title: "C", supersedes_id: b }));
    const res = await request("DELETE", `/doc-library/file/${b}`, { version: 0 });
    h.hooks.beforeStatement = null;
    expect(res.status).toBe(409);
    expect((await listDocFiles(env, {})).items.map((row) => row.title)).toEqual(["C"]);
  });

  it("改的时候别人正好把它替换了：改不了", async () => {
    const a = h.seed.docFile({ title: "A" });
    justBeforeWrite(() => h.seed.docFile({ title: "B", supersedes_id: a }));
    const res = await request("PUT", `/doc-library/file/${a}`, {
      version: 0,
      title: "改过的 A",
      doc_category: "manual"
    });
    h.hooks.beforeStatement = null;
    expect(res.status).toBe(409);
    expect((await getDocFile(env, a))?.title).toBe("A");
  });

  it("取查看地址：拿到的地址能读到文件，15 分钟后失效", async () => {
    const id = h.seed.docFile({ title: "合格证", file_name: "合格证.pdf" });
    const res = await request("GET", `/doc-library/file/${id}/url`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      file_name: "合格证.pdf",
      content_type: "application/pdf",
      file_size: 10,
      inline: true
    });
    const url = new URL(res.body.data!.url as string);
    const file = await request("GET", `${url.pathname.replace("/api/v1", "")}${url.search}`);
    expect(file.status).toBe(200);
    expect(file.raw.length).toBe(10);
    expect(file.headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("合格证.pdf")}`
    );
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    // 这个地址不能用来覆盖文件
    const overwrite = await request("PUT", `${url.pathname.replace("/api/v1", "")}${url.search}`);
    expect(overwrite.status).toBe(401);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000));
    expect(
      (await request("GET", `${url.pathname.replace("/api/v1", "")}${url.search}`)).status
    ).toBe(401);
    vi.useRealTimers();
  });

  it("查看地址加 download=1 就当附件下载（PDF 平时是在页面里打开）", async () => {
    const id = h.seed.docFile({ file_name: "合格证.pdf" });
    const res = await request("GET", `/doc-library/file/${id}/url`);
    const url = new URL(res.body.data!.url as string);
    const path = `${url.pathname.replace("/api/v1", "")}${url.search}`;
    const name = encodeURIComponent("合格证.pdf");
    expect((await request("GET", path)).headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${name}`
    );
    const download = await request("GET", `${path}&download=1`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${name}`
    );
  });

  it("取查看地址：Office 文件当附件下载，带中文文件名；旧版本能取；已删除的取不到", async () => {
    const docx = h.seed.docFile({
      file_name: "说明 书.docx",
      file_key: "doc-library/2026/x-说明 书.docx",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const res = await request("GET", `/doc-library/file/${docx}/url`);
    expect(res.body.data!.inline).toBe(false);
    const url = new URL(res.body.data!.url as string);
    const file = await request("GET", `${url.pathname.replace("/api/v1", "")}${url.search}`);
    expect(file.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("说明 书.docx")}`
    );

    const v1 = h.seed.docFile({});
    h.seed.docFile({ supersedes_id: v1 });
    expect((await request("GET", `/doc-library/file/${v1}/url`)).status).toBe(200);
    const gone = h.seed.docFile({ deleted_at: "2026-11-03T00:00:00.000Z" });
    const missing = await request("GET", `/doc-library/file/${gone}/url`);
    expect(missing.status).toBe(404);
    expect(missing.body.error!.message).toBe("资料不存在");
  });

  describe("权限", () => {
    const identities: [string, string, string[], string, boolean][] = [
      ["操作员", "op", ["operator"], "wecom_oauth", false],
      ["现场负责人", "sm", ["site_manager"], "wecom_oauth", false],
      ["经理", "mg", ["manager"], "wecom_oauth", false],
      ["财务", "fi", ["finance"], "wecom_oauth", false],
      ["资料管理员", "liu", ["operator"], "wecom_oauth", true],
      ["库管", "lz", ["operator"], "wecom_oauth", true],
      ["超管", "sa", ["super_admin"], "wecom_oauth", true],
      ["智能体令牌", "sa", ["super_admin"], "mcp_agent", false]
    ];

    it.each(identities)("%s 改和删", async (_label, sub, roles, authMethod, allowed) => {
      h.seed.member("lz", "keeper");
      const id = h.seed.docFile({});
      as(sub, roles, authMethod);
      const put = await request("PUT", `/doc-library/file/${id}`, {
        version: 0,
        title: "x",
        doc_category: "manual"
      });
      expect(put.status).toBe(allowed ? 200 : 403);
      const del = await request("DELETE", `/doc-library/file/${id}`, { version: allowed ? 1 : 0 });
      expect(del.status).toBe(allowed ? 200 : 403);
    });

    it("五个角色都能取查看地址", async () => {
      const id = h.seed.docFile({});
      for (const [sub, roles] of [
        ["op", ["operator"]],
        ["sm", ["site_manager"]],
        ["mg", ["manager"]],
        ["fi", ["finance"]],
        ["sa", ["super_admin"]]
      ] as [string, string[]][]) {
        as(sub, roles);
        expect((await request("GET", `/doc-library/file/${id}/url`)).status).toBe(200);
      }
    });
  });
});
