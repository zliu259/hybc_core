import { Hono } from "hono";
import { sign } from "hono/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadRoutes } from "../src/routes/upload";
import { createFakeR2, type FakeR2 } from "./helpers/fake-r2";
import { hasSqlite } from "./helpers/sqlite-d1";
import { createWarehouseHarness } from "./helpers/warehouse-harness";

// 上传签名和下载签名分开：下载地址不能拿去覆盖文件；受保护前缀要签名或人的登录态才能读。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "wang",
    username: "wang",
    nickname: "wang",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-wang",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

const SECRET = "upload-test-secret";
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe.skipIf(!hasSqlite)("上传和下载签名", () => {
  let files: FakeR2;
  let env: Record<string, unknown>;

  const call = async (method: string, path: string, init: RequestInit = {}) => {
    const app = new Hono();
    app.route("/api/v1/upload", uploadRoutes);
    const response = await app.request(
      `https://api.test/api/v1/upload${path}`,
      { method, ...init },
      env
    );
    const raw = await response.text();
    let body: { success?: boolean; data?: Record<string, string>; error?: { message: string } } =
      {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    return { status: response.status, body, raw, headers: response.headers };
  };
  const post = (path: string, payload: unknown) =>
    call("POST", path, {
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  /** 签名地址里 /api/v1/upload 之后的部分 */
  const tail = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.pathname.replace("/api/v1/upload", "")}${parsed.search}`;
  };
  const objectPath = (key: string) => `/object/${encodeURIComponent(key)}`;

  beforeEach(() => {
    const h = createWarehouseHarness();
    files = createFakeR2();
    env = { ...h.env, FILES: files, UPLOAD_SIGNING_SECRET: SECRET, TASK_API_KEY: "runner-key" };
  });

  it("下载签名不能用来上传", async () => {
    await files.put("wh-task/a.jpg", "原图", { httpMetadata: { contentType: "image/jpeg" } });
    const signed = await post("/sign-download", { key: "wh-task/a.jpg" });
    expect(signed.status).toBe(200);
    const res = await call("PUT", tail(signed.body.data!.url), { body: "覆盖" });
    expect(res.status).toBe(401);
    expect(text(files.objects.get("wh-task/a.jpg")!.body)).toBe("原图");
  });

  it("下载签名能读到文件", async () => {
    await files.put("wh-task/a.jpg", "原图", { httpMetadata: { contentType: "image/jpeg" } });
    const signed = await post("/sign-download", { key: "wh-task/a.jpg" });
    const res = await call("GET", tail(signed.body.data!.url));
    expect(res.status).toBe(200);
    expect(res.raw).toBe("原图");
  });

  it("上传签名能上传，但不能用来读受保护的文件", async () => {
    const signed = await post("/sign", {
      fileName: "a.jpg",
      contentType: "image/jpeg",
      category: "wh-task"
    });
    expect(signed.status).toBe(200);
    const uploadPath = tail(signed.body.data!.uploadUrl);
    expect((await call("PUT", uploadPath, { body: "图" })).status).toBe(200);
    expect(text(files.objects.get(signed.body.data!.key)!.body)).toBe("图");
    expect((await call("GET", uploadPath)).status).toBe(401);
  });

  it("别的键的签名、过期的签名、改过的签名都拒绝", async () => {
    await files.put("wh-task/a.jpg", "a", { httpMetadata: { contentType: "image/jpeg" } });
    await files.put("wh-task/b.jpg", "b", { httpMetadata: { contentType: "image/jpeg" } });
    const signed = await post("/sign-download", { key: "wh-task/a.jpg" });
    const query = new URL(signed.body.data!.url).search;
    expect((await call("GET", `${objectPath("wh-task/b.jpg")}${query}`)).status).toBe(401);

    const params = new URLSearchParams(query);
    // 签名是十六进制：把最后一位换成另一个字符。固定换成 0 的话，签名本来就以 0 结尾时等于没改
    const original = params.get("signature")!;
    const tampered = `${original.slice(0, -1)}${original.endsWith("0") ? "1" : "0"}`;
    expect(tampered).not.toBe(original);
    expect(
      (
        await call(
          "GET",
          `${objectPath("wh-task/a.jpg")}?expires=${params.get("expires")}&signature=${tampered}`
        )
      ).status
    ).toBe(401);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000));
    expect((await call("GET", tail(signed.body.data!.url))).status).toBe(401);
    vi.useRealTimers();
  });

  it("资料库的键不能从通用接口签", async () => {
    const upload = await post("/sign", { fileName: "a.pdf", category: "doc-library" });
    expect(upload.status).toBe(400);
    expect(upload.body.error!.message).toBe("资料请从资料库上传");
    expect((await post("/sign", { fileName: "a.pdf", category: "doc-library/2026" })).status).toBe(
      400
    );
    const download = await post("/sign-download", { key: "doc-library/2026/x-a.pdf" });
    expect(download.status).toBe(403);
    expect(download.body.error!.message).toBe("请从资料库打开这个文件");
  });

  it("任务照片、库房单照片、资料不带签名和登录态读不到", async () => {
    for (const key of ["wh-task/a.jpg", "wh-doc/b.jpg", "doc-library/2026/c.pdf"]) {
      await files.put(key, "x", { httpMetadata: { contentType: "image/jpeg" } });
      expect((await call("GET", objectPath(key))).status).toBe(401);
    }
  });

  it("人的登录态能读这三类文件，智能体令牌不能", async () => {
    await files.put("wh-task/a.jpg", "x", { httpMetadata: { contentType: "image/jpeg" } });
    const exp = Math.floor(Date.now() / 1000) + 600;
    const human = await sign(
      { sub: "wang", auth_method: "wecom_oauth", exp },
      "test-secret",
      "HS256"
    );
    const agent = await sign(
      { sub: "wang", auth_method: "mcp_agent", exp },
      "test-secret",
      "HS256"
    );
    const withToken = (token: string) =>
      call("GET", objectPath("wh-task/a.jpg"), { headers: { authorization: `Bearer ${token}` } });
    expect((await withToken(human)).status).toBe(200);
    expect((await withToken(agent)).status).toBe(401);
    expect((await withToken("not-a-token")).status).toBe(401);
  });

  it("这三类文件出去时不让浏览器猜类型，不能内嵌的当附件", async () => {
    await files.put("wh-task/page.html", "<script>1</script>", {
      httpMetadata: { contentType: "text/html" }
    });
    const signed = await post("/sign-download", { key: "wh-task/page.html" });
    const res = await call("GET", tail(signed.body.data!.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("原来不受保护的前缀照旧能读，回包头不变，并且支持 Range", async () => {
    await files.put("miniapp/x.jpg", "0123456789", { httpMetadata: { contentType: "image/jpeg" } });
    const whole = await call("GET", objectPath("miniapp/x.jpg"));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-disposition")).toBeNull();
    const part = await call("GET", objectPath("miniapp/x.jpg"), {
      headers: { range: "bytes=0-3" }
    });
    expect(part.status).toBe(206);
    expect(part.raw).toBe("0123");
  });

  it("原来受保护的前缀：计算节点的 key 仍然能读", async () => {
    await files.put("legacy/fin/a.pdf", "x", { httpMetadata: { contentType: "application/pdf" } });
    expect((await call("GET", objectPath("legacy/fin/a.pdf"))).status).toBe(401);
    expect(
      (
        await call("GET", objectPath("legacy/fin/a.pdf"), {
          headers: { "x-api-key": "runner-key" }
        })
      ).status
    ).toBe(200);
  });
});
