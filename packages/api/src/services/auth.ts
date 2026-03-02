import { sign, verify } from "hono/jwt";

import type { AuthTokenPayload, LoginResponse, SessionPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";

const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const defaultPermissionsByRole: Record<UserRole, string[]> = {
  super_admin: ["*:*:*"],
  finance: [
    "contract:read",
    "contract:write",
    "payment:read",
    "payment:write",
    "reimbursement:read",
    "reimbursement:write",
    "receipt:read",
    "receipt:write",
    "approval:read",
    "approval:write",
    "upload:write"
  ],
  manager: [
    "entity:read",
    "entity:write",
    "dict:read",
    "dict:write",
    "project:read",
    "project:write",
    "upload:write"
  ],
  site_manager: [
    "entity:read",
    "dict:read",
    "project:read",
    "project:write",
    "upload:write"
  ],
  operator: ["entity:read", "dict:read", "project:read", "upload:write"]
};

const roleFromUsername = (username: string): UserRole => {
  if (username === "super_admin" || username === "admin") {
    return "super_admin";
  }
  if (username === "finance") {
    return "finance";
  }
  if (username === "manager") {
    return "manager";
  }
  if (username === "site_manager") {
    return "site_manager";
  }
  return "operator";
};

const generateTokenId = (): string => {
  return crypto.randomUUID();
};

export const createSessionPayload = (input: {
  userId: string;
  username: string;
  nickname?: string;
  avatar?: string;
  role?: UserRole;
}, metadata?: {
  authMethod?: "wecom_oauth" | "passkey";
  wecomVerifiedAt?: string;
}): SessionPayload => {
  const role = input.role ?? roleFromUsername(input.username);
  const wecomVerifiedAt =
    metadata?.wecomVerifiedAt ??
    new Date().toISOString();
  return {
    userId: input.userId,
    username: input.username,
    nickname: input.nickname ?? input.username,
    avatar: input.avatar?.trim() ?? "",
    roles: [role],
    permissions: defaultPermissionsByRole[role],
    auth_method: metadata?.authMethod ?? "wecom_oauth",
    wecom_verified_at: wecomVerifiedAt
  };
};

export const issueTokens = async (
  env: Env,
  session: SessionPayload
): Promise<LoginResponse["data"]> => {
  const now = Math.floor(Date.now() / 1000);
  const accessTokenId = generateTokenId();
  const refreshTokenId = generateTokenId();

  const accessPayload: AuthTokenPayload = {
    sub: session.userId,
    username: session.username,
    nickname: session.nickname,
    avatar: session.avatar,
    roles: session.roles,
    permissions: session.permissions,
    tokenId: accessTokenId,
    type: "access",
    auth_method: session.auth_method,
    wecom_verified_at: session.wecom_verified_at,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS
  };

  const refreshPayload: AuthTokenPayload = {
    ...accessPayload,
    tokenId: refreshTokenId,
    type: "refresh",
    exp: now + REFRESH_TOKEN_TTL_SECONDS
  };

  const accessToken = await sign(accessPayload, env.JWT_SECRET);
  const refreshToken = await sign(refreshPayload, env.JWT_SECRET);

  await Promise.all([
    env.KV.put(
      `session:access:${accessTokenId}`,
      JSON.stringify({
        userId: session.userId,
        refreshTokenId,
        username: session.username,
        auth_method: session.auth_method
      }),
      { expirationTtl: ACCESS_TOKEN_TTL_SECONDS }
    ),
    env.KV.put(
      `session:refresh:${refreshTokenId}`,
      JSON.stringify({
        userId: session.userId,
        username: session.username,
        nickname: session.nickname,
        avatar: session.avatar,
        roles: session.roles,
        permissions: session.permissions,
        auth_method: session.auth_method,
        wecom_verified_at: session.wecom_verified_at
      }),
      { expirationTtl: REFRESH_TOKEN_TTL_SECONDS }
    )
  ]);

  return {
    avatar: session.avatar,
    username: session.username,
    nickname: session.nickname,
    roles: session.roles,
    permissions: session.permissions,
    auth_method: session.auth_method,
    wecom_verified_at: session.wecom_verified_at,
    accessToken,
    refreshToken,
    expires: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000).toISOString()
  };
};

export const verifyToken = async (
  env: Env,
  token: string
): Promise<AuthTokenPayload> => {
  const decoded = await verify(token, env.JWT_SECRET, "HS256");
  const payload = decoded as unknown as AuthTokenPayload;
  if (!payload.tokenId || !payload.type) {
    throw new Error("Invalid token payload");
  }
  return payload;
};

export const revokeAccessToken = async (
  env: Env,
  tokenId: string
): Promise<void> => {
  await env.KV.delete(`session:access:${tokenId}`);
};

export const getRefreshSession = async (
  env: Env,
  refreshTokenId: string
): Promise<SessionPayload | null> => {
  const raw = await env.KV.get(`session:refresh:${refreshTokenId}`);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as SessionPayload;
  return {
    userId: parsed.userId,
    username: parsed.username,
    nickname: parsed.nickname,
    avatar: parsed.avatar,
    roles: parsed.roles,
    permissions: parsed.permissions,
    auth_method: parsed.auth_method,
    wecom_verified_at: parsed.wecom_verified_at
  };
};

export const toFrontendLoginResponse = (
  data: LoginResponse["data"]
): LoginResponse => {
  return {
    success: true,
    data
  };
};
