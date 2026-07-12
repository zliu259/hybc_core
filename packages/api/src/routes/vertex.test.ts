import { Hono } from "hono";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";

import type { AuthTokenPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";
import { vertexRoutes } from "./vertex";

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

const JWT_SECRET = "test-secret";

const createEnv = () =>
  ({
    JWT_SECRET,
    KV: new MemoryKv()
  }) as unknown as Env & { KV: MemoryKv };

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/v1/vertex", vertexRoutes);
  return app;
};

const createAccessToken = async (env: Env & { KV: MemoryKv }, roles: UserRole[]) => {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
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
    iat: now,
    exp: now + 3600
  };
  await env.KV.put(
    `session:access:${payload.tokenId}`,
    JSON.stringify({ userId: payload.sub, username: payload.username })
  );
  return sign(payload, JWT_SECRET);
};

const postHandoffCode = (
  app: ReturnType<typeof createApp>,
  env: Env,
  token: string,
  body: Record<string, unknown> = {}
) => {
  return app.request(
    "/api/v1/vertex/handoff/code",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    },
    env
  );
};

type HandoffCodeResponse = {
  success: boolean;
  data: {
    code: string;
    redirect_url: string;
    expires_at: string;
    expires_in_seconds: number;
    vertex_base_url: string;
    scopes: string[];
  };
};

describe("POST /api/v1/vertex/handoff/code", () => {
  it("issues an opaque code and a vertex-beta redirect URL for privileged roles", async () => {
    const env = createEnv();
    const app = createApp();
    const token = await createAccessToken(env, ["manager"]);

    const response = await postHandoffCode(app, env, token);

    expect(response.status).toBe(200);
    const body = (await response.json()) as HandoffCodeResponse;
    expect(body.success).toBe(true);
    expect(body.data.code).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(body.data.redirect_url).toBe(
      `https://vertex-beta.hybcdg.com/portal/handoff?code=${body.data.code}`
    );
    expect(body.data.scopes).toContain("vertex:read");
    expect(body.data.expires_in_seconds).toBeGreaterThan(0);
    expect(body.data.expires_in_seconds).toBeLessThanOrEqual(300);

    const stored = env.KV.values.get(`vertex:handoff:code:${body.data.code}`);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored ?? "null").scopes).toContain("vertex:read");
  });

  it("honors a custom vertex base URL", async () => {
    const env = createEnv();
    const app = createApp();
    const token = await createAccessToken(env, ["super_admin"]);

    const response = await postHandoffCode(app, env, token, {
      vertexBaseUrl: "http://localhost:8788"
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as HandoffCodeResponse;
    expect(body.data.redirect_url).toBe(
      `http://localhost:8788/portal/handoff?code=${body.data.code}`
    );
  });

  it("rejects roles that cannot issue a vertex handoff", async () => {
    const env = createEnv();
    const app = createApp();
    const token = await createAccessToken(env, ["operator"]);

    const response = await postHandoffCode(app, env, token);

    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const env = createEnv();
    const app = createApp();

    const response = await app.request(
      "/api/v1/vertex/handoff/code",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      },
      env
    );

    expect(response.status).toBe(401);
  });
});
