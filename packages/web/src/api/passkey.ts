import { http } from "@/utils/http";

export type PasskeyBeginRegistrationResult = {
  success: boolean;
  data: {
    challengeId: string;
    options: Record<string, unknown>;
    credentialName: string | null;
  };
};

export type PasskeyCredentialRow = {
  credentialId: string;
  counter: number;
  name: string | null;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  status: string;
};

export const beginPasskeyRegistration = (name?: string) => {
  return http.request<PasskeyBeginRegistrationResult>(
    "post",
    "/api/v1/passkeys/register/begin",
    { data: { name } }
  );
};

export const finishPasskeyRegistration = (data: {
  challengeId: string;
  credentialId: string;
  publicKey: string;
  counter?: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
}) => {
  return http.request<{ success: boolean; data: Record<string, unknown> }>(
    "post",
    "/api/v1/passkeys/register/finish",
    { data }
  );
};

export const beginPasskeyAuthentication = (userId?: string) => {
  return http.request<{
    success: boolean;
    data: {
      challengeId: string;
      options: Record<string, unknown>;
    };
  }>("post", "/api/v1/passkeys/auth/begin", {
    data: userId ? { userId } : {}
  });
};

export const finishPasskeyAuthentication = (data: {
  challengeId: string;
  credentialId: string;
  counter?: number;
}) => {
  return http.request<{
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
      expires: Date;
    };
  }>("post", "/api/v1/passkeys/auth/finish", { data });
};

export const listPasskeyCredentials = () => {
  return http.request<{ success: boolean; data: PasskeyCredentialRow[] }>(
    "get",
    "/api/v1/passkeys/credentials"
  );
};

export const revokePasskeyCredential = (credentialId: string) => {
  return http.request<{ success: boolean; data: Record<string, unknown> }>(
    "delete",
    `/api/v1/passkeys/credentials/${encodeURIComponent(credentialId)}`
  );
};
