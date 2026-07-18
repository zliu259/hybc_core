import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import { REPLAY_PENDING_HEADER } from "../middleware/agent-high-risk-gate";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import {
  approveDeviceByUserCode,
  denyDeviceByUserCode,
  getDeviceInfoByUserCode,
  pollDeviceToken,
  provisionBootstrapGrant,
  redeemBootstrap,
  startDeviceAuthorization
} from "../services/agent-device";
import { getGrantById, listGrantsForUser, revokeGrant } from "../services/agent-grant";
import { renderInstallScript } from "../services/agent-install-template";
import {
  claimForExecution,
  confirmPending,
  finishPending,
  getPendingById,
  rejectPending,
  toPublicView
} from "../services/agent-pending";
import { REPLAY_HEADER, sha256Hex, signReplayMarker } from "../services/agent-replay";
import { getAppFetcher } from "../services/app-ref";
import { writeAuditLog } from "../services/audit-log";
import type { AgentPendingRow, RequestSnapshot } from "../types/agent";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const ok = <T>(data: T) => ({ success: true as const, data });
const fail = (message: string) => ({ success: false as const, error: { message } });

// /setup/provision 与 /device/approve、/device/info、/device/deny 属于「人在环」动作：
// 必须由本人网页 JWT 会话发起，禁止 mcp_agent 令牌自助开通/查看/批准/拒绝。
const requireHumanSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> = async (c, next) => {
  if (c.get("auth").auth_method === "mcp_agent") {
    return c.json(fail("此操作需本人网页登录，不能由智能体令牌发起"), 403);
  }
  await next();
};

export const agentRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const deviceRateLimit = createRateLimitMiddleware({
  scope: "agent-device",
  maxRequests: 30,
  windowSeconds: 60
});

// --- 设备流（免鉴权，CLI 发起）---
agentRoutes.post("/device/code", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const webBaseUrl = c.env.AGENT_WEB_BASE_URL;
  if (!webBaseUrl) return c.json(fail("AGENT_WEB_BASE_URL not configured"), 500);
  const result = await startDeviceAuthorization(c.env.KV, {
    webBaseUrl,
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  return c.json(ok(result));
});

agentRoutes.post("/device/token", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  if (!body.device_code) return c.json(fail("device_code required"), 400);
  const result = await pollDeviceToken(c.env.KV, c.env.DB, body.device_code);
  return c.json(ok(result));
});

agentRoutes.post("/setup/redeem", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { boot_code?: string };
  if (!body.boot_code) return c.json(fail("boot_code required"), 400);
  const redeemed = await redeemBootstrap(c.env.KV, body.boot_code);
  if (!redeemed) return c.json(fail("boot_code invalid or already used"), 410);
  return c.json(ok(redeemed));
});

// --- dist 分发（免鉴权，R2 取件；白名单防路径遍历）---
const ALLOWED_DIST = new Set(["hybc-mcp.mjs", "SKILL.md"]);

agentRoutes.get("/dist/:file", async (c) => {
  const file = c.req.param("file");
  if (!ALLOWED_DIST.has(file)) {
    return c.json(fail("not found"), 404);
  }
  const object = await c.env.FILES.get(`agent-dist/${file}`);
  if (!object || !object.body) {
    return c.json(fail("not found"), 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (file.endsWith(".mjs")) headers.set("content-type", "text/javascript; charset=utf-8");
  return new Response(object.body, { headers });
});

// --- install.sh / install.ps1（免鉴权：R2 取模板 + 校验替换）---
const renderInstallFromR2 = async (
  c: { env: Env; req: { query: (k: string) => string | undefined } },
  key: string,
  contentType: string
): Promise<Response> => {
  const object = await c.env.FILES.get(`agent-dist/${key}`);
  if (!object) {
    return new Response("install template not published", { status: 404 });
  }
  const template = await object.text();
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const script = renderInstallScript(template, {
    apiBase,
    boot: c.req.query("boot") ?? "",
    agent: c.req.query("agent") ?? "other"
  });
  return new Response(script, {
    status: 200,
    headers: { "content-type": contentType }
  });
};

agentRoutes.get("/install.sh", (c) =>
  renderInstallFromR2(c, "install.sh", "text/x-shellscript; charset=utf-8")
);

agentRoutes.get("/install.ps1", (c) =>
  renderInstallFromR2(c, "install.ps1", "text/plain; charset=utf-8")
);

// --- 以下需 JWT（登录员工本人）---
agentRoutes.use("/setup/provision", authMiddleware);
agentRoutes.use("/device/approve", authMiddleware);
agentRoutes.use("/device/info", authMiddleware);
agentRoutes.use("/device/deny", authMiddleware);
agentRoutes.use("/grants", authMiddleware);
agentRoutes.use("/grants/*", authMiddleware);
agentRoutes.use("/pending/*", authMiddleware);

const primaryRole = (c: { get: (k: "auth") => AuthVariables["auth"] }): UserRole =>
  (c.get("auth").roles[0] ?? "operator") as UserRole;

agentRoutes.post("/setup/provision", requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const prov = await provisionBootstrapGrant(c.env.KV, c.env.DB, {
    wecomUserid: auth.sub,
    role: primaryRole(c),
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  return c.json(
    ok({
      ...prov,
      install_sh: `curl -fsSL "${apiBase}/api/v1/agent/install.sh?boot=${prov.boot_code}&agent=${encodeURIComponent(body.agent_type ?? "other")}" | sh`,
      install_ps1: `irm "${apiBase}/api/v1/agent/install.ps1?boot=${prov.boot_code}&agent=${encodeURIComponent(body.agent_type ?? "other")}" | iex`
    })
  );
});

agentRoutes.post("/device/approve", deviceRateLimit, requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  if (!body.user_code) return c.json(fail("user_code required"), 400);
  try {
    await approveDeviceByUserCode(c.env.KV, c.env.DB, body.user_code, {
      wecomUserid: auth.sub,
      role: primaryRole(c)
    });
  } catch (error) {
    return c.json(fail(error instanceof Error ? error.message : "approve failed"), 400);
  }
  return c.json(ok({ approved: true }));
});

// 授权页（人在环）：展示待批设备的元数据，供用户确认后再批准/拒绝
agentRoutes.get("/device/info", requireHumanSession, async (c) => {
  const userCode = c.req.query("user_code") ?? "";
  if (!userCode) return c.json(fail("user_code required"), 400);
  const info = await getDeviceInfoByUserCode(c.env.KV, userCode);
  if (!info) return c.json(fail("user_code invalid or expired"), 404);
  return c.json(ok(info));
});

agentRoutes.post("/device/deny", deviceRateLimit, requireHumanSession, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  if (!body.user_code) return c.json(fail("user_code required"), 400);
  try {
    await denyDeviceByUserCode(c.env.KV, body.user_code);
  } catch (error) {
    return c.json(fail(error instanceof Error ? error.message : "deny failed"), 400);
  }
  return c.json(ok({ denied: true }));
});

agentRoutes.get("/grants", async (c) => {
  const auth = c.get("auth");
  const grants = await listGrantsForUser(c.env.DB, auth.sub);
  return c.json(ok(grants));
});

agentRoutes.post("/grants/:id/revoke", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const grant = await getGrantById(c.env.DB, id);
  if (!grant || grant.wecom_userid !== auth.sub) {
    return c.json(fail("Grant not found"), 404);
  }
  await revokeGrant(c.env.DB, id, auth.sub);
  return c.json(ok({ revoked: true }));
});

// ===========================================================================
// 待确认高危动作：查询 / 确认（触发全栈重放）/ 拒绝  —— P2a「人在环」的落地端
// ===========================================================================

/**
 * ExecutionContext 的容错取用。生产 Workers 一定有；vitest 直接 app.request 时访问
 * c.executionCtx 会抛。重放只把它当作可选参数传下去，取不到就不传。
 */
const optionalCtx = (c: {
  executionCtx: ExecutionContext;
}): ExecutionContext | undefined => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};

interface ReplayOutcome {
  readonly status: number;
  readonly body: unknown;
  readonly success: boolean;
}

/**
 * 把 park 时存下的原始请求【原样重放】一遍，走整包中间件栈（cors → logger → auth → rbac → handler）。
 *
 * 三条不可动摇的性质：
 *
 * 1.【逐字节】body 必须是快照里的原始字节，绝不 JSON.parse→stringify —— 重放标记签的是
 *    sha256(原始 body)，任何再序列化都会改变空白与键序，让闸门算出的哈希对不上，
 *    于是这次【已获本人确认】的写会被静默降级成又一次 park：员工点了同意，系统却什么都没发生。
 *
 * 2.【重放头由服务端自签自设】只用本函数刚签出的 marker 与真实 pendingId，绝不回用快照里的同名头。
 *    park 侧虽已剔除这两个头，但信任不该建立在「上游记得剔除」上：攻击者若能让一条伪造标记的请求
 *    被 park，而我们又原样带回它塞的头，等于把标记的选择权交给了攻击者。此处 set 在展开之后，
 *    无论快照里有什么都必然被覆盖。
 *
 * 3.【走整包而非直调 handler】重放必须与人类点「同意」是同一条代码路径。另写一份
 *    「确认后直接改库」的旁路，等于把权限校验与审批引擎状态机实现两遍，必然走样。
 */
const replayPendingAction = async (
  c: { env: Env; executionCtx: ExecutionContext },
  row: AgentPendingRow
): Promise<ReplayOutcome> => {
  if (!row.request_snapshot) {
    throw new Error("request snapshot is empty — nothing to replay");
  }
  const snapshot = JSON.parse(row.request_snapshot) as RequestSnapshot;
  const method = snapshot.method.toUpperCase();

  // 密钥不可用时 signReplayMarker 会抛 —— 由调用方的 try/catch 收成 failed，绝不静默继续。
  // 签名绑定方法与路径：snapshot.path 就是 park 时闸门看到的 c.req.path，
  // 而验签方读的是重放请求的 c.req.path。该解码是幂等的（已实测），故两侧逐字相同。
  const marker = await signReplayMarker(c.env, {
    method,
    path: snapshot.path,
    pendingId: row.id,
    bodyHash: await sha256Hex(snapshot.body)
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(snapshot.headers)) {
    headers.set(key, value);
  }
  // 性质 2：自签的标记最后落笔，必然覆盖快照里任何同名头。
  headers.set(REPLAY_HEADER, marker);
  headers.set(REPLAY_PENDING_HEADER, row.id);

  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const request = new Request(`${apiBase}${snapshot.path}${snapshot.search ?? ""}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : snapshot.body
  });

  const response = await getAppFetcher()(request, c.env, optionalCtx(c));
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // 非 JSON 响应（网关 HTML 错误页等）：原文进结果快照，仍是有效的排查线索。
  }

  // 本仓库的业务错误常以 200 + { success: false } 返回，故状态码与信封都要看。
  const envelopeFailed =
    typeof body === "object" && body !== null && (body as { success?: unknown }).success === false;
  return {
    status: response.status,
    body,
    success: response.status >= 200 && response.status < 300 && !envelopeFailed
  };
};

/**
 * 查询一条待确认动作的状态。
 *
 * 可见性：授权该动作的那个 grant（MCP 客户端轮询自己的动作）或动作归属人本人。
 * 其余一切【404 而非 403】—— 403 等于向陌生人确认「这个 id 对应的动作确实存在」，
 * 使 id 可被枚举验证。响应只经 toPublicView（白名单投影），绝不含请求快照与确认令牌哈希。
 */
agentRoutes.get("/pending/:id", async (c) => {
  const auth = c.get("auth");
  const row = await getPendingById(c.env.DB, c.req.param("id"));
  if (!row) {
    return c.json(fail("not found"), 404);
  }
  const isAgent = auth.auth_method === "mcp_agent";
  const owningGrant = isAgent && auth.grant_id === row.grant_id;
  const owningHuman = !isAgent && auth.sub === row.wecom_userid;
  if (!owningGrant && !owningHuman) {
    return c.json(fail("not found"), 404);
  }
  return c.json(ok(toPublicView(row)));
});

/**
 * 归属校验：确认/拒绝必须由【动作归属人本人】发起。
 *
 * requireHumanSession 已挡掉 mcp_agent 令牌（智能体不得自助确认自己的动作，否则人在环退化为装饰）；
 * 这里再校验会话身份 === 动作归属人。
 *
 * 为什么身份不能来自确认链接：卡片链接里的确认令牌只回答「确认哪一件」，不回答「你是谁」。
 * 链接可能被转发、被截图、出现在通知栏预览里 —— 若「持有链接」即可确认，
 * 那么任何看到过这条消息的人都能替员工批准一笔付款。身份必须、且只能来自网页会话。
 *
 * 行不存在 → 404；存在但不是本人 → 403（明确告诉误点确认链接的同事「这不是你的动作」，
 * 而不是让他以为链接坏了反复重试）。查询端点则一律 404，因为它对 agent 令牌开放、可被枚举。
 */
type PendingAccess =
  | { readonly kind: "ok"; readonly row: AgentPendingRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" };

const loadOwnPending = async (
  c: { env: Env; get: (k: "auth") => AuthVariables["auth"] },
  id: string
): Promise<PendingAccess> => {
  const row = await getPendingById(c.env.DB, id);
  if (!row) {
    return { kind: "not_found" };
  }
  if (row.wecom_userid !== c.get("auth").sub) {
    return { kind: "forbidden" };
  }
  return { kind: "ok", row };
};

/** 非 ok 的归属判定对应的响应体与状态码。 */
const pendingDenial = (kind: "not_found" | "forbidden"): [ReturnType<typeof fail>, 403 | 404] =>
  kind === "not_found"
    ? [fail("not found"), 404]
    : [fail("该待确认动作不属于当前登录用户"), 403];

/**
 * 本人确认 → 服务端重放原请求。整条链路上唯一真正执行高危写的地方。
 *
 * 【至多执行一次】由两道串联的乐观锁承载，任何一道没抢到就原地返回当前视图、绝不重放：
 *   confirmPending: pending → confirmed（重复点击确认时，第二次拿到 false）
 *   claimForExecution: confirmed → executing（并发确认时，只有一路能进入执行）
 * 两道都是单条条件 UPDATE 的 changes 判定，不做「读—判断—写」（见 agent-pending.ts 头部）。
 *
 * 【绝不卡死在 executing】重放整段包在 try/catch 里，异常路径同样 finishPending(failed)。
 * executing 是死状态：confirm/claim/finish 的守卫都不再匹配，没有任何请求路径能推动它，
 * 而它的 request_snapshot 里存着一枚 180 天有效的 agent bearer —— 卡死 = 凭据无限期驻留 D1。
 * （兜底另有 sweepStalePendingActions，但那是给 worker 被回收兜底的，不是给可捕获异常兜底的。）
 */
agentRoutes.post("/pending/:id/confirm", requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const access = await loadOwnPending(c, id);
  if (access.kind !== "ok") {
    return c.json(...pendingDenial(access.kind));
  }
  const { row } = access;

  const currentView = async (): Promise<Response> => {
    const latest = await getPendingById(c.env.DB, id);
    return c.json(ok(toPublicView(latest ?? row)));
  };

  // 第一道锁：过期或已被处理过的动作在此止步（重复确认走这里，不会重放）。
  if (!(await confirmPending(c.env.DB, id))) {
    return currentView();
  }

  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "agent.high_risk_confirmed",
    targetType: "agent_pending_action",
    targetId: id,
    detail: {
      grant_id: row.grant_id,
      action_kind: row.action_kind,
      auth_method: auth.auth_method
    }
  }).catch((err) => {
    console.error("agent high-risk confirm audit failed", err);
  });

  // 第二道锁：并发确认时只有一路能进入执行。
  if (!(await claimForExecution(c.env.DB, id))) {
    return currentView();
  }

  let outcome: ReplayOutcome;
  try {
    outcome = await replayPendingAction(c, row);
  } catch (error) {
    // 具体异常（含「重放密钥未配置」这类配置错误）只进 Worker 日志：
    // result_snapshot 会经 toPublicView 回给调用方，不该携带内部配置细节。
    console.error("agent high-risk replay failed", { pendingId: id, error });
    outcome = {
      status: 500,
      body: { success: false, error: { message: "重放执行失败，请到网页端确认该动作是否已生效" } },
      success: false
    };
  }

  await finishPending(c.env.DB, id, outcome.success ? "done" : "failed", {
    status: outcome.status,
    body: outcome.body
  });

  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "agent.high_risk_executed",
    targetType: "agent_pending_action",
    targetId: id,
    status: outcome.success ? "success" : "error",
    detail: {
      grant_id: row.grant_id,
      action_kind: row.action_kind,
      replay_status: outcome.status
    }
  }).catch((err) => {
    console.error("agent high-risk execute audit failed", err);
  });

  return currentView();
});

/**
 * 本人拒绝：状态置 rejected 并抹掉含 Bearer 的请求快照，绝不重放。
 *
 * 【必须如实报告是否真的拦下了】rejectPending 的 WHERE 只匹配 pending，动作若已被确认/执行，
 * 它什么都不会做。此时仍回一个笼统的成功信封，等于告诉员工「已拒绝」——而那笔款可能刚刚批出去。
 * 故返回 rejected 布尔 + 当前真实状态，让确认页能显示「这单已经批了，拒绝未生效」。
 *
 * 用 200 + rejected:false 而非 409：客户端拿到的仍是一份完整的当前视图，
 * 不必为了知道「现在到底什么状态」再发一次查询。
 */
agentRoutes.post("/pending/:id/reject", requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const access = await loadOwnPending(c, id);
  if (access.kind !== "ok") {
    return c.json(...pendingDenial(access.kind));
  }
  const { row } = access;

  const rejected = await rejectPending(c.env.DB, id);
  // 审计只在真正赢下流转时写：没发生的事不该在审计里留下「已拒绝」的痕迹。
  if (rejected) {
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "agent.high_risk_rejected",
      targetType: "agent_pending_action",
      targetId: id,
      detail: {
        grant_id: row.grant_id,
        action_kind: row.action_kind
      }
    }).catch((err) => {
      console.error("agent high-risk reject audit failed", err);
    });
  }

  const latest = await getPendingById(c.env.DB, id);
  return c.json(ok({ ...toPublicView(latest ?? row), rejected }));
});
