import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import {
  createSessionPayload,
  defaultPermissionsByRole,
  getRefreshSession,
  issueTokens,
  roleFromUsername,
  toFrontendLoginResponse,
  verifyToken
} from "../services/auth";
import type { UserRole } from "../types/auth";
import { getWeComContactBook, syncWeComContactBook } from "../services/wecom-contact-book";
import type { Env } from "../types/env";
import {
  fetchWeComAccessToken,
  fetchWeComJson,
  getCachedString,
  putCachedString,
  weComErrorMessage
} from "../services/wecom-api";
import {
  fetchWeComTags,
  listUsersInTag,
  parseRoleTagMapping,
  resolveRoleByWeComTags,
  rolePriority
} from "../services/wecom-role";

type LoginBody = {
  code?: string;
  username?: string;
};

type WeComTicketResponse = {
  errcode?: number;
  errmsg?: string;
  ticket?: string;
  expires_in?: number;
};

type WeComContactUserWithPermission = {
  userid: string;
  name?: string;
  department?: number[];
  mobile?: string;
  email?: string;
  avatar?: string;
  status?: number;
  system_role: UserRole;
  role_source: "wecom_tag" | "username_fallback";
  permissions: string[];
  permission_status: "configured";
};

type WeComMiniProgramSessionResponse = {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  UserId?: string;
  session_key?: string;
};

const isInvalidWeComCodeError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid code") ||
    normalized.includes("e=40029") ||
    normalized.includes("40029")
  );
};

const CORP_JSAPI_TICKET_KV_KEY = "wecom:jsapi-ticket:corp:v1";
const AGENT_JSAPI_TICKET_KV_KEY = "wecom:jsapi-ticket:agent:v1";

const randomNonce = () => {
  return crypto.randomUUID().replace(/-/g, "");
};

const buildSignSource = (
  ticket: string,
  nonceStr: string,
  timestamp: number,
  url: string
): string => {
  return `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
};

const sha1Hex = async (value: string): Promise<string> => {
  const buffer = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const fetchCorpJsApiTicket = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, CORP_JSAPI_TICKET_KV_KEY);
  if (cached) return cached;

  const accessToken = await fetchWeComAccessToken(env);
  const json = await fetchWeComJson<WeComTicketResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket?access_token=${encodeURIComponent(accessToken)}`
  );

  if (json.errcode !== 0 || !json.ticket) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to get corp jsapi_ticket")
    );
  }

  await putCachedString(
    env,
    CORP_JSAPI_TICKET_KV_KEY,
    json.ticket,
    json.expires_in
  );
  return json.ticket;
};

const fetchAgentJsApiTicket = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, AGENT_JSAPI_TICKET_KV_KEY);
  if (cached) return cached;

  const accessToken = await fetchWeComAccessToken(env);
  const json = await fetchWeComJson<WeComTicketResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/ticket/get?access_token=${encodeURIComponent(accessToken)}&type=agent_config`
  );

  if (json.errcode !== 0 || !json.ticket) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to get agent jsapi_ticket")
    );
  }

  await putCachedString(
    env,
    AGENT_JSAPI_TICKET_KV_KEY,
    json.ticket,
    json.expires_in
  );
  return json.ticket;
};

const normalizeSignUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const hashIndex = trimmed.indexOf("#");
  return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
};

const fetchWeComUserId = async (
  env: Env,
  accessToken: string,
  code: string
): Promise<string> => {
  const userJson = await fetchWeComJson<{
    errcode?: number;
    errmsg?: string;
    UserId?: string;
    userid?: string;
    OpenId?: string;
    openid?: string;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}`
  );

  if (userJson.errcode !== 0) {
    throw new Error(
      weComErrorMessage(userJson.errmsg, "Failed to fetch WeCom user")
    );
  }

  const userId = userJson.UserId ?? userJson.userid;
  if (userId) return userId;

  if (userJson.OpenId || userJson.openid) {
    throw new Error(
      "WeCom returned OpenId without UserId. Ensure scanner is an internal member and app visibility/scope is configured for this user."
    );
  }

  throw new Error("WeCom getuserinfo returned success but missing UserId");
};

const fetchWeComMiniProgramUserId = async (
  env: Env,
  accessToken: string,
  code: string
): Promise<string> => {
  const json = await fetchWeComJson<WeComMiniProgramSessionResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/miniprogram/jscode2session?access_token=${encodeURIComponent(accessToken)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  );
  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to exchange WeCom miniapp code")
    );
  }

  const userId = json.userid ?? json.UserId;
  if (!userId) {
    throw new Error("WeCom miniapp jscode2session returned success but missing userid");
  }

  return userId;
};

const buildIdentityByCode = async (
  env: Env,
  code: string,
  preferMiniProgram: boolean
): Promise<{
  userId: string;
  username: string;
  nickname: string;
  avatar?: string;
  role?: UserRole;
}> => {
  const accessToken = await fetchWeComAccessToken(env);
  const resolvePrimaryUserId = async (): Promise<string> => {
    if (preferMiniProgram) {
      return fetchWeComMiniProgramUserId(env, accessToken, code);
    }
    return fetchWeComUserId(env, accessToken, code);
  };

  let userId: string | null = null;
  let primaryErrorMessage = "";
  let primaryErrorIsInvalidCode = false;

  try {
    userId = await resolvePrimaryUserId();
  } catch (error) {
    primaryErrorMessage = error instanceof Error ? error.message : "Failed to resolve WeCom user from login code";
    primaryErrorIsInvalidCode = isInvalidWeComCodeError(primaryErrorMessage);
  }

  // Hotfix: keep miniapp login compatible with qy.login code variants by
  // allowing one fallback attempt to getuserinfo when jscode2session fails.
  // We intentionally keep this to a single fallback path (miniapp -> web only)
  // to avoid unnecessary multi-endpoint retries on the same one-time code.
  if (!userId && preferMiniProgram && !primaryErrorIsInvalidCode) {
    try {
      userId = await fetchWeComUserId(env, accessToken, code);
    } catch (error) {
      const fallbackErrorMessage =
        error instanceof Error ? error.message : "Failed to fetch WeCom user";
      throw new Error(
        `Miniapp code exchange failed: ${primaryErrorMessage || "unknown error"}; web fallback failed: ${fallbackErrorMessage}`
      );
    }
  }

  if (!userId) {
    if (primaryErrorMessage) {
      throw new Error(primaryErrorMessage);
    }
    throw new Error("Failed to resolve WeCom user from login code");
  }

  const profile = await fetchWeComProfile(env, accessToken, userId);
  return {
    ...profile,
    role: await resolveRoleByWeComTags(env, accessToken, userId)
  };
};

const fetchWeComProfile = async (env: Env, accessToken: string, userId: string) => {
  const profileJson = await fetchWeComJson<{
    errcode?: number;
    errmsg?: string;
    userid?: string;
    name?: string;
    avatar?: string;
  }>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(userId)}`
  );

  if (profileJson.errcode !== 0 || !profileJson.userid) {
    throw new Error(
      weComErrorMessage(profileJson.errmsg, "Failed to fetch WeCom profile")
    );
  }

  return {
    userId: profileJson.userid,
    username: profileJson.userid,
    nickname: profileJson.name ?? profileJson.userid,
    avatar: profileJson.avatar
  };
};

const enrichPermissionStatusByWeComTags = async (
  env: Env,
  users: Array<{
    userid: string;
    name?: string;
    department?: number[];
    mobile?: string;
    email?: string;
    avatar?: string;
    status?: number;
  }>
): Promise<WeComContactUserWithPermission[]> => {
  const accessToken = await fetchWeComAccessToken(env);
  const tagList = await fetchWeComTags(env, accessToken);
  const tagIdByName = new Map<string, number>();
  tagList.forEach((item) => {
    tagIdByName.set(item.tagname, item.tagid);
  });

  const mapping = parseRoleTagMapping(env.WECHAT_ROLE_TAG_MAPPING);
  const roleMemberSet: Record<UserRole, Set<string>> = {
    super_admin: new Set<string>(),
    finance: new Set<string>(),
    manager: new Set<string>(),
    site_manager: new Set<string>(),
    operator: new Set<string>()
  };

  for (const role of rolePriority) {
    const tagNames = mapping[role] || [];
    for (const tagName of tagNames) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) continue;
      const members = await listUsersInTag(env, accessToken, tagId);
      members.forEach((userid) => roleMemberSet[role].add(userid));
    }
  }

  const resolveRoleByTagFirst = (userid: string): { role: UserRole; source: "wecom_tag" | "username_fallback" } => {
    for (const role of rolePriority) {
      if (roleMemberSet[role].has(userid)) {
        return { role, source: "wecom_tag" };
      }
    }
    return { role: roleFromUsername(userid), source: "username_fallback" };
  };

  return users.map((item) => {
    const resolved = resolveRoleByTagFirst(item.userid);
    return {
      ...item,
      system_role: resolved.role,
      role_source: resolved.source,
      permissions: defaultPermissionsByRole[resolved.role],
      permission_status: "configured"
    };
  });
};

const buildWeComScanUrl = (
  corpid: string,
  agentId: string,
  redirectUri: string,
  state: string
): string => {
  return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${encodeURIComponent(corpid)}&agentid=${encodeURIComponent(agentId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
};

const buildWeComOAuthUrl = (
  corpid: string,
  agentId: string,
  redirectUri: string,
  state: string,
  scope: "snsapi_base" | "snsapi_privateinfo" = "snsapi_base"
): string => {
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(corpid)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&agentid=${encodeURIComponent(agentId)}#wechat_redirect`;
};

const getRedirectUri = (c: { req: { query: (key: string) => string | undefined }; env: Env }) => {
  return c.req.query("redirect_uri") ?? c.env.WECHAT_REDIRECT_URI ?? "";
};

export const authRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

authRoutes.get("/oauth-url", (c) => {
  const redirectUri = getRedirectUri(c);
  if (!redirectUri || !c.env.WECHAT_CORPID || !c.env.WECHAT_AGENT_ID) {
    return c.json(
      {
        success: false,
        error: {
          message: "WECHAT_OAUTH_CONFIG_MISSING"
        }
      },
      400
    );
  }

  const state = c.req.query("state") ?? `${Date.now()}`;
  const mode = c.req.query("mode") ?? "scan";
  const scope = c.req.query("scope") === "snsapi_privateinfo"
    ? "snsapi_privateinfo"
    : "snsapi_base";
  const scanUrl = buildWeComScanUrl(
    c.env.WECHAT_CORPID,
    c.env.WECHAT_AGENT_ID,
    redirectUri,
    state
  );
  const oauthUrl = buildWeComOAuthUrl(
    c.env.WECHAT_CORPID,
    c.env.WECHAT_AGENT_ID,
    redirectUri,
    state,
    scope
  );

  const loginUrl = mode === "oauth" ? oauthUrl : scanUrl;

  return c.json({
    success: true,
    data: {
      oauthUrl,
      scanUrl,
      loginUrl,
      state
    }
  });
});

authRoutes.get("/login/web", async (c) => {
  const code = c.req.query("code")?.trim() ?? "";
  if (!code) {
    return c.json(
      {
        success: false,
        error: {
          message: "Missing WeCom code"
        }
      },
      400
    );
  }

  const state = c.req.query("state")?.trim();
  const configuredRedirect = (c.env.WECHAT_REDIRECT_URI ?? "").trim();
  const redirectBase =
    configuredRedirect && !configuredRedirect.includes("/api/v1/auth/login/web")
      ? configuredRedirect
      : "https://web.hybcdg.com/login";

  const target = new URL(redirectBase);
  target.searchParams.set("code", code);
  if (state) {
    target.searchParams.set("state", state);
  }

  return c.redirect(target.toString(), 302);
});

authRoutes.post(
  "/login/web",
  createRateLimitMiddleware({
    scope: "auth:login:web",
    maxRequests: 20,
    windowSeconds: 300
  }),
  async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoginBody;
  try {
    let identity: {
      userId: string;
      username: string;
      nickname: string;
      avatar?: string;
      role?: UserRole;
    };

    if (body.code) {
      identity = await buildIdentityByCode(c.env, body.code, false);
    } else {
      if (c.env.APP_ENV !== "local") {
        return c.json(
          {
            success: false,
            error: {
              message: "Missing WeCom code"
            }
          },
          400
        );
      }

      const username = (body.username ?? "operator").trim() || "operator";
      identity = {
        userId: username,
        username,
        nickname: username
      };
    }

    const session = createSessionPayload(identity);
    const tokenBundle = await issueTokens(c.env, session);

    return c.json(toFrontendLoginResponse(tokenBundle));
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Login failed"
        }
      },
      400
    );
  }
  }
);

authRoutes.post(
  "/login/miniapp",
  createRateLimitMiddleware({
    scope: "auth:login:miniapp",
    maxRequests: 20,
    windowSeconds: 300
  }),
  async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoginBody;
  if (!body.code) {
    return c.json(
      {
        success: false,
        error: {
          message: "Missing WeCom miniapp code"
        }
      },
      400
    );
  }

  try {
    const identity = await buildIdentityByCode(c.env, body.code, true);
    const session = createSessionPayload(identity);
    const tokenBundle = await issueTokens(c.env, session);
    return c.json(toFrontendLoginResponse(tokenBundle));
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Miniapp login failed"
        }
      },
      400
    );
  }
  }
);

authRoutes.get("/wecom/jssdk-config", async (c) => {
  const rawUrl = c.req.query("url") ?? "";
  const url = normalizeSignUrl(rawUrl);

  if (!url) {
    return c.json(
      {
        success: false,
        error: {
          message: "Missing url"
        }
      },
      400
    );
  }

  if (!c.env.WECHAT_CORPID || !c.env.WECHAT_AGENT_ID) {
    return c.json(
      {
        success: false,
        error: {
          message: "WECHAT_OAUTH_CONFIG_MISSING"
        }
      },
      400
    );
  }

  try {
    const nonceStr = randomNonce();
    const timestamp = Math.floor(Date.now() / 1000);

    const [corpTicket, agentTicket] = await Promise.all([
      fetchCorpJsApiTicket(c.env),
      fetchAgentJsApiTicket(c.env)
    ]);

    const signature = await sha1Hex(
      buildSignSource(corpTicket, nonceStr, timestamp, url)
    );
    const agentSignature = await sha1Hex(
      buildSignSource(agentTicket, nonceStr, timestamp, url)
    );

    return c.json({
      success: true,
      data: {
        corpId: c.env.WECHAT_CORPID,
        agentId: c.env.WECHAT_AGENT_ID,
        url,
        timestamp,
        nonceStr,
        signature,
        agentSignature
      }
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to create WeCom jssdk config"
        }
      },
      400
    );
  }
});

authRoutes.post(
  "/refresh-token",
  createRateLimitMiddleware({
    scope: "auth:refresh-token",
    maxRequests: 30,
    windowSeconds: 300
  }),
  async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    refreshToken?: string;
  };
  if (!body.refreshToken) {
    return c.json(
      {
        success: false,
        error: {
          message: "Missing refreshToken"
        }
      },
      400
    );
  }

  try {
    const payload = await verifyToken(c.env, body.refreshToken);
    if (payload.type !== "refresh") {
      return c.json(
        {
          success: false,
          error: {
            message: "Invalid refresh token"
          }
        },
        401
      );
    }

    const refreshSession = await getRefreshSession(c.env, payload.tokenId);
    if (!refreshSession) {
      return c.json(
        {
          success: false,
          error: {
            message: "Refresh session expired"
          }
        },
        401
      );
    }

    const tokenBundle = await issueTokens(c.env, refreshSession);
    return c.json({
      success: true,
      data: {
        accessToken: tokenBundle.accessToken,
        refreshToken: tokenBundle.refreshToken,
        expires: tokenBundle.expires
      }
    });
  } catch {
    return c.json(
      {
        success: false,
        error: {
          message: "Invalid refresh token"
        }
      },
      401
    );
  }
  }
);

authRoutes.use("/wecom/*", authMiddleware);

authRoutes.post(
  "/wecom/contacts/sync",
  async (c) => {
    try {
      const payload = await syncWeComContactBook(c.env);

      return c.json({
        success: true,
        data: {
          syncedAt: payload.syncedAt,
          departmentCount: payload.departments.length,
          userCount: payload.users.length
        }
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            message:
              error instanceof Error ? error.message : "Failed to sync contacts"
          }
        },
        400
      );
    }
  }
);

authRoutes.get(
  "/wecom/contacts",
  async (c) => {
    const parsed = await getWeComContactBook(c.env, {
      forceRefresh: false,
      allowStaleOnRefreshError: true
    });

    let users: WeComContactUserWithPermission[] = [];
    let permissionSync: {
      enriched: boolean;
      mode: "wecom_tag+fallback" | "username_fallback";
      error?: string;
    } = {
      enriched: false,
      mode: "username_fallback"
    };

    try {
      users = await enrichPermissionStatusByWeComTags(c.env, parsed.users ?? []);
      permissionSync = {
        enriched: true,
        mode: "wecom_tag+fallback"
      };
    } catch (error) {
      users = (parsed.users ?? []).map((item) => {
        const role = roleFromUsername(item.userid);
        return {
          ...item,
          system_role: role,
          role_source: "username_fallback" as const,
          permissions: defaultPermissionsByRole[role],
          permission_status: "configured" as const
        };
      });
      permissionSync = {
        enriched: false,
        mode: "username_fallback",
        error: error instanceof Error ? error.message : "permission sync failed"
      };
    }

    return c.json({
      success: true,
      data: {
        ...parsed,
        users,
        permission_sync: permissionSync
      }
    });
  }
);
