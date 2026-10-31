import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { systemRoutes } from "./system";
import type { Env } from "../types/env";

const TOKEN = "0123456789abcdef0123456789abcdef";

const buildApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", systemRoutes);
  return app;
};

// /health 不触碰 DB/KV，只需 APP_ENV 与令牌。
const env = { APP_ENV: "test", RELAY_TRUST_TOKEN: TOKEN } as unknown as Env;

type HealthBody = { ok: boolean; relay_trusted?: boolean };

describe("GET /health relay_trusted", () => {
  it("直连 + 伪造 X-Relay-Auth：relay_trusted 为 false", async () => {
    const res = await buildApp().request(
      "/health",
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
    const body = (await res.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.relay_trusted).toBe(false);
  });

  it("可信中转：relay_trusted 为 true", async () => {
    const res = await buildApp().request(
      "/health",
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
    const body = (await res.json()) as HealthBody;
    expect(body.relay_trusted).toBe(true);
  });
});
