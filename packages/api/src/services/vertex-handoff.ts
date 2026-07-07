import { sign, verify } from "hono/jwt";

import type { AuthTokenPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";

export const VERTEX_HANDOFF_AUDIENCE = "hybc-vertex";
export const VERTEX_HANDOFF_ISSUER = "hybc-core";
export const VERTEX_HANDOFF_TTL_SECONDS = 10 * 60;

export interface VertexHandoffPayload {
  [key: string]: unknown;
  sub: string;
  username: string;
  nickname: string;
  avatar: string;
  roles: UserRole[];
  permissions: string[];
  scopes: string[];
  type: "vertex_handoff";
  aud: typeof VERTEX_HANDOFF_AUDIENCE;
  iss: typeof VERTEX_HANDOFF_ISSUER;
  jti: string;
  hybc_api_base_url: string;
  vertex_base_url: string;
  entry_path: string;
  iat: number;
  exp: number;
}

const handoffKvKey = (jti: string) => `vertex:handoff:${jti}`;

export const canIssueVertexHandoff = (roles: readonly string[]): boolean => {
  return roles.some((role) => ["super_admin", "manager", "site_manager"].includes(role));
};

export const resolveVertexScopes = (roles: readonly string[]): string[] => {
  const scopes = new Set<string>(["vertex:read", "project:read", "edge:read"]);

  if (roles.includes("super_admin")) {
    [
      "vertex:write",
      "edge:control",
      "edge:register",
      "cosmos:read",
      "cosmos:write",
      "dns:write"
    ].forEach((scope) => scopes.add(scope));
  } else if (roles.some((role) => role === "manager" || role === "site_manager")) {
    scopes.add("edge:control");
    scopes.add("edge:register");
  }

  return [...scopes];
};

export const issueVertexHandoff = async (
  env: Env,
  input: {
    auth: AuthTokenPayload;
    hybcApiBaseUrl: string;
    vertexBaseUrl: string;
    entryPath: string;
  }
): Promise<{
  token: string;
  payload: VertexHandoffPayload;
  expiresAt: string;
}> => {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload: VertexHandoffPayload = {
    sub: input.auth.sub,
    username: input.auth.username,
    nickname: input.auth.nickname,
    avatar: input.auth.avatar,
    roles: input.auth.roles,
    permissions: input.auth.permissions,
    scopes: resolveVertexScopes(input.auth.roles),
    type: "vertex_handoff",
    aud: VERTEX_HANDOFF_AUDIENCE,
    iss: VERTEX_HANDOFF_ISSUER,
    jti,
    hybc_api_base_url: input.hybcApiBaseUrl,
    vertex_base_url: input.vertexBaseUrl,
    entry_path: input.entryPath,
    iat: now,
    exp: now + VERTEX_HANDOFF_TTL_SECONDS
  };

  const token = await sign(payload, env.JWT_SECRET);
  await env.KV.put(
    handoffKvKey(jti),
    JSON.stringify({
      sub: payload.sub,
      username: payload.username,
      scopes: payload.scopes,
      vertex_base_url: payload.vertex_base_url,
      entry_path: payload.entry_path,
      issued_at: new Date(now * 1000).toISOString()
    }),
    { expirationTtl: VERTEX_HANDOFF_TTL_SECONDS }
  );

  return {
    token,
    payload,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
};

export const verifyVertexHandoff = async (
  env: Env,
  token: string
): Promise<VertexHandoffPayload> => {
  const decoded = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as VertexHandoffPayload;
  const now = Math.floor(Date.now() / 1000);

  if (
    decoded.type !== "vertex_handoff" ||
    decoded.aud !== VERTEX_HANDOFF_AUDIENCE ||
    decoded.iss !== VERTEX_HANDOFF_ISSUER ||
    !decoded.jti ||
    !decoded.sub ||
    !decoded.exp ||
    decoded.exp <= now
  ) {
    throw new Error("Invalid vertex handoff token");
  }

  const activeSession = await env.KV.get(handoffKvKey(decoded.jti));
  if (!activeSession) {
    throw new Error("Vertex handoff token expired");
  }

  return decoded;
};

export const buildVertexLaunchUrl = (input: {
  vertexBaseUrl: string;
  entryPath: string;
  token: string;
  hybcApiBaseUrl: string;
  expiresAt: string;
}): string => {
  const base = input.vertexBaseUrl.endsWith("/") ? input.vertexBaseUrl : `${input.vertexBaseUrl}/`;
  const url = new URL(input.entryPath || "/", base);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  fragment.set("hybc_handoff_token", input.token);
  fragment.set("hybc_api_base_url", input.hybcApiBaseUrl);
  fragment.set("hybc_handoff_expires_at", input.expiresAt);
  url.hash = fragment.toString();
  return url.toString();
};
