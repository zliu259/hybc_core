import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { issueVertexHandoffCode } from "../services/vertex-handoff";
import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { internalVertexHandoffRoutes } from "./vertex-internal";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const createEnv = () =>
  ({
    JWT_SECRET: "test-secret",
    KV: new MemoryKv()
  }) as unknown as Env & { KV: MemoryKv };

const createAuth = (roles: AuthTokenPayload["roles"]): AuthTokenPayload => ({
  sub: "zihao",
  username: "zihao",
  nickname: "Z Liu",
  avatar: "",
  roles,
  permissions: ["*:*:*"],
  tokenId: "access-token-id",
  type: "access",
  auth_method: "wecom_oauth",
  wecom_verified_at: "2026-07-12T00:00:00.000Z",
  iat: 1,
  exp: 2
});

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/internal/vertex-handoff", internalVertexHandoffRoutes);
  return app;
};

const postExchange = (
  app: ReturnType<typeof createApp>,
  env: Env,
  body: string,
  extraHeaders: Record<string, string> = {}
) => {
  return app.request(
    "/internal/vertex-handoff/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body
    },
    env
  );
};

describe("POST /internal/vertex-handoff/exchange", () => {
  it("returns 200 with the top-level identity JSON for a valid code", async () => {
    const env = createEnv();
    const app = createApp();
    const { code } = await issueVertexHandoffCode(env, createAuth(["super_admin"]));

    const response = await postExchange(app, env, JSON.stringify({ code }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      sub: string;
      username: string;
      roles: string[];
      scopes: string[];
    };
    expect(payload.sub).toBe("zihao");
    expect(payload.username).toBe("zihao");
    expect(Array.isArray(payload.roles)).toBe(true);
    expect(payload.roles.every((role) => typeof role === "string")).toBe(true);
    expect(payload.scopes).toContain("vertex:read");
  });

  it("returns 401 when the same code is replayed", async () => {
    const env = createEnv();
    const app = createApp();
    const { code } = await issueVertexHandoffCode(env, createAuth(["manager"]));

    const first = await postExchange(app, env, JSON.stringify({ code }));
    expect(first.status).toBe(200);

    const replay = await postExchange(app, env, JSON.stringify({ code }));
    expect(replay.status).toBe(401);
  });

  it("returns 401 for an unknown code", async () => {
    const env = createEnv();
    const app = createApp();

    const response = await postExchange(app, env, JSON.stringify({ code: "B".repeat(43) }));

    expect(response.status).toBe(401);
  });

  it("returns 401 when the body is missing a code or is not JSON", async () => {
    const env = createEnv();
    const app = createApp();

    const missing = await postExchange(app, env, JSON.stringify({}));
    expect(missing.status).toBe(401);

    const invalid = await postExchange(app, env, "not-json");
    expect(invalid.status).toBe(401);
  });

  it("returns 404 and leaves the code unconsumed for public-edge requests", async () => {
    const env = createEnv();
    const app = createApp();
    const { code } = await issueVertexHandoffCode(env, createAuth(["super_admin"]));

    const response = await postExchange(app, env, JSON.stringify({ code }), {
      "cf-connecting-ip": "203.0.113.7"
    });

    expect(response.status).toBe(404);
    expect(env.KV.values.has(`vertex:handoff:code:${code}`)).toBe(true);
  });
});
