import { describe, expect, it } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import {
  buildVertexLaunchUrl,
  issueVertexHandoff,
  resolveVertexScopes,
  verifyVertexHandoff
} from "./vertex-handoff";

class HandoffKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
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
