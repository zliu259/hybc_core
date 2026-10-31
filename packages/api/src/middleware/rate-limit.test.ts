import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createRateLimitMiddleware } from "./rate-limit";
import type { Env } from "../types/env";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** 记录每次 bind() 实参的最小 D1 桩：限流中间件两条 SQL 的第 2 个实参都是 actor_key。 */
const createFakeDb = (hitCount: number) => {
  const binds: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        binds.push(args);
        return {
          run: async () => ({ success: true }),
          first: async () => ({ hit_count: hitCount })
        };
      }
    })
  };
  return { db, binds };
};

const buildApp = (hitCount: number, token?: string) => {
  const { db, binds } = createFakeDb(hitCount);
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", createRateLimitMiddleware({ scope: "t", maxRequests: 5, windowSeconds: 60 }));
  app.get("/", (c) => c.text("ok"));
  const env = { DB: db, RELAY_TRUST_TOKEN: token } as unknown as Env;
  return { app, env, binds };
};

describe("createRateLimitMiddleware actor key", () => {
  it("直连：actor_key 为 cf-connecting-ip，忽略伪造令牌与客户端自带 XFF", async () => {
    const { app, env, binds } = buildApp(1, TOKEN);
    const res = await app.request(
      "/",
      {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "10.0.0.1",
          "x-relay-auth": "wrong"
        }
      },
      env
    );
    expect(res.status).toBe(200);
    expect(binds[0]?.[1]).toBe("203.0.113.9");
  });

  it("可信中转：actor_key 为 XFF 首跳而非中转机 IP", async () => {
    const { app, env, binds } = buildApp(1, TOKEN);
    const res = await app.request(
      "/",
      {
        headers: {
          "cf-connecting-ip": "13.114.172.128",
          "x-forwarded-for": "203.0.113.9, 13.114.172.128",
          "x-relay-auth": TOKEN
        }
      },
      env
    );
    expect(res.status).toBe(200);
    expect(binds[0]?.[1]).toBe("203.0.113.9");
  });

  it("无任何 IP 头：actor_key 为 anonymous", async () => {
    const { app, env, binds } = buildApp(1, TOKEN);
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    expect(binds[0]?.[1]).toBe("anonymous");
  });

  it("超过 maxRequests 返回 429", async () => {
    const { app, env } = buildApp(6, TOKEN);
    const res = await app.request("/", { headers: { "cf-connecting-ip": "203.0.113.9" } }, env);
    expect(res.status).toBe(429);
  });
});
