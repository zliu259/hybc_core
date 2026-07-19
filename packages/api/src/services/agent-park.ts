/**
 * 高危写的「park」副作用 —— 把一个被闸门拦下的 mcp_agent 请求冻结成待本人确认的动作。
 *
 * 调用点唯一：middleware/auth.ts 在 decideAgentRequest 返回 kind==="park" 时进入这里。
 * 本模块负责四件事，然后【代替 handler】返回响应：落库快照 → 推企微卡片 → 写审计 → 202。
 *
 * ## 为什么响应体里必须自带 awaiting_confirmation
 *
 * MCP 客户端（@hybc/mcp）的 Envelope 类型【没有 status 字段】—— HTTP 状态码在那一层被丢弃。
 * 所以「这件事还没发生、正在等你确认」这个语义如果只编码在 202 里，智能体收到的将是一个
 * success:true 且看不出任何异常的响应，它会理直气壮地告诉用户「已批准」。
 * 故信号必须落在 data.status 内。202 是给人类调试者看的，data.status 才是给机器看的。
 *
 * ## 确认令牌绝不回传
 *
 * parkPendingAction 会返回一次性明文 confirmToken，它是员工在企微里确认的凭据。
 * 本模块【只】把它交给推送卡片，绝不放进响应 —— 响应的收件人正是发起这次高危写的智能体，
 * 而智能体可能已被提示注入操纵。令牌若回传，智能体就能自行确认自己的动作，
 * 整个「人在环」退化成一道装饰。
 *
 * ## 推送失败不得失败 park
 *
 * pending 行此刻已提交，员工从确认页仍能看到并处理它。卡片只是通知手段，不是存储。
 * 故推送与审计一律走 waitUntil 的 fire-and-forget，且 pushConfirmCard 本身承诺不抛异常。
 *
 * ## 触顶时的拒绝也是一条安全通路
 *
 * parkPendingAction 会在该 grant 触顶时拒绝落库（泛洪推送是收割一次不经心确认的标准手法）。
 * 触顶有【两种】，对调用方意味着完全不同的下一步，故文案与 reason 都必须分开：
 *   too_many_outstanding     —— 同时未处理的卡片太多，处理掉几张即可继续；
 *   rolling_budget_exhausted —— 24 小时总量刷爆，处理卡片【不会】退还额度，只能等窗口滑过。
 * 两种情形都【不落行、不推卡片】，只留一条审计并回 429。
 * 与 202 同理，理由必须写进 data —— MCP 客户端的信封丢弃 HTTP 状态码。
 */

import {
  buildActionDetail,
  buildSummary,
  loadApprovalContext,
  parseApprovalInstanceId
} from "./agent-action-detail";
import { getGrantById } from "./agent-grant";
import { pushConfirmCard } from "./agent-confirm-push";
import { parkPendingAction } from "./agent-pending";
import { writeAuditLog } from "./audit-log";
import { REPLAY_PENDING_HEADER } from "../middleware/agent-high-risk-gate";
import { REPLAY_HEADER } from "./agent-replay";
import type { HighRiskRule } from "./agent-high-risk";
import type { RequestSnapshot } from "../types/agent";
import type { Env } from "../types/env";

/** 闸门解析出的 agent 身份（authMiddleware 已完成令牌校验）。 */
export interface AgentIdentity {
  readonly wecomUserid: string;
  readonly roles: string[];
  readonly grantId: string;
}

export interface ParkRequestInput {
  readonly method: string;
  /** 请求 URL（完整绝对形态，来自 c.req.url）。此处【只】用来取 query 串。 */
  readonly url: string;
  /**
   * 闸门归一化后的路径（c.req.path，已解码、不含 query）。
   *
   * 必须由调用方从闸门那里原样传入，【不得】在本模块用 new URL(url).pathname 现算：
   * 那个值不解码百分号转义，与闸门匹配用的字符串是两回事。摘要与签名路径都取自此字段，
   * 保证「员工看到的动作」「闸门放行的动作」「被签名的动作」三者是同一个。
   */
  readonly path: string;
  readonly headers: Headers;
  /** 原始请求体字节。必须是闸门 clone 读出的原文，不得再序列化。 */
  readonly body: string;
  readonly identity: AgentIdentity;
  readonly rule: HighRiskRule;
}

/**
 * 快照中【剔除】的请求头。
 *
 * - content-length：重放时按新 body 重算，原值留着只会与实际长度打架；
 * - host：重放的目标 origin 由重放方决定，且它在 fetch 层本就是禁止手工设置的头；
 * - 两个重放头：park 意味着这次【没有】有效标记（伪造的标记也会走到这里）。
 *   把攻击者提供的值原样存回快照，等于让 T9 重放时可能带上一个来路不明的头 —— 无益且有害。
 *
 * 其余一律保留（尤其 authorization 与 content-type）：重放要走完整中间件栈，
 * 缺了 authorization 会 401，缺了 content-type 可能改变 body 解析行为。
 */
const DROPPED_HEADERS: readonly string[] = [
  "content-length",
  "host",
  REPLAY_HEADER,
  REPLAY_PENDING_HEADER
];

const snapshotHeaders = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!DROPPED_HEADERS.includes(lower)) {
      out[lower] = value;
    }
  });
  return out;
};

/** park 当刻解析出的、将被钉住的审批任务身份。 */
interface PinnedApprovalTask {
  readonly id: number;
  readonly node_instance_id: number;
  readonly round: number;
}

/**
 * 解析【此刻】属于本人、在该审批实例上的待办任务 —— 与 findPendingTask 用【完全相同】的查询。
 *
 * 这是 rank5 的钉子：park 发生在 handler 之前，而原本「这是哪一条待办任务」是在几分钟后的
 * 重放时才解析的。两处必须看同一条语义，否则钉住的与重放要批的会对不上。查询失败降级为 null
 * （与「本就没有待办」同样处理：都不 park），绝不让一次基础设施抖动把高危写静默放过或 500。
 *
 * 【仅审批动作调用】—— 只有 instanceId !== null 时才走到这里，非审批高危写不受影响。
 */
const resolvePinnedApprovalTask = async (
  db: D1Database,
  instanceId: number,
  userId: string
): Promise<PinnedApprovalTask | null> => {
  try {
    const row = await db
      .prepare(
        `SELECT id, node_instance_id, round FROM approval_task WHERE instance_id = ? AND assignee_userid = ? AND status = 'pending' LIMIT 1`
      )
      .bind(instanceId, userId)
      .first<PinnedApprovalTask>();
    return row ?? null;
  } catch (error) {
    console.error("agent park: pending task resolution failed", { instanceId, error });
    return null;
  }
};

/**
 * 解析不到本人待办时的拒绝通路：不落行、不推卡片、不写 park 审计，只留一条 blocked 审计并回 409。
 *
 * 与限额触顶（429）同理，理由必须落在 data.status —— MCP 客户端的信封丢弃 HTTP 状态码。
 * 用独立的 action（agent.high_risk_park_no_task）与 blocked 状态，令这类探测可被发现、并与
 * 「真的 park 了」区分开。审计【await 落地】：此路径没有别的后台工作，失败只记日志、不改变响应。
 */
const noPendingTaskRefusal = async (env: Env, input: ParkRequestInput): Promise<Response> => {
  await writeAuditLog(env.DB, {
    actorUserId: input.identity.wecomUserid,
    actorRoles: input.identity.roles,
    action: "agent.high_risk_park_no_task",
    targetType: "agent_request",
    targetId: input.path,
    status: "blocked",
    detail: {
      via: "mcp",
      grant_id: input.identity.grantId,
      action_kind: input.rule.actionKind,
      method: input.method.toUpperCase()
    }
  }).catch((err) => {
    console.error("agent park: no-task audit failed", err);
  });

  const message =
    "当前该审批单没有属于你的待办任务（可能已被处理或已流转），无法发起确认。";
  return new Response(
    JSON.stringify({
      success: false,
      data: { status: "no_pending_task", message },
      error: { message }
    }),
    {
      status: 409,
      headers: { "content-type": "application/json" }
    }
  );
};

/**
 * 落库 + 通知 + 审计，返回给智能体的 202。
 *
 * @param waitUntil 由中间件传入的后台任务登记器。vitest 下没有 executionCtx，
 *                  调用方需自行降级为 fire-and-forget（见 middleware/auth.ts）。
 */
export const parkAgentRequest = async (
  env: Env,
  input: ParkRequestInput,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<Response> => {
  // 路径一律用闸门归一化过的 input.path；url 只贡献 query（重放需要连 query 一起还原，
  // 缺了 query 就是另一个请求了）。两者分开存，是因为签名只能绑定闸门看得到的那部分（无 query）。
  const search = new URL(input.url).search;

  // 员工据以判断的一切都在这里成形：一次 approval_instance 查询取业务上下文，
  // 外加从 body 里解析出【智能体填写的意见】——那段话将以员工本人的名义进入正式审批记录。
  // 查询失败一律降级为 null（loadApprovalContext 承诺不抛），park 绝不因文案而失败。
  const instanceId = parseApprovalInstanceId(input.path);

  // rank5：审批动作在 park 当刻就把「这是哪一条待办任务」钉死（node_instance_id / round 一并留存）。
  // 解析不到本人的在办任务（已被处理 / 已流转 / 从来就没有）→ 不 park、不落行、不推卡片，
  // 立即 409 让智能体知道，避免推一张对方根本无法确认、还白占滚动预算的噪声卡片。
  // 【仅审批动作】：instanceId === null（未来的非审批高危写）不走这条解析，行为不受影响。
  let pinnedTask: PinnedApprovalTask | null = null;
  if (instanceId !== null) {
    pinnedTask = await resolvePinnedApprovalTask(env.DB, instanceId, input.identity.wecomUserid);
    if (pinnedTask === null) {
      return noPendingTaskRefusal(env, input);
    }
  }

  const approval = instanceId === null ? null : await loadApprovalContext(env.DB, instanceId);
  const detail = buildActionDetail({
    actionKind: input.rule.actionKind,
    path: input.path,
    body: input.body,
    approval
  });
  const summary = buildSummary(detail);

  const snapshot: RequestSnapshot = {
    method: input.method.toUpperCase(),
    path: input.path,
    search,
    headers: snapshotHeaders(input.headers),
    body: input.body
  };

  const outcome = await parkPendingAction(env.DB, {
    grantId: input.identity.grantId,
    wecomUserid: input.identity.wecomUserid,
    actionKind: input.rule.actionKind,
    riskReason: input.rule.riskReason,
    summary,
    snapshot,
    detail,
    // rank5：把 park 当刻钉住的任务身份一并落库（非审批动作 pinnedTask 为 null → 三列 NULL）。
    target_task_id: pinnedTask?.id ?? null,
    target_node_instance_id: pinnedTask?.node_instance_id ?? null,
    target_round: pinnedTask?.round ?? null
  });

  if (outcome.kind === "refused") {
    // 审计【必须落地】才有意义：这条记录是「某枚令牌正在刷卡片」唯一的可发现信号，
    // 且此路径没有别的后台工作要做，故直接 await（失败只记日志，绝不改变响应）。
    await writeAuditLog(env.DB, {
      actorUserId: input.identity.wecomUserid,
      actorRoles: input.identity.roles,
      action: "agent.high_risk_park_refused",
      targetType: "agent_request",
      targetId: input.path,
      status: "blocked",
      detail: {
        via: "mcp",
        grant_id: input.identity.grantId,
        action_kind: input.rule.actionKind,
        method: snapshot.method,
        reason: outcome.reason,
        count: outcome.count,
        max: outcome.max
      }
    }).catch((err) => {
      console.error("agent park: refusal audit failed", err);
    });

    // 两种拒绝对员工/运维意味着完全不同的下一步：一个是「先处理掉几张卡片」，
    // 另一个是「这枚令牌今天已经刷爆了，处理卡片也没用」。文案必须分开。
    const message =
      outcome.reason === "too_many_outstanding"
        ? `待确认的高危动作已达在途上限（${outcome.max} 条），请先在企业微信里处理已推送的确认卡片，再重试本次操作。`
        : `该授权在过去 ${Math.round(outcome.windowSeconds / 3600)} 小时内发起的高危动作已达上限（${outcome.max} 次），请稍后再试；若非本人操作请立即在网页端吊销该授权。`;

    return new Response(
      JSON.stringify({
        // success:false 让 MCP 客户端把 error.message 抛成 ApiError（它对 !res.ok 只读 error）；
        // data 里的机器可读理由则服务于任何直接读信封的调用方 —— HTTP 429 本身在那一层被丢弃。
        success: false,
        data: {
          status: "park_refused",
          reason: outcome.reason,
          count: outcome.count,
          max: outcome.max,
          // 兼容既有调用方：在途触顶时保留原有的两个键名。
          ...(outcome.reason === "too_many_outstanding"
            ? { outstanding: outcome.count, max_outstanding: outcome.max }
            : { window_seconds: outcome.windowSeconds }),
          message
        },
        error: { message }
      }),
      {
        status: 429,
        headers: { "content-type": "application/json" }
      }
    );
  }

  const parked = outcome;

  // 卡片与审计都不影响 park 的成败：行已提交，员工从确认页照样能处理。
  const background = (async () => {
    const grant = await getGrantById(env.DB, input.identity.grantId).catch((err) => {
      console.error("agent park: grant lookup failed", err);
      return null;
    });
    await pushConfirmCard(env, {
      wecomUserid: input.identity.wecomUserid,
      summary,
      riskReason: input.rule.riskReason,
      confirmToken: parked.confirmToken,
      deviceName: grant?.device_name ?? null,
      // 员工将要署名的那段话必须出现在卡片上，否则他的同意仍是瞎的。
      agentComment: detail.agent_comment
    });
    await writeAuditLog(env.DB, {
      actorUserId: input.identity.wecomUserid,
      actorRoles: input.identity.roles,
      action: "agent.high_risk_parked",
      targetType: "agent_pending_action",
      targetId: parked.id,
      detail: {
        via: "mcp",
        grant_id: input.identity.grantId,
        action_kind: input.rule.actionKind,
        method: snapshot.method,
        // 审计同样记归一化后的路径：审计与卡片、签名必须描述同一个动作。
        path: input.path
      }
    });
  })().catch((err) => {
    console.error("agent park: background notify/audit failed", err);
  });
  waitUntil(background);

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        // 机器可读的「还没发生」信号。MCP 客户端丢弃状态码，只认这里。
        status: "awaiting_confirmation",
        pending_action_id: parked.id,
        expires_at: parked.expiresAt,
        action_kind: input.rule.actionKind,
        summary,
        message: "该操作属于高危写，已推送企业微信卡片给本人确认；确认后才会执行。"
      }
    }),
    {
      status: 202,
      headers: { "content-type": "application/json" }
    }
  );
};
