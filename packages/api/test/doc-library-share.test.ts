import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docLibraryRoutes } from "../src/routes/doc-library";
import { docLibraryOpenRoutes } from "../src/routes/doc-library-open";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 对外链接：生成、列出、作废，以及不带登录态的公开下载。

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
interface ShareData {
  token: string;
  url: string;
  expires_at: string;
  active: boolean;
  access_count: number;
  revoked_at: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const GONE = "链接已失效";
const PART = 8 * 1024 * 1024;

describe.skipIf(!hasSqlite)("资料对外链接", () => {
  let h: Harness;

  const as = (sub: string, roles: string[], authMethod = "wecom_oauth") => {
    authState.sub = sub;
    authState.roles = roles;
    authState.authMethod = authMethod;
  };
  const send = async (method: string, path: string, init: RequestInit = {}) => {
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryOpenRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    const response = await app.request(
      `https://api.test/api/v1/doc-library${path}`,
      { method, ...init },
      h.env
    );
    const raw = await response.text();
    let body: { success?: boolean; data?: unknown; error?: { message: string } } = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    return { status: response.status, body, raw, headers: response.headers };
  };
  /** 带登录态的请求 */
  const authed = (method: string, path: string, payload?: unknown) =>
    send(method, path, {
      headers: {
        authorization: "Bearer test-token",
        ...(payload === undefined ? {} : { "content-type": "application/json" })
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
  /** 不带任何登录态的公开下载 */
  const open = (token: string, headers: Record<string, string> = {}) =>
    send("GET", `/shared/${token}`, { headers });
  const share = async (fileId: number, payload: unknown = {}) => {
    const res = await authed("POST", `/file/${fileId}/share`, payload);
    expect(res.status).toBe(201);
    return res.body.data as ShareData;
  };
  const accessCount = (token: string) =>
    Number(
      (
        h.database.prepare("SELECT access_count FROM doc_share WHERE token = ?").get(token) as {
          access_count: number;
        }
      ).access_count
    );
  /** 一份内容认得出来的文件 */
  const seedFile = (text: string, overrides: Record<string, unknown> = {}) => {
    const id = h.seed.docFile({ file_size: text.length, ...overrides });
    const row = h.database.prepare("SELECT file_key FROM doc_file WHERE id = ?").get(id) as {
      file_key: string;
    };
    h.files.objects.set(row.file_key, {
      body: new TextEncoder().encode(text),
      contentType: "application/pdf"
    });
    return id;
  };

  beforeEach(() => {
    h = createWarehouseHarness();
    h.seed.member("liu", "doc_admin");
    as("liu", ["operator"]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("生成链接：默认 7 天后过期，令牌 43 个字符、每次不同，地址指向公开下载", async () => {
    const id = h.seed.docFile({});
    const before = Date.now();
    const first = await share(id);
    const second = await share(id);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(first.url).toBe(`https://api.test/api/v1/doc-library/shared/${first.token}`);
    expect(first.active).toBe(true);
    expect(first.access_count).toBe(0);
    const expires = Date.parse(first.expires_at);
    expect(expires).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(expires).toBeLessThanOrEqual(Date.now() + 7 * DAY);
  });

  it("有效天数可以选 1 到 30 天", async () => {
    const id = h.seed.docFile({});
    const before = Date.now();
    const one = await share(id, { days: 1 });
    const thirty = await share(id, { days: 30 });
    expect(Date.parse(one.expires_at)).toBeLessThanOrEqual(Date.now() + DAY);
    expect(Date.parse(thirty.expires_at)).toBeGreaterThanOrEqual(before + 30 * DAY);
  });

  it("不登录就能下载：内容对、当附件下载、文件名对，每下一次访问次数加一", async () => {
    const id = seedFile("合格证的内容", { file_name: "合格 证.pdf" });
    const { token } = await share(id);

    const res = await open(token);
    expect(res.status).toBe(200);
    expect(res.raw).toBe("合格证的内容");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("合格 证.pdf")}`
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(accessCount(token)).toBe(1);

    expect((await open(token)).status).toBe(200);
    expect(accessCount(token)).toBe(2);
  });

  it("公开下载支持 Range", async () => {
    const id = seedFile("0123456789");
    const { token } = await share(id);
    const res = await open(token, { range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.raw).toBe("2345");
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
  });

  it("过期后打不开，访问次数不变", async () => {
    const id = seedFile("内容");
    const { token } = await share(id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 8 * DAY));
    const res = await open(token);
    expect(res.status).toBe(404);
    expect(res.body.error!.message).toBe(GONE);
    expect(res.raw).not.toContain("内容");
    expect(accessCount(token)).toBe(0);
  });

  it("作废后打不开；再作废一次不报错，作废时间不变", async () => {
    const id = seedFile("内容");
    const { token } = await share(id);
    expect((await authed("DELETE", `/share/${token}`)).status).toBe(200);
    const res = await open(token);
    expect(res.status).toBe(404);
    expect(res.body.error!.message).toBe(GONE);
    expect(accessCount(token)).toBe(0);

    const revokedAt = () =>
      (
        h.database.prepare("SELECT revoked_at FROM doc_share WHERE token = ?").get(token) as {
          revoked_at: string;
        }
      ).revoked_at;
    const first = revokedAt();
    expect(first).toBeTruthy();
    expect((await authed("DELETE", `/share/${token}`)).status).toBe(200);
    expect(revokedAt()).toBe(first);
  });

  it("文件删除后链接打不开", async () => {
    const id = seedFile("内容");
    const { token } = await share(id);
    expect((await authed("DELETE", `/file/${id}`, { version: 0 })).status).toBe(200);
    const res = await open(token);
    expect(res.status).toBe(404);
    expect(res.body.error!.message).toBe(GONE);
    expect(accessCount(token)).toBe(0);
  });

  it("文件被替换后旧链接打不开，也不会发出新文件", async () => {
    const id = seedFile("旧文件");
    const { token } = await share(id);

    const init = await authed("POST", "/upload/init", { file_name: "新.pdf", file_size: 9 });
    expect(init.status).toBe(200);
    const uploadToken = (init.body.data as { upload_token: string }).upload_token;
    const part = await send("PUT", `/upload/part?token=${encodeURIComponent(uploadToken)}&part=1`, {
      body: new TextEncoder().encode("新文件")
    });
    expect(part.status).toBe(200);
    const done = await authed("POST", "/upload/complete", {
      upload_token: uploadToken,
      parts: [part.body.data],
      title: "新",
      doc_category: "manual",
      supersedes_id: id
    });
    expect(done.status).toBe(201);

    const res = await open(token);
    expect(res.status).toBe(404);
    expect(res.body.error!.message).toBe(GONE);
    expect(accessCount(token)).toBe(0);
  });

  it("就算链接没被作废，文件已删除或已被替换也打不开", async () => {
    const deleted = seedFile("删掉的");
    const replaced = seedFile("旧版");
    const a = await share(deleted);
    const b = await share(replaced);
    // 绕过接口直接改库：模拟作废那一步漏掉的情况
    h.database
      .prepare("UPDATE doc_file SET deleted_at = '2026-11-12T00:00:00.000Z' WHERE id = ?")
      .run(deleted);
    h.seed.docFile({ supersedes_id: replaced });

    for (const { token } of [a, b]) {
      const res = await open(token);
      expect(res.status).toBe(404);
      expect(res.body.error!.message).toBe(GONE);
      expect(accessCount(token)).toBe(0);
    }
  });

  it("随便一个令牌、空令牌、多一截路径：都是同一句「链接已失效」", async () => {
    const id = seedFile("内容");
    const { token } = await share(id);
    const paths = [
      `/shared/${"a".repeat(43)}`,
      "/shared/abc",
      "/shared/",
      "/shared",
      `/shared/${token}x`,
      `/shared/${token.slice(0, 42)}`,
      `/shared/${token}/extra`,
      `/shared/${encodeURIComponent(`${token}/../file/${id}/url`)}`
    ];
    for (const path of paths) {
      const res = await send("GET", path);
      expect([path, res.status]).toEqual([path, 404]);
      expect(res.body.error!.message).toBe(GONE);
      expect(res.raw).not.toContain("内容");
    }
    expect(accessCount(token)).toBe(0);
  });

  it("一个链接取不到别的文件", async () => {
    const mine = seedFile("我的文件");
    const other = seedFile("别人的文件");
    const otherKey = (
      h.database.prepare("SELECT file_key FROM doc_file WHERE id = ?").get(other) as {
        file_key: string;
      }
    ).file_key;
    const { token } = await share(mine);

    const withKey = await send(
      "GET",
      `/shared/${token}?key=${encodeURIComponent(otherKey)}&file_id=${other}&filename=x.exe`
    );
    expect(withKey.status).toBe(200);
    expect(withKey.raw).toBe("我的文件");
    expect(withKey.headers.get("content-disposition")).not.toContain("x.exe");

    // 地址里的 .. 在发出去之前就被规整掉了：退一级还在 /shared 下面，认不出令牌
    const oneUp = await send("GET", `/shared/${token}/../file/${other}/url`);
    expect(oneUp.status).toBe(404);
    expect(oneUp.body.error!.message).toBe(GONE);
    // 退两级落到要登录的接口，没登录拿不到
    const twoUp = await send("GET", `/shared/${token}/../../file/${other}/url`);
    expect(twoUp.status).toBe(401);
    for (const res of [oneUp, twoUp]) expect(res.raw).not.toContain("别人的文件");
    expect(accessCount(token)).toBe(1);
  });

  it("有效天数填错返回 400，不生成链接", async () => {
    const id = h.seed.docFile({});
    for (const days of [0, 31, "abc", 1.5, -1, null, "7"]) {
      const res = await authed("POST", `/file/${id}/share`, { days });
      expect([days, res.status]).toEqual([days, 400]);
      expect(res.body.error!.message).toBe("有效天数要填 1 到 30 的整数");
    }
    expect(
      Number((h.database.prepare("SELECT COUNT(*) AS n FROM doc_share").get() as { n: number }).n)
    ).toBe(0);
  });

  it("已删除、不存在的文件不能生成链接；旧版本也不能", async () => {
    const gone = h.seed.docFile({ deleted_at: "2026-11-03T00:00:00.000Z" });
    const deleted = await authed("POST", `/file/${gone}/share`, {});
    expect(deleted.status).toBe(404);
    expect(deleted.body.error!.message).toBe("资料不存在");
    expect((await authed("POST", "/file/99999/share", {})).status).toBe(404);

    const v1 = h.seed.docFile({});
    h.seed.docFile({ supersedes_id: v1 });
    const old = await authed("POST", `/file/${v1}/share`, {});
    expect(old.status).toBe(409);
    expect(old.body.error!.message).toBe("旧版本不能生成对外链接");
  });

  it("同一个来源一分钟内第 31 次请求被限流", async () => {
    const id = seedFile("内容");
    const { token } = await share(id);
    // 停在一分钟的中间，免得跑到一半跨过整分钟
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T08:00:30.000Z"));
    for (let n = 1; n <= 30; n += 1) {
      const res = await open(n % 2 ? token : "a".repeat(43));
      expect([n, res.status]).toEqual([n, n % 2 ? 200 : 404]);
    }
    const blocked = await open(token);
    expect(blocked.status).toBe(429);
    expect(blocked.raw).not.toContain("内容");
    expect(accessCount(token)).toBe(15);

    // 过了这一分钟又能下
    vi.setSystemTime(new Date("2026-11-12T08:01:30.000Z"));
    expect((await open(token)).status).toBe(200);
  });

  it("传分片不受对外链接的限流影响", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T08:00:30.000Z"));
    for (let n = 1; n <= 31; n += 1) await open("a".repeat(43));
    const init = await authed("POST", "/upload/init", { file_name: "a.pdf", file_size: PART + 1 });
    const uploadToken = (init.body.data as { upload_token: string }).upload_token;
    const part = await send("PUT", `/upload/part?token=${encodeURIComponent(uploadToken)}&part=2`, {
      body: new Uint8Array(1)
    });
    expect(part.status).toBe(200);
  });

  it("列出一个文件的链接：有效的、作废的、过期的都在，是否有效标得对，不带别的文件的", async () => {
    const id = h.seed.docFile({});
    const other = h.seed.docFile({});
    const live = await share(id, { days: 30 });
    const revoked = await share(id);
    const short = await share(id, { days: 1 });
    await share(other);
    await authed("DELETE", `/share/${revoked.token}`);
    await open(live.token);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2 * DAY));
    const res = await authed("GET", `/file/${id}/share`);
    expect(res.status).toBe(200);
    const rows = res.body.data as ShareData[];
    expect(rows).toHaveLength(3);
    const byToken = new Map(rows.map((row) => [row.token, row]));
    expect(byToken.get(live.token)).toMatchObject({ active: true, access_count: 1, url: live.url });
    expect(byToken.get(revoked.token)).toMatchObject({ active: false });
    expect(byToken.get(revoked.token)!.revoked_at).toBeTruthy();
    expect(byToken.get(short.token)).toMatchObject({ active: false, revoked_at: null });
    // 新生成的排前面
    expect(rows[0].token).toBe(short.token);
  });

  it("作废不存在的链接返回 404；不存在的文件列不出链接", async () => {
    const res = await authed("DELETE", `/share/${"a".repeat(43)}`);
    expect(res.status).toBe(404);
    expect(res.body.error!.message).toBe("链接不存在");
    expect((await authed("GET", "/file/99999/share")).status).toBe(404);
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

    it.each(identities)("%s 生成、列出、作废", async (_label, sub, roles, authMethod, allowed) => {
      h.seed.member("lz", "keeper");
      const id = h.seed.docFile({});
      const existing = await share(id);
      as(sub, roles, authMethod);

      const created = await authed("POST", `/file/${id}/share`, {});
      expect(created.status).toBe(allowed ? 201 : 403);
      const listed = await authed("GET", `/file/${id}/share`);
      expect(listed.status).toBe(allowed ? 200 : 403);
      expect(listed.raw.includes(existing.token)).toBe(allowed);
      const revoked = await authed("DELETE", `/share/${existing.token}`);
      expect(revoked.status).toBe(allowed ? 200 : 403);
      // 没权限的人作废不了：链接还能下
      expect((await open(existing.token)).status).toBe(allowed ? 404 : 200);
    });

    it("没登录不能生成、列出、作废", async () => {
      const id = h.seed.docFile({});
      const { token } = await share(id);
      expect((await send("POST", `/file/${id}/share`)).status).toBe(401);
      expect((await send("GET", `/file/${id}/share`)).status).toBe(401);
      expect((await send("DELETE", `/share/${token}`)).status).toBe(401);
      expect((await open(token)).status).toBe(200);
    });
  });
});
