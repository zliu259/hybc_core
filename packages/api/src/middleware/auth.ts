import type { MiddlewareHandler } from "hono";

import { verifyToken } from "../services/auth";
import { isAgentToken } from "../services/agent-token";
import { resolveAgentByToken, touchGrantLastUsed } from "../services/agent-grant";
import { writeAuditLog } from "../services/audit-log";
import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";

export type AuthVariables = {
  auth: AuthTokenPayload;
};

const unauthorized = (message: string) => {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message
      }
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

export const authMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> = async (c, next) => {
  const authorization = c.req.header("authorization");
  if (!authorization) {
    return unauthorized("Missing authorization header");
  }

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return unauthorized("Invalid bearer token");
  }

  if (isAgentToken(token)) {
    const identity = await resolveAgentByToken(c.env.DB, token);
    if (!identity) {
      return unauthorized("Invalid or expired agent token");
    }

    const now = Math.floor(Date.now() / 1000);
    c.set("auth", {
      sub: identity.wecomUserid,
      username: identity.wecomUserid,
      nickname: identity.wecomUserid,
      avatar: "",
      roles: identity.roles,
      permissions: identity.permissions,
      tokenId: identity.grantId,
      type: "access",
      auth_method: "mcp_agent",
      wecom_verified_at: new Date().toISOString(),
      via: "mcp",
      grant_id: identity.grantId,
      iat: now,
      exp: now
    });

    const auditPromise = Promise.all([
      touchGrantLastUsed(c.env.DB, identity.grantId),
      writeAuditLog(c.env.DB, {
        actorUserId: identity.wecomUserid,
        actorRoles: identity.roles,
        action: `agent:${c.req.method}`,
        targetType: "agent_request",
        targetId: new URL(c.req.url).pathname,
        detail: { via: "mcp", grant_id: identity.grantId }
      })
    ]).catch(() => undefined);
    // 生产 Workers 有 executionCtx；vitest 直接 app.request 时可能没有 —— 两种都容错。
    try {
      c.executionCtx.waitUntil(auditPromise);
    } catch {
      void auditPromise;
    }

    await next();
    return;
  }

  try {
    const payload = await verifyToken(c.env, token);
    if (payload.type !== "access") {
      return unauthorized("Invalid token type");
    }

    const session = await c.env.KV.get(`session:access:${payload.tokenId}`);
    if (!session) {
      return unauthorized("Session expired");
    }

    c.set("auth", payload);
    await next();
  } catch {
    return unauthorized("Unauthorized");
  }
};
