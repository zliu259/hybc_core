import type { Env } from "../types/env";

const PASSKEY_FEATURE_KV_KEY = "passkey:feature:config";
const PASSKEY_CHALLENGE_PREFIX = "passkey:challenge";
const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;

type PasskeyFeatureConfig = {
  enabled: boolean;
  rolloutMode: "all" | "none";
};

type ChallengeAction = "register" | "authenticate";

type PasskeyChallengePayload = {
  challenge: string;
  action: ChallengeAction;
  userId: string;
  createdAt: string;
};

const randomChallenge = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const getPasskeyFeatureConfig = async (
  env: Env
): Promise<PasskeyFeatureConfig> => {
  const raw = await env.KV.get(PASSKEY_FEATURE_KV_KEY);
  if (!raw) {
    return {
      enabled: env.APP_ENV === "local",
      rolloutMode: env.APP_ENV === "local" ? "all" : "none"
    };
  }

  const parsed = JSON.parse(raw) as Partial<PasskeyFeatureConfig>;
  return {
    enabled: parsed.enabled === true,
    rolloutMode: parsed.rolloutMode === "all" ? "all" : "none"
  };
};

export const issuePasskeyChallenge = async (
  env: Env,
  action: ChallengeAction,
  userId: string
): Promise<{ challengeId: string; challenge: string }> => {
  const challengeId = crypto.randomUUID();
  const challenge = randomChallenge();
  const payload: PasskeyChallengePayload = {
    challenge,
    action,
    userId,
    createdAt: new Date().toISOString()
  };

  await env.KV.put(
    `${PASSKEY_CHALLENGE_PREFIX}:${challengeId}`,
    JSON.stringify(payload),
    {
      expirationTtl: PASSKEY_CHALLENGE_TTL_SECONDS
    }
  );

  return { challengeId, challenge };
};

export const consumePasskeyChallenge = async (
  env: Env,
  challengeId: string,
  action: ChallengeAction,
  userId: string
): Promise<PasskeyChallengePayload | null> => {
  const key = `${PASSKEY_CHALLENGE_PREFIX}:${challengeId}`;
  const raw = await env.KV.get(key);
  if (!raw) return null;

  await env.KV.delete(key);

  const parsed = JSON.parse(raw) as PasskeyChallengePayload;
  if (parsed.action !== action) return null;
  if (parsed.userId !== userId) return null;
  return parsed;
};

export const writePasskeyAuditLog = async (
  env: Env,
  input: {
    userId: string;
    credentialId?: string;
    action: string;
    success: boolean;
    detail?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO passkey_audit_log (
      user_id,
      credential_id,
      action,
      success,
      detail_json,
      ip,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.userId,
      input.credentialId ?? null,
      input.action,
      input.success ? 1 : 0,
      input.detail ? JSON.stringify(input.detail) : null,
      input.ip ?? null,
      input.userAgent ?? null,
      new Date().toISOString()
    )
    .run();
};
