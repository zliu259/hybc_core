import { describe, expect, it } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import {
  buildVertexLaunchUrl,
  exchangeVertexHandoffCode,
  issueVertexHandoff,
  issueVertexHandoffCode,
  resolveVertexScopes,
  verifyVertexHandoff,
  VERTEX_HANDOFF_CODE_TTL_SECONDS
} from "./vertex-handoff";

class HandoffKv {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

const createEnv = () =>
  ({
    JWT_SECRET: "test-secret",
    KV: new HandoffKv()
  }) as unknown as Env & { KV: HandoffKv };

const createAuth = (roles: AuthTokenPayload["roles"]): AuthTokenPayload => ({
  sub: "zihao",
  username: "zihao",
  nickname: "Z Liu",
  avatar: "",
  roles,
  permissions: roles.includes("super_admin") ? ["*:*:*"] : ["project:read"],
  tokenId: "access-token-id",
  type: "access",
  auth_method: "wecom_oauth",
  wecom_verified_at: "2026-07-07T00:00:00.000Z",
  iat: 1,
  exp: 2
});

describe("vertex handoff", () => {
  it("issues a short-lived token that Vertex can verify through HYBC", async () => {
    const env = createEnv();
    const result = await issueVertexHandoff(env, {
      auth: createAuth(["super_admin"]),
      hybcApiBaseUrl: "https://api.hybcdg.com",
      vertexBaseUrl: "https://vertex.hybcdg.com",
      entryPath: "/control"
    });

    const verified = await verifyVertexHandoff(env, result.token);

    expect(verified.sub).toBe("zihao");
    expect(verified.aud).toBe("hybc-vertex");
    expect(verified.scopes).toContain("cosmos:write");
    expect(env.KV.values.size).toBe(1);
  });

  it("builds launch URLs with handoff data in the fragment only", async () => {
    const launchUrl = buildVertexLaunchUrl({
      vertexBaseUrl: "https://vertex.hybcdg.com",
      entryPath: "/control",
      token: "launch-token",
      hybcApiBaseUrl: "https://api.hybcdg.com",
      expiresAt: "2026-07-07T00:10:00.000Z"
    });
    const url = new URL(launchUrl);
    const hash = new URLSearchParams(url.hash.slice(1));

    expect(`${url.origin}${url.pathname}`).toBe("https://vertex.hybcdg.com/control");
    expect(url.search).toBe("");
    expect(hash.get("hybc_handoff_token")).toBe("launch-token");
    expect(hash.get("hybc_api_base_url")).toBe("https://api.hybcdg.com");
  });

  it("limits non-admin scopes to project and edge operations", () => {
    const scopes = resolveVertexScopes(["site_manager"]);

    expect(scopes).toContain("project:read");
    expect(scopes).toContain("edge:control");
    expect(scopes).not.toContain("cosmos:write");
    expect(scopes).not.toContain("dns:write");
  });
});

describe("vertex handoff code (v2 portal, service-binding exchange)", () => {
  it("issues a high-entropy opaque code and stores the identity in KV with a short TTL", async () => {
    const env = createEnv();
    const result = await issueVertexHandoffCode(env, createAuth(["manager"]));

    expect(result.code).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(VERTEX_HANDOFF_CODE_TTL_SECONDS).toBeLessThanOrEqual(300);

    const key = `vertex:handoff:code:${result.code}`;
    expect(env.KV.ttls.get(key)).toBe(VERTEX_HANDOFF_CODE_TTL_SECONDS);

    const stored = JSON.parse(env.KV.values.get(key) ?? "null") as {
      sub: string;
      username: string;
      roles: string[];
      scopes: string[];
    };
    expect(stored.sub).toBe("zihao");
    expect(stored.username).toBe("zihao");
    expect(Array.isArray(stored.roles)).toBe(true);
    expect(stored.roles).toContain("manager");
    expect(stored.scopes).toContain("vertex:read");
  });

  it("generates a fresh code per issuance", async () => {
    const env = createEnv();
    const first = await issueVertexHandoffCode(env, createAuth(["super_admin"]));
    const second = await issueVertexHandoffCode(env, createAuth(["super_admin"]));

    expect(first.code).not.toBe(second.code);
  });

  it("exchanges a valid code exactly once", async () => {
    const env = createEnv();
    const { code } = await issueVertexHandoffCode(env, createAuth(["super_admin"]));

    const identity = await exchangeVertexHandoffCode(env, code);

    expect(identity).not.toBeNull();
    expect(identity?.sub).toBe("zihao");
    expect(identity?.username).toBe("zihao");
    expect(identity?.roles).toContain("super_admin");
    expect(identity?.scopes).toContain("vertex:read");
    expect(env.KV.values.size).toBe(0);

    const replay = await exchangeVertexHandoffCode(env, code);
    expect(replay).toBeNull();
  });

  it("rejects unknown or malformed codes", async () => {
    const env = createEnv();

    expect(await exchangeVertexHandoffCode(env, "A".repeat(43))).toBeNull();
    expect(await exchangeVertexHandoffCode(env, "")).toBeNull();
    expect(await exchangeVertexHandoffCode(env, "short")).toBeNull();
    expect(await exchangeVertexHandoffCode(env, "bad chars!!:" + "A".repeat(32))).toBeNull();
  });

  it("rejects and still consumes stored identities without a usable sub", async () => {
    const env = createEnv();
    const code = "A".repeat(43);
    const key = `vertex:handoff:code:${code}`;
    env.KV.values.set(
      key,
      JSON.stringify({ sub: "", username: "ghost", roles: [], scopes: ["vertex:read"] })
    );

    expect(await exchangeVertexHandoffCode(env, code)).toBeNull();
    expect(env.KV.values.has(key)).toBe(false);
  });
});
