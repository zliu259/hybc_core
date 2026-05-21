import type { Env } from "../types/env";

const TOOL_TOKEN_KEY = "wecom:tool-token";
const GROUP_WEBHOOK_PREFIX = "wecom:group-webhook:";

type TokenSource = "kv" | "env" | "none";

export type WeComToolTokenConfig = {
  token: string | null;
  source: TokenSource;
};

export type WeComFrontendConfig = {
  api_base_url: string;
  manifest_url: string;
  call_url: string;
  tool_token_configured: boolean;
  tool_token_source: TokenSource;
};

const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertValidSecretRef = (secretRef: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(secretRef)) {
    throw new Error("Invalid webhook secret ref");
  }
};

const assertValidWeComWebhookUrl = (rawUrl: string): void => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid WeCom webhook URL");
  }

  const valid =
    url.protocol === "https:" &&
    url.hostname === "qyapi.weixin.qq.com" &&
    url.pathname === "/cgi-bin/webhook/send" &&
    Boolean(url.searchParams.get("key"));
  if (!valid) {
    throw new Error("Invalid WeCom webhook URL");
  }
};

export const getConfiguredWeComToolToken = async (env: Env): Promise<WeComToolTokenConfig> => {
  const kvToken = cleanText(await env.KV.get(TOOL_TOKEN_KEY));
  if (kvToken) {
    return { token: kvToken, source: "kv" };
  }

  const envToken = cleanText(env.WECOM_BOT_TOOL_TOKEN);
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: null, source: "none" };
};

export const getWeComFrontendConfig = async (
  env: Env,
  apiBaseUrl: string
): Promise<WeComFrontendConfig> => {
  const token = await getConfiguredWeComToolToken(env);
  return {
    api_base_url: apiBaseUrl,
    manifest_url: `${apiBaseUrl}/tools/manifest`,
    call_url: `${apiBaseUrl}/tools/call`,
    tool_token_configured: Boolean(token.token),
    tool_token_source: token.source
  };
};

export const saveWeComToolToken = async (
  env: Env,
  token: unknown
): Promise<{ configured: true; source: "kv" }> => {
  const cleaned = cleanText(token);
  if (!cleaned || cleaned.length < 16) {
    throw new Error("Tool token must be at least 16 characters");
  }

  await env.KV.put(TOOL_TOKEN_KEY, cleaned);
  return { configured: true, source: "kv" };
};

export const saveWeComGroupWebhook = async (
  env: Env,
  input: {
    secret_ref?: unknown;
    webhook_url?: unknown;
  }
): Promise<{ secret_ref: string; configured: true }> => {
  const secretRef = cleanText(input.secret_ref);
  const webhookUrl = cleanText(input.webhook_url);
  if (!secretRef) {
    throw new Error("webhook secret ref is required");
  }
  if (!webhookUrl) {
    throw new Error("webhook_url is required");
  }
  assertValidSecretRef(secretRef);
  assertValidWeComWebhookUrl(webhookUrl);

  await env.KV.put(`${GROUP_WEBHOOK_PREFIX}${secretRef}`, webhookUrl);
  return { secret_ref: secretRef, configured: true };
};
