import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

const mockAuth = vi.hoisted(
  () =>
    ({
      sub: "finance-a",
      username: "finance-a",
      nickname: "Finance A",
      avatar: "",
      roles: ["finance"],
      permissions: [],
      tokenId: "token-a",
      type: "access",
      auth_method: "wecom_oauth",
      wecom_verified_at: "2026-07-01T00:00:00.000Z",
      exp: 4102444800,
      iat: 1770000000
    }) as AuthTokenPayload
);

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuth
}));

const createEnv = (): Env =>
  ({
    DB: {
      prepare() {
        throw new Error("金额校验必须在访问数据库之前");
      }
    },
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const send = (method: "POST" | "PUT", path: string, body: Record<string, unknown>) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app.request(
    path,
    {
      method,
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    createEnv()
  );
};

const INVALID_AMOUNTS: Array<[string, unknown]> = [
  ["非数字字符串", "abc"],
  ["空字符串", " "],
  ["超出可转换范围", 1e20],
  ["布尔值", true]
];

describe("付款金额校验", () => {
  for (const [label, amount] of INVALID_AMOUNTS) {
    it(`新建：${label}返回 400，不暴露内部错误`, async () => {
      const response = await send("POST", "/payment", { payee_id: 1, amount });
      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: { message: string } };
      expect(json.error.message).toBe("金额无效，请填写数字金额");
    });

    it(`修改：${label}返回 400`, async () => {
      const response = await send("PUT", "/payment/1", { amount });
      expect(response.status).toBe(400);
    });
  }

  it("新建：缺少金额返回 400", async () => {
    const response = await send("POST", "/payment", { payee_id: 1 });
    expect(response.status).toBe(400);
  });
});
