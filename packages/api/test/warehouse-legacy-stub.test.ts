import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { warehouseLegacyStubRoutes } from "../src/routes/warehouse-legacy-stub";

// 旧库房接口下线后，已发布的小程序和已安装的 MCP 还会调旧路径。
// 列表类 GET 返回空数组，其余一律 410 并提示已升级，直到阶段 3 换掉小程序页面。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "u1",
    username: "u1",
    nickname: "U1",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-u1",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

const env = { KV: { get: async () => "session" } };

const call = async (method, path, withToken = true) => {
  const app = new Hono();
  app.route("/api/v1/asset", warehouseLegacyStubRoutes);
  app.route("/api/v1/warehouse", warehouseLegacyStubRoutes);
  const response = await app.request(
    path,
    { method, headers: withToken ? { authorization: "Bearer test-token" } : {} },
    env
  );
  return { status: response.status, body: await response.json() };
};

describe("旧库房接口占位", () => {
  it.each([
    "/api/v1/warehouse",
    "/api/v1/warehouse/stock-order",
    "/api/v1/warehouse/stocktake",
    "/api/v1/warehouse/work-order/mobile/my-tasks",
    "/api/v1/asset",
    "/api/v1/asset/type"
  ])("GET %s 返回空数组", async (path) => {
    const result = await call("GET", path);
    expect(result).toEqual({ status: 200, body: { success: true, data: [] } });
  });

  it.each([
    ["POST", "/api/v1/warehouse/stock-order"],
    ["GET", "/api/v1/asset/12"],
    ["POST", "/api/v1/warehouse/work-order/mobile/task/3/submit"]
  ])("%s %s 返回 410", async (method, path) => {
    const result = await call(method, path);
    expect(result.status).toBe(410);
    expect(result.body).toEqual({
      success: false,
      error: { message: "库房功能已升级，请使用新版页面" }
    });
  });

  it("不带令牌返回 401", async () => {
    const result = await call("GET", "/api/v1/warehouse/stock-order", false);
    expect(result.status).toBe(401);
  });
});
