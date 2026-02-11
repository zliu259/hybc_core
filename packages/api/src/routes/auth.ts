import { Hono } from "hono";

import {
  createSessionPayload,
  getRefreshSession,
  issueTokens,
  toFrontendLoginResponse,
  verifyToken
} from "../services/auth";
import type { Env } from "../types/env";

type LoginBody = {
  code?: string;
  username?: string;
};

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenResponse = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );
  const tokenJson = (await tokenResponse.json()) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
  };

  if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
    throw new Error(tokenJson.errmsg ?? "Failed to get WeCom access_token");
  }

  return tokenJson.access_token;
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
  };

  if (userJson.errcode !== 0 || !userJson.UserId) {
    throw new Error(userJson.errmsg ?? "Failed to fetch WeCom user");
  }

  return userJson.UserId;
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
    throw new Error(profileJson.errmsg ?? "Failed to fetch WeCom profile");
  }

  return {
    userId: profileJson.userid,
    username: profileJson.userid,
    nickname: profileJson.name ?? profileJson.userid,
    avatar: profileJson.avatar
  };
};

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/oauth-url", (c) => {
  const redirectUri =
    c.req.query("redirect_uri") ?? c.env.WECHAT_REDIRECT_URI ?? "";

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

  const oauthUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(
    c.env.WECHAT_CORPID
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_base&agentid=${encodeURIComponent(c.env.WECHAT_AGENT_ID)}#wechat_redirect`;

  return c.json({
    success: true,
    data: {
      oauthUrl
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
