import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { corsMiddleware } from "./cors";

const buildApp = () => {
  const app = new Hono();
  app.use("*", corsMiddleware);
  app.get("/api/v1/things", (c) => c.json({ success: true }));
  return app;
};

describe("corsMiddleware allowHeaders", () => {
  it("relay 回退重试带的 X-Relay-Fallback / X-Relay-Id 必须在预检允许列表里，否则浏览器会拦下重试请求", async () => {
    const res = await buildApp().request("/api/v1/things", {
      method: "OPTIONS",
      headers: {
        origin: "https://web.hybcdg.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization, x-relay-fallback, x-relay-id"
      }
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase());
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("x-relay-fallback");
    expect(allowed).toContain("x-relay-id");
  });

  it("既有允许头保持不变", async () => {
    const res = await buildApp().request("/api/v1/things", {
      method: "OPTIONS",
      headers: {
        origin: "https://web.hybcdg.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, idempotency-key"
      }
    });
    const allowed = (res.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase());
    for (const header of [
      "content-type",
      "authorization",
      "x-requested-with",
      "x-api-key",
      "idempotency-key"
    ]) {
      expect(allowed).toContain(header);
    }
  });
});
