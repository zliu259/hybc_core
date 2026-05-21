import type { Env } from "../types/env";
import type { WeComGroupChatDirectoryItem, WeComGroupChatType } from "../types/wecom-tools";

const nowIso = () => new Date().toISOString();

const allowedChatTypes = new Set<WeComGroupChatType>([
  "internal",
  "external_customer_group",
  "discovered",
  "manual"
]);

export interface WeComGroupChatInput {
  chat_id: string;
  chat_name: string;
  chat_type?: WeComGroupChatType;
  owner_userid?: string | null;
  source?: string;
  webhook_secret_ref?: string | null;
  raw_json?: unknown;
  last_synced_at?: string | null;
}

export interface ListWeComGroupChatsOptions {
  keyword?: string | null;
  includeInactive?: boolean;
  limit?: number;
}

type WeComAccessTokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

type ExternalGroupListItem = {
  chat_id?: string;
  name?: string;
  owner?: string;
  status?: number;
};

export type ExternalGroupListResponse = {
  errcode?: number;
  errmsg?: string;
  group_chat_list?: ExternalGroupListItem[];
  next_cursor?: string;
};

export type WeComExternalGroupFetcher = (input: {
  accessToken: string;
  cursor?: string;
}) => Promise<ExternalGroupListResponse>;

const ACCESS_TOKEN_KV_KEY = "wecom:customer-contact-access-token:v1";

const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeChatType = (value: unknown): WeComGroupChatType => {
  return typeof value === "string" && allowedChatTypes.has(value as WeComGroupChatType)
    ? (value as WeComGroupChatType)
    : "manual";
};

const isMissingGroupChatMigrationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("wecom_group_chat_directory");
};

const validateInput = (input: WeComGroupChatInput): void => {
  if (!cleanText(input.chat_id)) {
    throw new Error("chat_id is required");
  }
  if (!cleanText(input.chat_name)) {
    throw new Error("chat_name is required");
  }
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

const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const putCachedString = async (env: Env, key: string, value: string, expiresInSeconds?: number) => {
  const ttl = Math.max(60, (expiresInSeconds ?? 3600) - 300);
  await env.KV.put(key, value, { expirationTtl: ttl });
};

const fetchJson = async <T>(
  env: Env,
  targetUrl: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const proxyUrl = normalizeBridgeProxyUrl(env);
  const method = init?.method ?? "GET";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    if (proxyUrl) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (env.WECHAT_BRIDGE_TOKEN) {
        headers["x-bridge-token"] = env.WECHAT_BRIDGE_TOKEN;
      }

      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: targetUrl,
          method,
          body: init?.body
        }),
        redirect: "manual",
        signal: controller.signal
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`bridge response ${resp.status}: ${text.slice(0, 300)}`);
      }

      return (await resp.json()) as T;
    }

    const resp = await fetch(targetUrl, {
      method,
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`WeCom response ${resp.status}: ${text.slice(0, 300)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

const getCustomerContactAccessToken = async (env: Env): Promise<string> => {
  const cached = await env.KV.get(ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  const secret = env.WECHAT_CUSTOMER_CONTACT_SECRET?.trim() || env.WECHAT_SECRET?.trim();
  if (!env.WECHAT_CORPID || !secret) {
    throw new Error("WECHAT_CORPID/WECHAT_CUSTOMER_CONTACT_SECRET is not configured");
  }

  const json = await fetchJson<WeComAccessTokenResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
      env.WECHAT_CORPID
    )}&corpsecret=${encodeURIComponent(secret)}`
  );
  if (json.errcode !== 0 || !json.access_token) {
    throw new Error(weComErrorMessage(json.errmsg, "Failed to get WeCom access_token"));
  }

  await putCachedString(env, ACCESS_TOKEN_KV_KEY, json.access_token, json.expires_in);
  return json.access_token;
};

const defaultExternalGroupFetcher =
  (env: Env): WeComExternalGroupFetcher =>
  async ({ accessToken, cursor }) => {
    return fetchJson<ExternalGroupListResponse>(
      env,
      `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/list?access_token=${encodeURIComponent(
        accessToken
      )}`,
      {
        method: "POST",
        body: {
          status_filter: 0,
          cursor,
          limit: 1000
        }
      }
    );
  };

export const upsertWeComGroupChat = async (
  env: Env,
  input: WeComGroupChatInput
): Promise<WeComGroupChatDirectoryItem> => {
  validateInput(input);

  const now = nowIso();
  const chatId = cleanText(input.chat_id);
  const chatName = cleanText(input.chat_name);
  const chatType = normalizeChatType(input.chat_type);
  const ownerUserid = cleanText(input.owner_userid);
  const source = cleanText(input.source) ?? "manual";
  const webhookSecretRef = cleanText(input.webhook_secret_ref);
  const rawJson = input.raw_json === undefined ? null : JSON.stringify(input.raw_json);
  const lastSyncedAt = cleanText(input.last_synced_at);

  await env.DB.prepare(
    `INSERT INTO wecom_group_chat_directory
      (chat_id, chat_name, chat_type, owner_userid, source, webhook_secret_ref, status,
       raw_json, last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       chat_name = excluded.chat_name,
       chat_type = excluded.chat_type,
       owner_userid = excluded.owner_userid,
       source = excluded.source,
       webhook_secret_ref = COALESCE(excluded.webhook_secret_ref, wecom_group_chat_directory.webhook_secret_ref),
       status = 'active',
       raw_json = excluded.raw_json,
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      chatId,
      chatName,
      chatType,
      ownerUserid,
      source,
      webhookSecretRef,
      rawJson,
      lastSyncedAt,
      now,
      now
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM wecom_group_chat_directory WHERE chat_id = ?")
    .bind(chatId)
    .first<WeComGroupChatDirectoryItem>();

  if (!row) {
    throw new Error("Failed to save WeCom group chat");
  }
  return row;
};

export const listWeComGroupChats = async (
  env: Env,
  options: ListWeComGroupChatsOptions = {}
): Promise<WeComGroupChatDirectoryItem[]> => {
  const keyword = cleanText(options.keyword);
  const includeInactive = options.includeInactive === true;
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 200);

  try {
    if (keyword) {
      const likeKeyword = `%${keyword}%`;
      const rows = await env.DB.prepare(
        `SELECT * FROM wecom_group_chat_directory
          WHERE (? = 1 OR status = 'active')
            AND (chat_name LIKE ? OR chat_id LIKE ? OR owner_userid LIKE ?)
          ORDER BY updated_at DESC, id DESC
          LIMIT ?`
      )
        .bind(includeInactive ? 1 : 0, likeKeyword, likeKeyword, likeKeyword, limit)
        .all<WeComGroupChatDirectoryItem>();
      return rows.results ?? [];
    }

    const rows = await env.DB.prepare(
      `SELECT * FROM wecom_group_chat_directory
        WHERE (? = 1 OR status = 'active')
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`
    )
      .bind(includeInactive ? 1 : 0, limit)
      .all<WeComGroupChatDirectoryItem>();
    return rows.results ?? [];
  } catch (error) {
    if (isMissingGroupChatMigrationError(error)) return [];
    throw error;
  }
};

export const syncExternalWeComGroupChats = async (
  env: Env,
  options: { fetcher?: WeComExternalGroupFetcher } = {}
): Promise<{ synced: number; skipped: number }> => {
  const accessToken = options.fetcher
    ? "test-access-token"
    : await getCustomerContactAccessToken(env);
  const fetcher = options.fetcher ?? defaultExternalGroupFetcher(env);
  let cursor: string | undefined;
  let synced = 0;
  let skipped = 0;

  do {
    const json = await fetcher({ accessToken, cursor });
    if (json.errcode !== 0) {
      throw new Error(weComErrorMessage(json.errmsg, "Failed to sync WeCom external group chats"));
    }

    const syncedAt = nowIso();
    for (const item of json.group_chat_list ?? []) {
      const chatId = cleanText(item.chat_id);
      if (!chatId || item.status === 1) {
        skipped += 1;
        continue;
      }

      await upsertWeComGroupChat(env, {
        chat_id: chatId,
        chat_name: cleanText(item.name) ?? chatId,
        chat_type: "external_customer_group",
        owner_userid: item.owner ?? null,
        source: "external_sync",
        raw_json: item,
        last_synced_at: syncedAt
      });
      synced += 1;
    }

    cursor = cleanText(json.next_cursor) ?? undefined;
  } while (cursor);

  return { synced, skipped };
};
