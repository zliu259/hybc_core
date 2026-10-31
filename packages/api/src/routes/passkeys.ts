import { resolveClientIp } from "../utils/client-ip";
import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createSessionPayload, issueTokens, toFrontendLoginResponse } from "../services/auth";
import {
  consumePasskeyChallenge,
  getPasskeyFeatureConfig,
  issuePasskeyChallenge,
  writePasskeyAuditLog
} from "../services/passkey";
import type { Env } from "../types/env";
import type { UserRole } from "../types/auth";

type RegistrationBeginBody = {
  name?: string;
};

type RegistrationFinishBody = {
  challengeId?: string;
  credentialId?: string;
  publicKey?: string;
  counter?: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
};

type AuthenticationBeginBody = {
  userId?: string;
};

type AuthenticationFinishBody = {
  challengeId?: string;
  userId?: string;
  credentialId?: string;
  counter?: number;
};

type DbPasskeyCredential = {
  id: number;
  user_id: string;
  credential_id: string;
  counter: number;
  name: string | null;
  transports_json: string | null;
  created_at: string;
  last_used_at: string | null;
  wecom_verified_at: string;
  status: string;
};

const unauthorizedResponse = (message: string, code = 401) => {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message
      }
    }),
    {
      status: code,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

const badRequest = (message: string) => {
  return {
    success: false,
    error: {
      message
    }
  };
};

const getRequestMeta = (c: { req: { raw: Request }; env: Env }) => {
  return {
    ip: resolveClientIp(c.req.raw.headers, c.env),
    userAgent: c.req.raw.headers.get("user-agent") ?? undefined
  };
};

const ensureFeatureEnabled = async (c: { env: Env }) => {
  const config = await getPasskeyFeatureConfig(c.env);
  return config.enabled && config.rolloutMode === "all";
};

const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
const PASSKEY_DISCOVERABLE_USER = "__discoverable__";
const rolePriority: UserRole[] = ["super_admin", "finance", "manager", "site_manager", "operator"];

const defaultRoleTagMapping: Record<UserRole, string[]> = {
  super_admin: ["HY_ROLE_SUPER_ADMIN"],
  finance: ["HY_ROLE_FINANCE"],
  manager: ["HY_ROLE_MANAGER"],
  site_manager: ["HY_ROLE_SITE_MANAGER"],
  operator: ["HY_ROLE_OPERATOR"]
};

const parseRoleTagMapping = (raw?: string): Record<UserRole, string[]> => {
  if (!raw?.trim()) return defaultRoleTagMapping;

  const parsed: Record<UserRole, string[]> = {
    super_admin: [],
    finance: [],
    manager: [],
    site_manager: [],
    operator: []
  };

  for (const item of raw.split(";")) {
    const [roleRaw, tagsRaw] = item.split(":");
    const role = (roleRaw || "").trim() as UserRole;
    if (!rolePriority.includes(role)) continue;
    const tags = (tagsRaw || "")
      .split(/[|,]/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (tags.length > 0) {
      parsed[role] = tags;
    }
  }

  return {
    super_admin:
      parsed.super_admin.length > 0
        ? parsed.super_admin
        : defaultRoleTagMapping.super_admin,
    finance:
      parsed.finance.length > 0 ? parsed.finance : defaultRoleTagMapping.finance,
    manager:
      parsed.manager.length > 0 ? parsed.manager : defaultRoleTagMapping.manager,
    site_manager:
      parsed.site_manager.length > 0
        ? parsed.site_manager
        : defaultRoleTagMapping.site_manager,
    operator:
      parsed.operator.length > 0
        ? parsed.operator
        : defaultRoleTagMapping.operator
  };
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

const fetchWeComJson = async <T>(env: Env, url: string): Promise<T> => {
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

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await env.KV.get(ACCESS_TOKEN_KV_KEY);
  if (cached) {
    return cached;
  }

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_OAUTH_CONFIG_MISSING");
  }

  const json = await fetchWeComJson<{
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );

  if (json.errcode !== 0 || !json.access_token) {
    throw new Error(`Failed to get WeCom access token: ${json.errmsg ?? "unknown"}`);
  }

  const ttl = Math.max((json.expires_in ?? 7200) - 120, 300);
  await env.KV.put(ACCESS_TOKEN_KV_KEY, json.access_token, { expirationTtl: ttl });
  return json.access_token;
};

const isUserInTag = async (
  env: Env,
  accessToken: string,
  tagId: number,
  userId: string
): Promise<boolean> => {
  const json = await fetchWeComJson<{
    errcode?: number;
    errmsg?: string;
    userlist?: Array<{ userid?: string }>;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/get?access_token=${encodeURIComponent(accessToken)}&tagid=${tagId}`
  );

  if (json.errcode !== 0) {
    throw new Error(`Failed to get WeCom tag members: ${json.errmsg ?? "unknown"}`);
  }
  return (json.userlist ?? []).some((item) => item.userid === userId);
};

const resolveRoleByWeComTags = async (env: Env, userId: string): Promise<UserRole | undefined> => {
  const mapping = parseRoleTagMapping(env.WECHAT_ROLE_TAG_MAPPING);

  const accessToken = await fetchWeComAccessToken(env);
  const tagList = await fetchWeComJson<{
    errcode?: number;
    errmsg?: string;
    taglist?: Array<{ tagid: number; tagname: string }>;
  }>(env, `https://qyapi.weixin.qq.com/cgi-bin/tag/list?access_token=${encodeURIComponent(accessToken)}`);

  if (tagList.errcode !== 0) {
    throw new Error(`Failed to list WeCom tags: ${tagList.errmsg ?? "unknown"}`);
  }

  const tagIdByName = new Map<string, number>();
  for (const tag of tagList.taglist ?? []) {
    tagIdByName.set(tag.tagname, tag.tagid);
  }

  for (const role of rolePriority) {
    for (const tagName of mapping[role] ?? []) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) continue;
      const matched = await isUserInTag(env, accessToken, tagId, userId);
      if (matched) return role;
    }
  }

  return undefined;
};

export const passkeyRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

passkeyRoutes.use("/register/*", authMiddleware);
passkeyRoutes.use("/credentials/*", authMiddleware);

passkeyRoutes.post("/register/begin", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as RegistrationBeginBody;
  const { challengeId, challenge } = await issuePasskeyChallenge(
    c.env,
    "register",
    auth.sub
  );

  const existing = await c.env.DB.prepare(
    `SELECT credential_id FROM passkey_credentials
     WHERE user_id = ? AND status = 'active'
     ORDER BY id DESC`
  )
    .bind(auth.sub)
    .all<{ credential_id: string }>();

  return c.json({
    success: true,
    data: {
      challengeId,
      options: {
        challenge,
        rp: {
          id: c.env.PASSKEY_RP_ID,
          name: c.env.PASSKEY_RP_NAME
        },
        user: {
          id: auth.sub,
          name: auth.username,
          displayName: auth.nickname
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred"
        },
        excludeCredentials: existing.results.map((item) => ({
          id: item.credential_id,
          type: "public-key"
        })),
        extensions: {
          credProps: true
        }
      },
      credentialName: body.name?.trim() || null
    }
  });
});

passkeyRoutes.post("/register/finish", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as RegistrationFinishBody;
  const { ip, userAgent } = getRequestMeta(c);

  if (!body.challengeId || !body.credentialId || !body.publicKey) {
    return c.json(badRequest("Missing challengeId/credentialId/publicKey"), 400);
  }

  const challenge = await consumePasskeyChallenge(
    c.env,
    body.challengeId,
    "register",
    auth.sub
  );
  if (!challenge) {
    await writePasskeyAuditLog(c.env, {
      userId: auth.sub,
      credentialId: body.credentialId,
      action: "register_finish",
      success: false,
      detail: { reason: "challenge_invalid_or_expired" },
      ip,
      userAgent
    });
    return c.json(badRequest("Challenge invalid or expired"), 400);
  }

  const now = new Date().toISOString();
  const publicKeyBytes = new TextEncoder().encode(body.publicKey);

  await c.env.DB.prepare(
    `INSERT INTO passkey_credentials (
      user_id,
      credential_id,
      public_key,
      counter,
      transports_json,
      device_type,
      backed_up,
      name,
      wecom_verified_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(
      auth.sub,
      body.credentialId,
      publicKeyBytes,
      body.counter ?? 0,
      body.transports ? JSON.stringify(body.transports) : null,
      body.deviceType ?? null,
      body.backedUp ? 1 : 0,
      null,
      now,
      now,
      now
    )
    .run();

  await writePasskeyAuditLog(c.env, {
    userId: auth.sub,
    credentialId: body.credentialId,
    action: "register_finish",
    success: true,
    detail: { challengeCreatedAt: challenge.createdAt },
    ip,
    userAgent
  });

  return c.json({
    success: true,
    data: {
      credentialId: body.credentialId,
      userId: auth.sub,
      createdAt: now
    }
  });
});

passkeyRoutes.post("/auth/begin", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as AuthenticationBeginBody;
  const userId = body.userId?.trim() || null;
  let credentials: { results: Array<{ credential_id: string }> } = { results: [] };
  if (userId) {
    credentials = await c.env.DB.prepare(
      `SELECT credential_id FROM passkey_credentials
       WHERE user_id = ? AND status = 'active'
       ORDER BY id DESC`
    )
      .bind(userId)
      .all<{ credential_id: string }>();

    if (!credentials.results.length) {
      return c.json(badRequest("No passkey credential enrolled for this user"), 404);
    }
  }

  const challengeUserId = userId ?? PASSKEY_DISCOVERABLE_USER;

  const { challengeId, challenge } = await issuePasskeyChallenge(
    c.env,
    "authenticate",
    challengeUserId
  );

  return c.json({
    success: true,
    data: {
      challengeId,
      options: {
        challenge,
        timeout: 60000,
        rpId: c.env.PASSKEY_RP_ID,
        userVerification: "preferred",
        ...(userId
          ? {
              allowCredentials: credentials.results.map((item) => ({
                id: item.credential_id,
                type: "public-key"
              }))
            }
          : {})
      }
    }
  });
});

passkeyRoutes.post("/auth/finish", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as AuthenticationFinishBody;
  const { ip, userAgent } = getRequestMeta(c);

  if (!body.challengeId || !body.credentialId) {
    return c.json(badRequest("Missing challengeId/credentialId"), 400);
  }

  const requestedUserId = body.userId?.trim() || null;
  const challengeUserId = requestedUserId ?? PASSKEY_DISCOVERABLE_USER;

  const challenge = await consumePasskeyChallenge(
    c.env,
    body.challengeId,
    "authenticate",
    challengeUserId
  );
  if (!challenge) {
    await writePasskeyAuditLog(c.env, {
      userId: requestedUserId ?? "unknown",
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: { reason: "challenge_invalid_or_expired" },
      ip,
      userAgent
    });
    return c.json(badRequest("Challenge invalid or expired"), 400);
  }

  const credential = requestedUserId
    ? await c.env.DB.prepare(
        `SELECT id, user_id, credential_id, counter, name, transports_json, created_at, last_used_at, wecom_verified_at, status
         FROM passkey_credentials
         WHERE user_id = ? AND credential_id = ? AND status = 'active'
         LIMIT 1`
      )
        .bind(requestedUserId, body.credentialId)
        .first<DbPasskeyCredential>()
    : await c.env.DB.prepare(
        `SELECT id, user_id, credential_id, counter, name, transports_json, created_at, last_used_at, wecom_verified_at, status
         FROM passkey_credentials
         WHERE credential_id = ? AND status = 'active'
         LIMIT 1`
      )
        .bind(body.credentialId)
        .first<DbPasskeyCredential>();

  if (!credential) {
    await writePasskeyAuditLog(c.env, {
      userId: requestedUserId ?? "unknown",
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: { reason: "credential_not_found" },
      ip,
      userAgent
    });
    return c.json(badRequest("Credential not found"), 404);
  }

  const nextCounter = body.counter ?? credential.counter + 1;
  if (nextCounter <= credential.counter) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE passkey_credentials
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, credential.id)
      .run();

    await writePasskeyAuditLog(c.env, {
      userId: credential.user_id,
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: {
        reason: "counter_regression",
        previousCounter: credential.counter,
        providedCounter: nextCounter
      },
      ip,
      userAgent
    });

    return c.json(badRequest("Invalid credential counter"), 401);
  }

  const usedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE passkey_credentials
     SET counter = ?, last_used_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(nextCounter, usedAt, usedAt, credential.id)
    .run();

  const resolvedRole = await resolveRoleByWeComTags(c.env, credential.user_id).catch(
    () => undefined
  );

  const session = createSessionPayload(
    {
      userId: credential.user_id,
      username: credential.user_id,
      nickname: credential.user_id,
      role: resolvedRole
    },
    {
      authMethod: "passkey",
      wecomVerifiedAt: credential.wecom_verified_at
    }
  );
  const tokenBundle = await issueTokens(c.env, session);

  await writePasskeyAuditLog(c.env, {
    userId: credential.user_id,
    credentialId: body.credentialId,
    action: "auth_finish",
    success: true,
    detail: { challengeCreatedAt: challenge.createdAt, usedAt },
    ip,
    userAgent
  });

  return c.json(toFrontendLoginResponse(tokenBundle));
});

passkeyRoutes.get("/credentials", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const rows = await c.env.DB.prepare(
    `SELECT credential_id, counter, name, transports_json, created_at, last_used_at, status
     FROM passkey_credentials
     WHERE user_id = ?
     ORDER BY id DESC`
  )
    .bind(auth.sub)
    .all<DbPasskeyCredential>();

  return c.json({
    success: true,
    data: rows.results.map((item) => ({
      credentialId: item.credential_id,
      counter: item.counter,
      name: item.name,
      transports: item.transports_json ? (JSON.parse(item.transports_json) as string[]) : [],
      createdAt: item.created_at,
      lastUsedAt: item.last_used_at,
      status: item.status
    }))
  });
});

passkeyRoutes.delete("/credentials/:credentialId", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const credentialId = c.req.param("credentialId").trim();
  if (!credentialId) {
    return c.json(badRequest("Missing credentialId"), 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE passkey_credentials
     SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE user_id = ? AND credential_id = ? AND status = 'active'`
  )
    .bind(now, now, auth.sub, credentialId)
    .run();

  const changed = (result.meta.changes ?? 0) > 0;

  await writePasskeyAuditLog(c.env, {
    userId: auth.sub,
    credentialId,
    action: "credential_revoke",
    success: changed,
    detail: { changed },
    ...getRequestMeta(c)
  });

  if (!changed) {
    return c.json(badRequest("Credential not found"), 404);
  }

  return c.json({
    success: true,
    data: {
      credentialId,
      revokedAt: now
    }
  });
});

passkeyRoutes.onError(() => {
  return unauthorizedResponse("Passkey route error", 500);
});
