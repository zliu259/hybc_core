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

// —— v2 门户换码（OAuth 授权码式，经 Service Binding 消费）——
// code 为不透明高熵凭证，身份存 KV、短 TTL、一次性；vertex 侧持有零个 HYBC 密钥。
export const VERTEX_HANDOFF_CODE_TTL_SECONDS = 300;

const handoffCodeKvKey = (code: string) => `vertex:handoff:code:${code}`;

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

export interface VertexHandoffCodeIdentity {
  sub: string;
  username: string;
  roles: string[];
  scopes: string[];
}

const generateHandoffCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const issueVertexHandoffCode = async (
  env: Env,
  auth: AuthTokenPayload
): Promise<{ code: string; identity: VertexHandoffCodeIdentity; expiresAt: string }> => {
  const code = generateHandoffCode();
  const identity: VertexHandoffCodeIdentity = {
    sub: auth.sub,
    username: auth.username,
    roles: [...auth.roles],
    scopes: resolveVertexScopes(auth.roles)
  };

  await env.KV.put(
    handoffCodeKvKey(code),
    JSON.stringify({ ...identity, issued_at: new Date().toISOString() }),
    { expirationTtl: VERTEX_HANDOFF_CODE_TTL_SECONDS }
  );

  return {
    code,
    identity,
    expiresAt: new Date(Date.now() + VERTEX_HANDOFF_CODE_TTL_SECONDS * 1000).toISOString()
  };
};

export const exchangeVertexHandoffCode = async (
  env: Env,
  code: string
): Promise<VertexHandoffCodeIdentity | null> => {
  if (!HANDOFF_CODE_PATTERN.test(code)) {
    return null;
  }

  const key = handoffCodeKvKey(code);
  const raw = await env.KV.get(key);
  if (!raw) {
    return null;
  }

  // 一次性消费：读到即删。KV 全局最终一致，跨节点存在极短的理论竞态窗口；
  // 对高熵、≤5 分钟、正常流程毫秒级即消费的 code 属可接受风险。
  await env.KV.delete(key);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.sub !== "string" || record.sub.length === 0) {
    return null;
  }
  if (typeof record.username !== "string") {
    return null;
  }
  if (!isStringArray(record.roles) || !isStringArray(record.scopes)) {
    return null;
  }

  return {
    sub: record.sub,
    username: record.username,
    roles: record.roles,
    scopes: record.scopes
  };
};

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
