import type { MiddlewareHandler } from "hono";

import { verifyToken } from "../services/auth";
import { isAgentToken } from "../services/agent-token";
import { resolveAgentByToken, touchGrantLastUsed } from "../services/agent-grant";
import { agentReadonlyForbidden } from "./agent-readonly";
import { decideAgentRequest, REPLAY_PENDING_HEADER } from "./agent-high-risk-gate";
import { parkAgentRequest } from "../services/agent-park";
import { REPLAY_HEADER } from "../services/agent-replay";
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
    let identity;
    try {
      identity = await resolveAgentByToken(c.env.DB, token);
    } catch (err) {
      console.error("agent token resolution failed", err);
      return unauthorized("Unauthorized");
    }
    if (!identity) {
      return unauthorized("Invalid or expired agent token");
    }

    // 生产 Workers 有 executionCtx；vitest 直接 app.request 时可能没有 —— 两种都容错。
    const runInBackground = (promise: Promise<unknown>): void => {
      try {
        c.executionCtx.waitUntil(promise);
      } catch {
        void promise;
      }
    };

    // agent 闸门（deny-by-default）：mcp_agent 令牌的一切请求在此收敛，全局不可绕过；
    // 人类 JWT 会话不经此闸门。放在身份解析之后、设置 auth 与成功审计之前
    // —— 被拦/被 park 的请求不计入 last_used。
    //
    // 读 body 必须用 clone：下游 handler（如 routes/approval.ts 的 approve）会
    // await c.req.json()，且是在 try 之外 —— 原始流一旦被这里读掉，handler 会直接抛。
    // 且【绝不再序列化】：重放标记签的是原始字节的 SHA-256，JSON.parse→stringify
    // 会改变空白与键序，让 T9 重放时算出的哈希与签名时对不上。
    const upperMethod = c.req.method.toUpperCase();
    let rawBody = "";
    if (upperMethod !== "GET" && upperMethod !== "HEAD") {
      try {
        rawBody = await c.req.raw.clone().text();
      } catch (err) {
        // 读不出 body 就无法可靠裁决（既算不出哈希，也存不出可重放的快照）。
        // 唯一安全的结局是拒绝 —— 绝不能拿空串当作「body 就是空的」继续往下走。
        console.error("agent request body read failed", err);
        return agentReadonlyForbidden();
      }
    }

    const replayMarker = c.req.header(REPLAY_HEADER);
    const replayPendingId = c.req.header(REPLAY_PENDING_HEADER);
    const decision = await decideAgentRequest(
      c.env,
      c.req.method,
      c.req.path,
      rawBody,
      replayMarker && replayPendingId
        ? { pendingId: replayPendingId, marker: replayMarker }
        : null
    );

    if (decision.kind === "forbid") {
      // MEDIUM 修复：审计被拦截的写/越权尝试，令泄漏令牌的探测可被发现。
      const blockedAudit = writeAuditLog(c.env.DB, {
        actorUserId: identity.wecomUserid,
        actorRoles: identity.roles,
        action: "agent.blocked_write",
        targetType: "agent_request",
        targetId: c.req.path,
        status: "blocked",
        detail: { via: "mcp", grant_id: identity.grantId, method: c.req.method }
      }).catch((err) => {
        console.error("agent blocked-write audit failed", err);
      });
      runInBackground(blockedAudit);
      return agentReadonlyForbidden();
    }

    // park：动作被冻结成待本人微信确认，【就此返回】—— 绝不 next()，
    // 否则同一次请求既执行了写又弹了确认卡片（双重副作用）。
    if (decision.kind === "park") {
      return parkAgentRequest(
        c.env,
        {
          method: c.req.method,
          url: c.req.url,
          // 与 decideAgentRequest 用的是同一个 c.req.path —— 摘要、快照路径、签名路径
          // 必须与闸门匹配时看到的字符串完全一致（Hono 已解码百分号转义）。
          path: c.req.path,
          headers: c.req.raw.headers,
          body: rawBody,
          identity,
          rule: decision.rule
        },
        runInBackground
      );
    }

    // allow / replay 均落到下方常规通路：设置 auth、计 last_used、写审计、执行 handler。
    // 重放【照样审计】—— 它仍是一次 agent 发起的请求，只是已获本人确认。

    const now = Math.floor(Date.now() / 1000);
    // 注：agent token 的有效性由 grant 查询（resolveAgentByToken）保证，不走 JWT exp 校验。
    // 下面的 exp/iat/wecom_verified_at 仅为满足 AuthTokenPayload 形状，对 agent 不具权威性；
    // 未来若加基于 exp/验证时效的高危闸门，需改为读取 grant 的真实 expires_at。
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
    ]).catch((err) => {
      console.error("agent audit write failed", err);
    });
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
