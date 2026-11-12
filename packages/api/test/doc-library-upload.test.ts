import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { docLibraryRoutes } from "../src/routes/doc-library";
import { docLibraryOpenRoutes } from "../src/routes/doc-library-open";
import { listDocFiles } from "../src/services/doc-library/query";
import { signUploadToken, verifyUploadToken } from "../src/services/doc-library/upload-token";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 资料的分片上传：初始化、传分片、完成、放弃。

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

const MB = 1024 * 1024;
const PART = 8 * MB;
type Harness = ReturnType<typeof createWarehouseHarness>;

describe("上传令牌", () => {
  const claims = {
    key: "doc-library/2026/u-a.pdf",
    uploadId: "upload-1",
    name: "a.pdf",
    size: 100,
    type: "application/pdf",
    uid: "liu",
    exp: 2_000_000_000_000
  };

  it("签了能验，内容原样取回", async () => {
    const token = await signUploadToken("secret", claims);
    expect(await verifyUploadToken("secret", token, 1_900_000_000_000)).toEqual(claims);
  });

  it("改过、过期、密钥不对、不是字符串都不认", async () => {
    const token = await signUploadToken("secret", claims);
    const [payload, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ ...claims, uid: "someone" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyUploadToken("secret", `${forged}.${signature}`, 1)).toBeNull();
    expect(
      await verifyUploadToken("secret", `${payload}.${signature.slice(0, -1)}0`, 1)
    ).toBeNull();
    expect(await verifyUploadToken("secret", token, claims.exp + 1)).toBeNull();
    expect(await verifyUploadToken("other", token, 1)).toBeNull();
    for (const bad of [null, undefined, 123, "", "abc", "a.b.c", `${payload}.`]) {
      expect(await verifyUploadToken("secret", bad, 1)).toBeNull();
    }
  });
});

describe.skipIf(!hasSqlite)("资料分片上传", () => {
  let h: Harness;
  let env: Env;

  const as = (sub: string, roles: string[], authMethod = "wecom_oauth") => {
    authState.sub = sub;
    authState.roles = roles;
    authState.authMethod = authMethod;
  };

  const request = async (method: string, path: string, init: RequestInit = {}) => {
    const app = new Hono();
    app.route("/api/v1/doc-library", docLibraryOpenRoutes);
    app.route("/api/v1/doc-library", docLibraryRoutes);
    const response = await app.request(
      `https://api.test/api/v1/doc-library${path}`,
      { method, ...init },
      h.env
    );
    const raw = await response.text();
    let body: { success?: boolean; data?: Record<string, never>; error?: { message: string } } = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    return { status: response.status, body };
  };
  const post = (path: string, payload: unknown) =>
    request("POST", path, {
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  const putPart = (token: string, part: number | string, bytes: Uint8Array) =>
    request("PUT", `/upload/part?token=${encodeURIComponent(token)}&part=${part}`, { body: bytes });

  /** 走完初始化和传分片，返回完成请求要用的东西。 */
  const upload = async (fileName: string, size: number, client?: string) => {
    const init = await post("/upload/init", { file_name: fileName, file_size: size, client });
    expect(init.status).toBe(200);
    const token = init.body.data!.upload_token as string;
    const count = init.body.data!.part_count as number;
    const parts: { part_number: number; etag: string }[] = [];
    for (let index = 0; index < count; index += 1) {
      const length = index === count - 1 ? size - PART * (count - 1) : PART;
      const sent = await putPart(token, index + 1, new Uint8Array(length).fill(index + 1));
      expect(sent.status).toBe(200);
      parts.push({ part_number: sent.body.data!.part_number, etag: sent.body.data!.etag });
    }
    return { token, parts, count };
  };
  const complete = (token: string, parts: unknown, extra: Record<string, unknown> = {}) =>
    post("/upload/complete", {
      upload_token: token,
      parts,
      title: "合格证",
      doc_category: "cert",
      ...extra
    });
  const docCount = () =>
    Number((h.database.prepare("SELECT COUNT(*) AS n FROM doc_file").get() as { n: number }).n);

  beforeEach(() => {
    h = createWarehouseHarness();
    env = h.env as unknown as Env;
    h.seed.member("liu", "doc_admin");
    as("liu", ["operator"]);
  });

  it("20 MiB 的文件分三片传完，记录和文件大小都对", async () => {
    const { token, parts, count } = await upload("合格证.PDF", 20 * MB);
    expect(count).toBe(3);
    const device = h.seed.device();
    const done = await complete(token, parts, { device_id: device, valid_until: "2027-01-01" });
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ replayed: false });
    const [row] = (await listDocFiles(env, {})).items;
    expect(row).toMatchObject({
      title: "合格证",
      file_name: "合格证.PDF",
      file_size: 20 * MB,
      content_type: "application/pdf",
      doc_category: "cert",
      device_id: device,
      valid_until: "2027-01-01",
      uploaded_by_userid: "liu",
      supersedes_id: null
    });
    expect(row.file_key.startsWith("doc-library/")).toBe(true);
    const stored = h.files.objects.get(row.file_key)!;
    expect(stored.body.length).toBe(20 * MB);
    expect(stored.contentType).toBe("application/pdf");
    // 三片按顺序拼起来
    expect([stored.body[0], stored.body[PART], stored.body[2 * PART]]).toEqual([1, 2, 3]);
  });

  it("只有一片的小文件也走同一条路，不填归属就是通用", async () => {
    const { token, parts, count } = await upload("说明.txt", 1024);
    expect(count).toBe(1);
    expect((await complete(token, parts, { doc_category: "other" })).status).toBe(201);
    const [row] = (await listDocFiles(env, {})).items;
    expect(row).toMatchObject({ scope: "general", file_size: 1024 });
    expect(row.content_type).toBe("text/plain; charset=utf-8");
  });

  it("初始化：不收的类型、大小不对、超过上限都拒绝", async () => {
    const html = await post("/upload/init", { file_name: "a.html", file_size: 10 });
    expect(html.status).toBe(400);
    expect(html.body.error!.message).toBe("不支持这种文件：html");
    expect((await post("/upload/init", { file_name: "a.exe", file_size: 10 })).status).toBe(400);
    expect(
      (await post("/upload/init", { file_name: "没有扩展名", file_size: 10 })).body.error!.message
    ).toBe("不支持这种文件：没有扩展名");
    for (const size of [0, -1, 1.5, "abc", null]) {
      expect((await post("/upload/init", { file_name: "a.pdf", file_size: size })).status).toBe(
        400
      );
    }
    const tooBig = await post("/upload/init", { file_name: "a.mp4", file_size: 2049 * MB });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error!.message).toBe("文件太大，最大 2048 MB");
    // 小程序的上限低一些
    const phone = await post("/upload/init", {
      file_name: "a.mp4",
      file_size: 201 * MB,
      client: "miniapp"
    });
    expect(phone.body.error!.message).toBe("文件太大，最大 200 MB");
    expect((await post("/upload/init", { file_name: "a.mp4", file_size: 201 * MB })).status).toBe(
      200
    );
  });

  it("初始化：扩展名是 constructor 这类名字的文件照样说不支持", async () => {
    const res = await post("/upload/init", { file_name: "a.constructor", file_size: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error!.message).toBe("不支持这种文件：constructor");
    expect(h.files.uploads.size).toBe(0);
  });

  it("传分片：令牌不对、片号不对、声明的长度不对时不读请求体", async () => {
    const init = await post("/upload/init", { file_name: "a.pdf", file_size: 20 * MB });
    const token = init.body.data!.upload_token as string;
    /** 一个记得自己有没有被读过的请求体 */
    const probe = () => {
      const state = { read: false };
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            state.read = true;
            controller.enqueue(new Uint8Array(16));
            controller.close();
          }
        },
        { highWaterMark: 0 }
      );
      return { state, body };
    };
    const send = async (query: string, headers: Record<string, string> = {}) => {
      const { state, body } = probe();
      const res = await request("PUT", `/upload/part?${query}`, {
        body,
        headers,
        duplex: "half"
      } as RequestInit);
      return { status: res.status, message: res.body.error?.message, read: state.read };
    };
    expect(await send("token=not-a-token&part=1")).toEqual({
      status: 403,
      message: "上传已失效，请重新上传",
      read: false
    });
    expect(await send(`token=${encodeURIComponent(token)}&part=9`)).toEqual({
      status: 400,
      message: "分片序号不对",
      read: false
    });
    // 这一片该是 8 MiB，声明的是 100 MiB：不读，直接拒绝
    expect(
      await send(`token=${encodeURIComponent(token)}&part=1`, {
        "content-length": String(100 * MB)
      })
    ).toEqual({ status: 400, message: "分片大小不对", read: false });
  });

  it("传分片：令牌不对、片号不对、大小不对都拒绝；最后一片可以小", async () => {
    const init = await post("/upload/init", { file_name: "a.pdf", file_size: 20 * MB });
    const token = init.body.data!.upload_token as string;
    const full = new Uint8Array(PART);
    const bad = await putPart("not-a-token", 1, full);
    expect(bad.status).toBe(403);
    expect(bad.body.error!.message).toBe("上传已失效，请重新上传");
    for (const part of [0, 4, "x", 1.5]) {
      expect((await putPart(token, part, full)).status).toBe(400);
    }
    const wrongSize = await putPart(token, 2, new Uint8Array(PART - 1));
    expect(wrongSize.status).toBe(400);
    expect(wrongSize.body.error!.message).toBe("分片大小不对");
    expect((await putPart(token, 3, new Uint8Array(PART))).status).toBe(400);
    expect((await putPart(token, 1, new Uint8Array(0))).status).toBe(400);
    expect((await putPart(token, 3, new Uint8Array(4 * MB))).status).toBe(200);
  });

  it("令牌过了 24 小时就不能再传", async () => {
    const init = await post("/upload/init", { file_name: "a.pdf", file_size: 1024 });
    const token = init.body.data!.upload_token as string;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 25 * 3600 * 1000));
    expect((await putPart(token, 1, new Uint8Array(1024))).status).toBe(403);
    vi.useRealTimers();
  });

  it("某一片重传后，用新的那次完成", async () => {
    const { token, parts } = await upload("a.pdf", 20 * MB);
    const again = await putPart(token, 2, new Uint8Array(PART).fill(9));
    const fixed = parts.map((part) =>
      part.part_number === 2 ? { part_number: 2, etag: again.body.data!.etag } : part
    );
    expect((await complete(token, fixed)).status).toBe(201);
    const [row] = (await listDocFiles(env, {})).items;
    expect(h.files.objects.get(row.file_key)!.body[PART]).toBe(9);
  });

  it("缺一片就完成：拒绝，不留记录", async () => {
    const { token, parts } = await upload("a.pdf", 20 * MB);
    const res = await complete(token, parts.slice(0, 2));
    expect(res.status).toBe(400);
    expect(res.body.error!.message).toBe("文件不完整，请重新上传");
    expect(docCount()).toBe(0);
    // 片号重复、片号不连续也一样
    expect((await complete(token, [parts[0], parts[0], parts[2]])).status).toBe(400);
    expect((await complete(token, "x")).status).toBe(400);
  });

  it("用旧的 etag 完成（分片对不上）：拒绝，不留记录", async () => {
    const { token, parts } = await upload("a.pdf", 20 * MB);
    const res = await complete(token, [parts[0], { part_number: 2, etag: "wrong" }, parts[2]]);
    expect(res.status).toBe(400);
    expect(res.body.error!.message).toBe("文件不完整，请重新上传");
    expect(docCount()).toBe(0);
  });

  it("完成请求发两次：第二次直接告诉你已经好了，只有一条记录", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    const first = await complete(token, parts);
    const second = await complete(token, parts);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ id: first.body.data!.id, replayed: true });
    expect(docCount()).toBe(1);
  });

  it("文件已经拼好但记录没写上（完成时出错）：再发一次完成能补上记录", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    const real = h.env.DB.batch.bind(h.env.DB);
    let failed = false;
    h.env.DB.batch = async (statements: unknown[]) => {
      if (!failed) {
        failed = true;
        throw new Error("D1 overloaded");
      }
      return real(statements);
    };
    expect((await complete(token, parts)).status).toBe(500);
    expect(docCount()).toBe(0);
    const retry = await complete(token, parts);
    expect(retry.status).toBe(201);
    expect(docCount()).toBe(1);
  });

  it("拼出来的文件大小和申报的不一样：删掉文件，不留记录", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    const realHead = h.files.head.bind(h.files);
    h.files.head = async (key: string) => {
      const head = await realHead(key);
      return head ? { ...head, size: 999 } : null;
    };
    const res = await complete(token, parts);
    expect(res.status).toBe(400);
    expect(res.body.error!.message).toBe("文件不完整，请重新上传");
    expect(docCount()).toBe(0);
    expect([...h.files.objects.keys()].filter((key) => key.startsWith("doc-library/"))).toEqual([]);
  });

  it("别人拿着你的令牌来完成：拒绝", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    h.seed.member("other", "doc_admin");
    as("other", ["operator"]);
    const res = await complete(token, parts);
    expect(res.status).toBe(403);
    expect(docCount()).toBe(0);
  });

  it("标题、资料类别、归属、有效期填错都拒绝", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    const category = h.seed.category();
    const device = h.seed.device();
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "  " }, "标题"],
      [{ title: "长".repeat(121) }, "标题"],
      [{ doc_category: "x" }, "资料类别"],
      [{ device_id: 99999 }, "设备不存在"],
      [{ device_category_id: 99999 }, "设备类别不存在"],
      [{ device_id: device, device_category_id: category }, "归属只能选设备或设备类别其中一个"],
      [{ valid_until: "明年" }, "有效期"]
    ];
    for (const [extra, message] of cases) {
      const res = await complete(token, parts, extra);
      expect(res.status, message).toBe(400);
      expect(res.body.error!.message).toContain(message);
    }
    expect(docCount()).toBe(0);
    // 填对了还能完成：前面的失败没有把这次上传弄坏
    expect((await complete(token, parts, { device_category_id: category })).status).toBe(201);
  });

  it("替换：旧文件留作历史，列表只列新的，旧文件上的对外链接作废", async () => {
    const oldId = h.seed.docFile({ title: "合格证（旧）", doc_category: "cert" });
    h.database
      .prepare(
        "INSERT INTO doc_share (token, doc_file_id, expires_at, created_by_userid, created_at) VALUES ('t1', ?, '2099-01-01T00:00:00.000Z', 'liu', '2026-11-12T00:00:00.000Z')"
      )
      .run(oldId);
    const { token, parts } = await upload("新合格证.pdf", 1024);
    const done = await complete(token, parts, { supersedes_id: oldId });
    expect(done.status).toBe(201);
    const page = await listDocFiles(env, {});
    expect(page.items.map((row) => row.title)).toEqual(["合格证"]);
    expect(page.items[0].supersedes_id).toBe(oldId);
    expect((await listDocFiles(env, { include_history: "1" })).total).toBe(2);
    const share = h.database
      .prepare("SELECT revoked_at FROM doc_share WHERE token = 't1'")
      .get() as {
      revoked_at: string | null;
    };
    expect(share.revoked_at).not.toBeNull();
  });

  it("替换一个已经被替换或删除的文件：提示刷新", async () => {
    const v1 = h.seed.docFile({});
    h.seed.docFile({ supersedes_id: v1 });
    const deleted = h.seed.docFile({ deleted_at: "2026-11-03T00:00:00.000Z" });
    for (const target of [v1, deleted, 99999]) {
      const { token, parts } = await upload("a.pdf", 1024);
      const res = await complete(token, parts, { supersedes_id: target });
      expect(res.status).toBe(409);
      expect(res.body.error!.message).toBe("这个文件已经被替换或删除，请刷新");
    }
    expect(docCount()).toBe(3);
  });

  it("存储临时出错时传分片返回 500，不说「上传已失效」；再传一次就成", async () => {
    const init = await post("/upload/init", { file_name: "a.pdf", file_size: 1024 });
    const token = init.body.data!.upload_token as string;
    h.files.failOnce("uploadPart");
    const first = await putPart(token, 1, new Uint8Array(1024));
    expect(first.status).toBe(500);
    expect(first.body.error!.message).toBe("服务器出错，请稍后重试");
    const second = await putPart(token, 1, new Uint8Array(1024));
    expect(second.status).toBe(200);
    const done = await complete(token, [second.body.data]);
    expect(done.status).toBe(201);
    expect(docCount()).toBe(1);
  });

  it("拼分片时存储临时出错：返回 500、不写记录；原样再发一次完成请求就成，只有一条", async () => {
    const { token, parts } = await upload("a.pdf", 1024);
    h.files.failOnce(
      "complete",
      "completeMultipartUpload: We encountered an internal error. Please try again. (10001)"
    );
    const first = await complete(token, parts);
    expect(first.status).toBe(500);
    expect(docCount()).toBe(0);
    const second = await complete(token, parts);
    expect(second.status).toBe(201);
    expect(docCount()).toBe(1);
    expect(h.files.objects.size).toBe(1);
  });

  it("放弃之后不能再传；别人放弃不了你的上传", async () => {
    const init = await post("/upload/init", { file_name: "a.pdf", file_size: 1024 });
    const token = init.body.data!.upload_token as string;
    h.seed.member("other", "doc_admin");
    as("other", ["operator"]);
    expect((await post("/upload/abort", { upload_token: token })).status).toBe(200);
    expect((await putPart(token, 1, new Uint8Array(1024))).status).toBe(200);
    as("liu", ["operator"]);
    expect((await post("/upload/abort", { upload_token: token })).status).toBe(200);
    const after = await putPart(token, 1, new Uint8Array(1024));
    expect(after.status).toBe(403);
    expect((await post("/upload/abort", { upload_token: "garbage" })).status).toBe(200);
  });

  it.each([
    ["操作员", "op", ["operator"], false],
    ["现场负责人", "sm", ["site_manager"], false],
    ["经理", "mg", ["manager"], false],
    ["财务", "fi", ["finance"], false],
    ["资料管理员", "liu", ["operator"], true],
    ["超管", "sa", ["super_admin"], true]
  ])("权限：%s 初始化上传", async (_label, sub, roles, allowed) => {
    as(sub as string, roles as string[]);
    const res = await post("/upload/init", { file_name: "a.pdf", file_size: 1024 });
    expect(res.status).toBe(allowed ? 200 : 403);
  });

  it("权限：库管也能上传；智能体令牌不能", async () => {
    h.seed.member("lz", "keeper");
    as("lz", ["operator"]);
    expect((await post("/upload/init", { file_name: "a.pdf", file_size: 1024 })).status).toBe(200);
    as("sa", ["super_admin"], "mcp_agent");
    expect((await post("/upload/init", { file_name: "a.pdf", file_size: 1024 })).status).toBe(403);
    expect((await post("/upload/complete", {})).status).toBe(403);
  });
});
