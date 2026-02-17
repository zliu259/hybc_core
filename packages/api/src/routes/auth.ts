import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
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

type WeComTokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
};

const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

type WeComDepartment = {
  id: number;
  name: string;
  parentid: number;
  order: number;
};

type WeComUser = {
  userid: string;
  name: string;
  department: number[];
  mobile?: string;
  email?: string;
  avatar?: string;
  status?: number;
};

const CONTACT_BOOK_KV_KEY = "wecom:contact-book:v1";
const CONTACT_BOOK_TTL_SECONDS = 60 * 60;

const fetchWeComAccessToken = async (env: Env): Promise<string> => {
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

const getDepartmentList = async (
  accessToken: string
): Promise<WeComDepartment[]> => {
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(accessToken)}`
  );

  const json = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    department?: WeComDepartment[];
  };

  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to fetch department list")
    );
  }

  return json.department ?? [];
};

const getUsersByDepartment = async (
  accessToken: string,
  departmentId: number
): Promise<WeComUser[]> => {
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/user/simplelist?access_token=${encodeURIComponent(accessToken)}&department_id=${departmentId}&fetch_child=0`
  );

  const json = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    userlist?: WeComUser[];
  };

  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, "Failed to fetch users by department")
    );
  }

  return json.userlist ?? [];
};

const buildWeComScanUrl = (
  corpid: string,
  agentId: string,
  redirectUri: string,
  state: string
): string => {
  return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${encodeURIComponent(corpid)}&agentid=${encodeURIComponent(agentId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
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
  const scanUrl = buildWeComScanUrl(
    c.env.WECHAT_CORPID,
    c.env.WECHAT_AGENT_ID,
    redirectUri,
    state
  );

  return c.json({
    success: true,
    data: {
      oauthUrl: scanUrl,
      scanUrl,
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
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    try {
      const accessToken = await fetchWeComAccessToken(c.env);
      const departments = await getDepartmentList(accessToken);

      const userMap = new Map<string, WeComUser>();
      for (const department of departments) {
        const users = await getUsersByDepartment(accessToken, department.id);
        users.forEach((user) => {
          userMap.set(user.userid, user);
        });
      }

      const payload = {
        syncedAt: new Date().toISOString(),
        departments,
        users: [...userMap.values()]
      };

      await c.env.KV.put(CONTACT_BOOK_KV_KEY, JSON.stringify(payload), {
        expirationTtl: CONTACT_BOOK_TTL_SECONDS
      });

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
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const raw = await c.env.KV.get(CONTACT_BOOK_KV_KEY);
    if (!raw) {
      return c.json(
        {
          success: false,
          error: {
            message: "Contact book not synced yet"
          }
        },
        404
      );
    }

    const parsed = JSON.parse(raw) as {
      syncedAt: string;
      departments: WeComDepartment[];
      users: WeComUser[];
    };

    return c.json({
      success: true,
      data: parsed
    });
  }
);
