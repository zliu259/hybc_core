export const roles = [
  "super_admin",
  "finance",
  "manager",
  "site_manager",
  "operator"
] as const;

export type UserRole = (typeof roles)[number];

export interface AuthTokenPayload {
  [key: string]: unknown;
  sub: string;
  username: string;
  nickname: string;
  avatar: string;
  roles: UserRole[];
  permissions: string[];
  tokenId: string;
  type: "access" | "refresh";
  auth_method: "wecom_oauth" | "passkey" | "mcp_agent";
  wecom_verified_at: string;
  via?: "mcp";
  grant_id?: string;
  exp: number;
  iat: number;
}

export interface SessionPayload {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  roles: UserRole[];
  permissions: string[];
  auth_method: "wecom_oauth" | "passkey";
  wecom_verified_at: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    avatar: string;
    username: string;
    nickname: string;
    roles: string[];
    permissions: string[];
    auth_method: "wecom_oauth" | "passkey";
    wecom_verified_at: string;
    accessToken: string;
    refreshToken: string;
    expires: string;
  };
}
