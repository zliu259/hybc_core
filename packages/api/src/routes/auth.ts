import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import {
  createSessionPayload,
  getRefreshSession,
  issueTokens,
  toFrontendLoginResponse,
  verifyToken
} from "../services/auth";
import { getWeComContactBook, syncWeComContactBook } from "../services/wecom-contact-book";
import type { Env } from "../types/env";

type LoginBody = {
  code?: string;
  username?: string;
};

type WeComTokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

type WeComTicketResponse = {
  errcode?: number;
  errmsg?: string;
  ticket?: string;
  expires_in?: number;
};

const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
const CORP_JSAPI_TICKET_KV_KEY = "wecom:jsapi-ticket:corp:v1";
const AGENT_JSAPI_TICKET_KV_KEY = "wecom:jsapi-ticket:agent:v1";
const TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;

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

const getCachedString = async (env: Env, key: string): Promise<string | null> => {
  return env.KV.get(key);
};

const putCachedString = async (
  env: Env,
  key: string,
  value: string,
  expiresInSeconds?: number
) => {
  const ttl = Math.max(
    60,
    (expiresInSeconds ?? TOKEN_DEFAULT_TTL_SECONDS) - 300
  );
  await env.KV.put(key, value, { expirationTtl: ttl });
};

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );

  const tokenJson = (await tokenResponse.json()) as WeComTokenResponse;
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

const fetchCorpJsApiTicket = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, CORP_JSAPI_TICKET_KV_KEY);
  if (cached) return cached;

  const accessToken = await fetchWeComAccessToken(env);
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket?access_token=${encodeURIComponent(accessToken)}`
  );
  const json = (await response.json()) as WeComTicketResponse;

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
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/ticket/get?access_token=${encodeURIComponent(accessToken)}&type=agent_config`
  );
  const json = (await response.json()) as WeComTicketResponse;

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
  accessToken: string,
  code: string
): Promise<string> => {
  const userResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}`
  );

  const userJson = (await userResponse.json()) as {
    errcode?: number;
    errmsg?: string;
    UserId?: string;
    userid?: string;
    OpenId?: string;
    openid?: string;
  };

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

const fetchWeComProfile = async (accessToken: string, userId: string) => {
  const profileResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(userId)}`
  );

  const profileJson = (await profileResponse.json()) as {
    errcode?: number;
    errmsg?: string;
    userid?: string;
    name?: string;
    avatar?: string;
  };

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

authRoutes.post("/login/web", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as LoginBody;
  try {
    let identity: {
      userId: string;
      username: string;
      nickname: string;
      avatar?: string;
    };

    if (body.code) {
      const accessToken = await fetchWeComAccessToken(c.env);
      const userId = await fetchWeComUserId(accessToken, body.code);
      identity = await fetchWeComProfile(accessToken, userId);
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
});

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

authRoutes.post("/refresh-token", async (c) => {
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
});

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

    return c.json({
      success: true,
      data: parsed
    });
  }
);
