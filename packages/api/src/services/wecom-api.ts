/**
 * 企业微信 HTTP 底层：桥接代理/直连、access_token 缓存。
 * 从 routes/auth.ts 抽出，供登录路由与 wecom-role.ts（角色解析）共用。
 * 注意 wecom-contact-book.ts 仍保留一份 bridge-strict 的令牌获取，本次不合并。
 */
import type { Env } from "../types/env";

export type WeComTokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

export const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const normalizeBridgeProxyUrl = (env: Env): string | null => {
  const explicit = env.WECHAT_BRIDGE_PROXY_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const base = env.WECHAT_BRIDGE_BASE_URL?.trim();
  if (!base) return null;
  const normalized = base.replace(/\/$/, "");
  if (normalized.endsWith("/wecom/proxy")) return normalized;
  return `${normalized}/wecom/proxy`;
};

const fetchViaBridge = async <T>(
  proxyUrl: string,
  targetUrl: string,
  headers: Record<string, string>
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const requestUrl = `${proxyUrl}${proxyUrl.includes("?") ? "&" : "?"}bridge=1`;
  const resp = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: targetUrl }),
    redirect: "manual",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location") ?? "";
    throw new Error(`bridge redirected ${resp.status}${location ? ` to ${location}` : ""}`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`bridge response ${resp.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
};

const fetchDirectWeComJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const resp = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`wecom response ${resp.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
};

export const fetchWeComJson = async <T>(env: Env, url: string): Promise<T> => {
  const proxyUrl = normalizeBridgeProxyUrl(env);
  if (proxyUrl) {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (env.WECHAT_BRIDGE_TOKEN) {
      headers["x-bridge-token"] = env.WECHAT_BRIDGE_TOKEN;
    }
    try {
      return await fetchViaBridge<T>(proxyUrl, url, headers);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "bridge fetch failed";
      if (
        reason.includes("redirect") ||
        reason.includes("abort") ||
        reason.includes("Too many redirects")
      ) {
        return fetchDirectWeComJson<T>(url);
      }
      throw error;
    }
  }

  return fetchDirectWeComJson<T>(url);
};

export const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
export const TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;

export const getCachedString = async (env: Env, key: string): Promise<string | null> => {
  return env.KV.get(key);
};

export const putCachedString = async (
  env: Env,
  key: string,
  value: string,
  expiresInSeconds?: number
) => {
  const ttl = Math.max(60, (expiresInSeconds ?? TOKEN_DEFAULT_TTL_SECONDS) - 300);
  await env.KV.put(key, value, { expirationTtl: ttl });
};

export const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenJson = await fetchWeComJson<WeComTokenResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );
  if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
    throw new Error(weComErrorMessage(tokenJson.errmsg, "Failed to get WeCom access_token"));
  }

  await putCachedString(env, ACCESS_TOKEN_KV_KEY, tokenJson.access_token, tokenJson.expires_in);

  return tokenJson.access_token;
};
