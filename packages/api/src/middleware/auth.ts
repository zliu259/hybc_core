import type { MiddlewareHandler } from "hono";

import { verifyToken } from "../services/auth";
import { isAgentToken } from "../services/agent-token";
import { resolveAgentByToken, touchGrantLastUsed } from "../services/agent-grant";
import { agentReadonlyForbidden } from "./agent-readonly";
import {
  canForbidWithoutBody,
  classifyAgentPath,
  decideHighRiskRequest,
  REPLAY_PENDING_HEADER,
  type AgentDecision
} from "./agent-high-risk-gate";
import { parkAgentRequest } from "../services/agent-park";
import { getPendingById } from "../services/agent-pending";
import { REPLAY_HEADER } from "../services/agent-replay";
import { writeAuditLog } from "../services/audit-log";
import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";

/**
 * rank5：重放（本人已确认后由服务端发起）时，从 park 当刻钉住的 pending 行里取出的审批任务身份。
 *
 * 唯一确立点是 authMiddleware 的 replay 分支：pendingId 已由高危闸门 HMAC 校验，其库内字段可信；
 * 这里【绝不】采信任何入站请求头。handler（routes/approval.ts）据此只批钉住的那一条任务，且它必须
 * 仍 pending，任一不符即整次重放 409、不改任何状态。非重放请求（人类、只读）不设此变量。
 */
export interface AgentReplayContext {
  readonly pendingId: string;
  readonly targetTaskId: number | null;
  readonly targetNodeInstanceId: number | null;
  readonly targetRound: number | null;
}

export type AuthVariables = {
  auth: AuthTokenPayload;
  agentReplay?: AgentReplayContext;
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
    // 【裁决分两阶段，body 只在第二阶段才读】
    //
    // 第一阶段 classifyAgentPath 只做字符串匹配，allow / forbid 在此就能定案。
    // body 在整条链上只有一个用途（给重放校验算 sha256），而那一步只有高危写才走得到。
    // 若无条件先读 body，一枚泄漏的令牌就能往任意非高危写路径 POST 一个巨大的 body，
    // 让它在通往一个必然的 403 的路上被完整解码进 JS 堆，撞穿 isolate 的内存上限、
    // 连带打死同一 isolate 上的其它请求。故 forbid 必须在读 body【之前】开火。
    let decision: AgentDecision;
    const classified = classifyAgentPath(c.req.method, c.req.path);

    if (classified.kind === "high_risk") {
      const replayMarker = c.req.header(REPLAY_HEADER);
      const replayPendingId = c.req.header(REPLAY_PENDING_HEADER);
      const replay =
        replayMarker && replayPendingId
          ? { pendingId: replayPendingId, marker: replayMarker }
          : null;

      // 高危写里也还有一格不必读 body：没带标记、且开关关闭 —— 见 canForbidWithoutBody。
      if (await canForbidWithoutBody(c.env, replay)) {
        decision = { kind: "forbid" };
      } else {
        // 读 body 必须用 clone：下游 handler（如 routes/approval.ts 的 approve）会
        // await c.req.json()，且是在 try 之外 —— 原始流一旦被这里读掉，handler 会直接抛。
        // 且【绝不再序列化】：重放标记签的是原始字节的 SHA-256，JSON.parse→stringify
        // 会改变空白与键序，让重放时算出的哈希与签名时对不上。
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

        decision = await decideHighRiskRequest(
          c.env,
          c.req.method,
          c.req.path,
          rawBody,
          classified.rule,
          replay
        );

        // park：动作被冻结成待本人微信确认，【就此返回】—— 绝不 next()，
        // 否则同一次请求既执行了写又弹了确认卡片（双重副作用）。
        if (decision.kind === "park") {
          return parkAgentRequest(
            c.env,
            {
              method: c.req.method,
              url: c.req.url,
              // 与 classifyAgentPath 用的是同一个 c.req.path —— 摘要、快照路径、签名路径
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
      }
    } else {
      decision = classified;
    }

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

    // allow / replay 均落到下方常规通路：设置 auth、计 last_used、写审计、执行 handler。
    // 重放【照样审计】—— 它仍是一次 agent 发起的请求，只是已获本人确认。

    // rank5：重放时把 park 当刻钉住的任务身份放进受信上下文（handler 据此只批这一条、且须仍 pending）。
    // 这是钉子的【唯一确立点】：pendingId 已被闸门 HMAC 校验，故其库内字段可信；绝不采信入站请求头。
    // getPendingById 承诺不抛以外的语义都不依赖：查不到（理论上不应）就落成三个 null，handler 会据此 409。
    if (decision.kind === "replay") {
      const pendingRow = await getPendingById(c.env.DB, decision.pendingId);
      c.set("agentReplay", {
        pendingId: decision.pendingId,
        targetTaskId: pendingRow?.target_task_id ?? null,
        targetNodeInstanceId: pendingRow?.target_node_instance_id ?? null,
        targetRound: pendingRow?.target_round ?? null
      });
    }

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
