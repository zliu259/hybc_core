import type { Env } from "../types/env";

export type WeComDepartment = {
  id: number;
  name: string;
  parentid: number;
  order: number;
};

export type WeComUser = {
  userid: string;
  name: string;
  department: number[];
  mobile?: string;
  email?: string;
  avatar?: string;
  status?: number;
};

export type WeComContactBook = {
  syncedAt: string;
  departments: WeComDepartment[];
  users: WeComUser[];
};

const CONTACT_BOOK_KV_KEY = "wecom:contact-book:v1";
const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
const TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;
const CONTACT_BOOK_REFRESH_INTERVAL_SECONDS = 60 * 60;

const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const normalizeBridgeProxyUrl = (env: Env): string | null => {
  const explicit = env.WECHAT_BRIDGE_PROXY_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const base = env.WECHAT_BRIDGE_BASE_URL?.trim();
  if (!base) return null;
  const normalized = base.replace(/\/$/, "");
  if (normalized.endsWith("/wecom/proxy")) return normalized;
  return `${normalized}/wecom/proxy`;
};

const fetchViaBridgeStrict = async <T>(
  env: Env,
  targetUrl: string
): Promise<T> => {
  const proxyUrl = normalizeBridgeProxyUrl(env);
  if (!proxyUrl) {
    throw new Error("WECHAT_BRIDGE_BASE_URL/WECHAT_BRIDGE_PROXY_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (env.WECHAT_BRIDGE_TOKEN) {
    headers["x-bridge-token"] = env.WECHAT_BRIDGE_TOKEN;
  }

  const resp = await fetch(proxyUrl, {
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

const getCachedString = async (env: Env, key: string): Promise<string | null> => {
  return env.KV.get(key);
};

const putCachedString = async (
  env: Env,
  key: string,
  value: string,
  expiresInSeconds?: number
) => {
  const ttl = Math.max(60, (expiresInSeconds ?? TOKEN_DEFAULT_TTL_SECONDS) - 300);
  await env.KV.put(key, value, { expirationTtl: ttl });
};

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenJson = await fetchViaBridgeStrict<{
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );
  if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
    throw new Error(
      weComErrorMessage(tokenJson.errmsg, "Failed to get WeCom access_token")
    );
  }

  await putCachedString(
    env,
    ACCESS_TOKEN_KV_KEY,
    tokenJson.access_token,
    tokenJson.expires_in
  );

  return tokenJson.access_token;
};

const getDepartmentList = async (
  env: Env,
  accessToken: string
): Promise<WeComDepartment[]> => {
  const json = await fetchViaBridgeStrict<{
    errcode?: number;
    errmsg?: string;
    department?: WeComDepartment[];
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(accessToken)}`
  );

  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to fetch department list")
    );
  }

  return json.department ?? [];
};

const getUsersByDepartment = async (
  env: Env,
  accessToken: string,
  departmentId: number
): Promise<WeComUser[]> => {
  const json = await fetchViaBridgeStrict<{
    errcode?: number;
    errmsg?: string;
    userlist?: WeComUser[];
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/user/simplelist?access_token=${encodeURIComponent(accessToken)}&department_id=${departmentId}&fetch_child=0`
  );

  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to fetch users by department")
    );
  }

  return json.userlist ?? [];
};

const parseContactBook = (raw: string | null): WeComContactBook | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WeComContactBook;
    if (!parsed.syncedAt || !Array.isArray(parsed.departments) || !Array.isArray(parsed.users)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const isBookStale = (book: WeComContactBook): boolean => {
  const syncedAtMs = Date.parse(book.syncedAt);
  if (!Number.isFinite(syncedAtMs)) return true;
  const ageMs = Date.now() - syncedAtMs;
  return ageMs > CONTACT_BOOK_REFRESH_INTERVAL_SECONDS * 1000;
};

export const syncWeComContactBook = async (env: Env): Promise<WeComContactBook> => {
  const accessToken = await fetchWeComAccessToken(env);
  const departments = await getDepartmentList(env, accessToken);

  const userMap = new Map<string, WeComUser>();
  for (const department of departments) {
    const users = await getUsersByDepartment(env, accessToken, department.id);
    users.forEach((user) => {
      userMap.set(user.userid, user);
    });
  }

  const payload: WeComContactBook = {
    syncedAt: new Date().toISOString(),
    departments,
    users: [...userMap.values()]
  };

  await env.KV.put(CONTACT_BOOK_KV_KEY, JSON.stringify(payload));
  return payload;
};

export const getWeComContactBook = async (
  env: Env,
  options?: { forceRefresh?: boolean; allowStaleOnRefreshError?: boolean }
): Promise<WeComContactBook> => {
  const forceRefresh = options?.forceRefresh ?? false;
  const allowStaleOnRefreshError = options?.allowStaleOnRefreshError ?? true;

  const cached = parseContactBook(await env.KV.get(CONTACT_BOOK_KV_KEY));
  if (!forceRefresh && cached && !isBookStale(cached)) {
    return cached;
  }

  try {
    return await syncWeComContactBook(env);
  } catch (error) {
    if (cached && allowStaleOnRefreshError) {
      return cached;
    }
    throw error;
  }
};
