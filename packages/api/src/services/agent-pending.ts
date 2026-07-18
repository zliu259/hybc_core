/**
 * agent_pending_action 的持久化与状态机 —— P2「高危写延迟执行 + 本人微信确认」链路的存储层。
 *
 * 状态流转（单向，无回退）：
 *   pending ──confirm──▶ confirmed ──claim──▶ executing ──finish──▶ done / failed
 *      └────reject────▶ rejected
 *   （pending / confirmed 过期后由 toPublicView 惰性呈现为 expired，不落库改写）
 *
 * ## 为什么每一步都是「条件 UPDATE + 行数判定」
 *
 * 生产 D1 不支持事务回滚（BEGIN 会被静默降级），因此不存在「读—判断—写」这种可靠的临界区：
 * 两个并发请求各自 SELECT 到 status='confirmed'，都认为自己可以执行，就会把同一张审批单批两次。
 *
 * 唯一可靠的并发原语是单条 SQL 内的条件更新：
 *   UPDATE ... SET status = <next> WHERE id = ? AND status = <expected>
 * SQLite 对单条语句的行级更新是原子的，故无论多少并发，只有一方的 WHERE 能命中未被改写的旧状态，
 * 其 meta.changes 为 1，其余全为 0。**「至多执行一次」这一性质完全由 changes === 1 承载。**
 *
 * 由此推出本模块的硬性约定：每个流转函数的返回值必须直接来自本次 UPDATE 的 meta.changes，
 * 绝不允许「更新后再 SELECT 一次看状态对不对」——回读发生在临界区之外，读到的可能正是竞争对手写下的
 * 同一个目标状态，于是两方都会认为自己赢了，恰好复现要防的双重执行。
 *
 * ## 为什么终态要把 request_snapshot 清空
 *
 * request_snapshot 里存着当初那个请求的完整 headers，其中包含 agent 的 Authorization Bearer 令牌
 * ——重放必须原样带上它，才能走完整的中间件栈与业务 handler。但这等于把一枚长期有效（180 天）的
 * 凭据明文落在了 D1 里。它只在「等待确认 → 重放执行」这段窗口内有存在的必要；
 * 一旦动作进入终态（rejected / done / failed），快照再无用途，继续留存就纯粹是凭据泄漏面。
 * 故 reject 与 finish 的 UPDATE 都带 request_snapshot = ''，把令牌的驻留时间压到最短。
 */

import { sha256Hex } from "./agent-replay";
import type { AgentPendingRow, PendingPublicView, RequestSnapshot } from "../types/agent";

/** 待确认动作的有效期：10 分钟。够员工收到企微卡片并确认，又不至于让令牌快照长期驻留。 */
export const PENDING_TTL_SECONDS = 600;

/** 卡死 executing 行的清扫宽限期：1 小时，远超一次正常重放的耗时，不会误伤在途请求。 */
export const STALE_EXECUTING_GRACE_SECONDS = 3600;

export interface ParkInput {
  grantId: string;
  wecomUserid: string;
  actionKind: string;
  summary: string;
  snapshot: RequestSnapshot;
  riskReason?: string;
}

export interface ParkResult {
  id: string;
  /** 明文确认令牌，只在此刻返回一次；库里只存其 SHA-256。 */
  confirmToken: string;
  expiresAt: string;
}

export interface PendingResult {
  status: number;
  body: unknown;
}

/** 32 字节随机 hex —— 确认令牌会出现在企微卡片链接里，须不可枚举、不可预测。 */
const generateConfirmToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * 落库一条待确认动作。
 * id 用 crypto.randomUUID()（不含 ":"）——重放标记的签名载荷是 `${id}:${bodyHash}`，
 * id 内若出现 ":" 会造成分隔符歧义，进而让不同 (id, bodyHash) 对撞上同一载荷。
 */
export const parkPendingAction = async (
  db: D1Database,
  input: ParkInput
): Promise<ParkResult> => {
  const id = crypto.randomUUID();
  const confirmToken = generateConfirmToken();
  const confirmTokenHash = await sha256Hex(confirmToken);
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PENDING_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO agent_pending_action (id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason, summary, status, confirm_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.grantId,
      input.wecomUserid,
      input.actionKind,
      JSON.stringify(input.snapshot),
      input.riskReason ?? null,
      input.summary,
      "pending",
      confirmTokenHash,
      createdAt,
      expiresAt
    )
    .run();

  return { id, confirmToken, expiresAt };
};

export const getPendingById = async (
  db: D1Database,
  id: string
): Promise<AgentPendingRow | null> =>
  db
    .prepare(`SELECT * FROM agent_pending_action WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<AgentPendingRow>();

/** 按明文确认令牌查找：先哈希再比对，令牌明文绝不进 SQL 参数以外的任何地方。 */
export const getPendingByConfirmToken = async (
  db: D1Database,
  confirmToken: string
): Promise<AgentPendingRow | null> => {
  if (!confirmToken) {
    return null;
  }
  const hash = await sha256Hex(confirmToken);
  return db
    .prepare(`SELECT * FROM agent_pending_action WHERE confirm_token_hash = ? LIMIT 1`)
    .bind(hash)
    .first<AgentPendingRow>();
};

/**
 * pending → confirmed。WHERE 同时守 status 与 expires_at：
 * 过期行不落库改状态（见 toPublicView 的惰性判定），但也绝不允许被确认。
 * @returns 本次调用是否是赢家（重复确认返回 false）
 */
export const confirmPending = async (db: D1Database, id: string): Promise<boolean> => {
  const nowIso = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`
    )
    .bind(nowIso, id, nowIso)
    .run();
  return result.meta.changes === 1;
};

/**
 * pending → rejected，并顺手清空含 Bearer 令牌的请求快照（终态不再需要重放）。
 * 不守 expires_at：过期动作允许被显式拒绝（用户点「拒绝」总该有效果），只是无论如何都不会被执行。
 */
export const rejectPending = async (db: D1Database, id: string): Promise<boolean> => {
  const result = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'rejected', request_snapshot = '' WHERE id = ? AND status = 'pending'`
    )
    .bind(id)
    .run();
  return result.meta.changes === 1;
};

/**
 * confirmed → executing：真正的「至多执行一次」闸门。
 * 重放执行前必须先抢到这一步，抢不到（false）就说明另一路已在执行，本路必须原地放弃。
 */
export const claimForExecution = async (db: D1Database, id: string): Promise<boolean> => {
  const result = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`
    )
    .bind(id)
    .run();
  return result.meta.changes === 1;
};

/**
 * executing → done / failed，写入结果快照并清空请求快照（令牌到此彻底离开 D1）。
 * failed 表示业务侧返回了非成功响应，与「链路故障」不作区分——结果快照里存有真实 status/body 供排查。
 */
export const finishPending = async (
  db: D1Database,
  id: string,
  status: "done" | "failed",
  result: PendingResult
): Promise<boolean> => {
  const nowIso = new Date().toISOString();
  const updated = await db
    .prepare(
      `UPDATE agent_pending_action SET status = ?, result_snapshot = ?, request_snapshot = '', executed_at = ? WHERE id = ? AND status = 'executing'`
    )
    .bind(status, JSON.stringify(result), nowIso, id)
    .run();
  return updated.meta.changes === 1;
};

/**
 * 清扫卡在 executing 的行。
 *
 * worker 在 claim 与 finish 之间被回收（CPU 超时、实例驱逐、重放中抛出未捕获异常）时，行会永久停在
 * executing：confirm/claim/finish 的守卫都不再匹配，没有任何路径能推动它。后果不只是状态难看——
 * request_snapshot 里那枚 agent bearer 令牌会**无限期驻留 D1**，直接违背本模块头部承诺的令牌卫生。
 *
 * 超过宽限期即抹掉快照并标 failed。仍是单条条件 UPDATE（唯一一条会命中多行的），行数即清扫数。
 *
 * 注意宽限期是从 created_at 起算，而非从 claim 起算——表里没有 claimed_at 列，created_at 是唯一可用的钟。
 * 故实际留给重放的时间是 grace 减去确认窗口（最多 10 分钟），1 小时的默认值下仍有 ≥50 分钟，绰绰有余。
 *
 * 标成 failed 而非 expired：这行确实进过 executing，写**可能已经落库**，failed 只断言「我们没能记录到
 * 成功结果」，不谎称什么都没发生。result_snapshot 里写明 swept，便于事后与业务表核对。
 *
 * @returns 本次清扫掉的行数
 */
export const sweepStalePendingActions = async (
  db: D1Database,
  graceSeconds = STALE_EXECUTING_GRACE_SECONDS
): Promise<number> => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - graceSeconds * 1000).toISOString();
  const resultSnapshot = JSON.stringify({
    swept: true,
    reason: "execution did not report back within the grace period",
    grace_seconds: graceSeconds,
    swept_at: nowIso
  });

  const updated = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'failed', request_snapshot = '', result_snapshot = ?, executed_at = ? WHERE status = 'executing' AND executed_at IS NULL AND created_at < ?`
    )
    .bind(resultSnapshot, nowIso, cutoff)
    .run();
  return updated.meta.changes ?? 0;
};

const parseResult = (id: string, raw: string | null): unknown | null => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    // 结果快照损坏不应让整个查询失败：调用方拿到 null 即可，真实内容仍在库里可人工排查。
    // 但也绝不能静默——快照是我们唯一的执行留痕，它解析不出来本身就是需要有人去看的异常。
    console.error("agent pending result_snapshot parse failed", { pendingId: id, error });
    return null;
  }
};

/**
 * 面向 MCP 轮询与确认页的安全投影：**只**挑 PendingPublicView 声明的字段。
 * 刻意不做 `{ ...row, request_snapshot: undefined }` 之类的「删字段」写法——
 * 那是黑名单，将来给表加一列敏感字段就会默默泄漏；白名单投影则默认不泄漏。
 * 被排除的：request_snapshot（内含 Bearer 令牌）、confirm_token_hash（可用于离线爆破确认链接）、
 * grant_id / wecom_userid（横向关联信息，调用方已知自己是谁，无需回传）。
 *
 * ## expires_at 只界定「确认窗口」，不界定动作的整个生命周期
 *
 * 惰性呈现：库里不跑定时任务把 pending 改写成 expired（Worker 无常驻进程，且过期本身已由
 * confirmPending 的 WHERE 守住），故读时按 expires_at 现算。但**只有 pending 会被改标为 expired**。
 * 读者把 expired 理解成「这件事永远不会发生了」，所以这个标签只在它确实为真时才能出现：
 * - pending 且过期：confirmPending 的 WHERE 已让它再也无法被确认 → 确实永远不会发生，expired 属实。
 * - confirmed 且过期：claimForExecution **刻意不看 expires_at**（加了过期守卫会把合法确认过的动作
 *   永久卡死），它随时仍可能被执行。标成 expired 就是先告诉用户「没发生」、随后它却执行了。
 * - executing 且过期：写可能**已经落库**。这是最危险的一档——谎称 expired 等于谎称什么都没发生。
 * - done / failed / rejected：早已结算，与时间无关。
 */
export const toPublicView = (row: AgentPendingRow): PendingPublicView => {
  const isExpired = row.status === "pending" && row.expires_at <= new Date().toISOString();
  return {
    id: row.id,
    action_kind: row.action_kind,
    summary: row.summary,
    status: isExpired ? "expired" : row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    confirmed_at: row.confirmed_at,
    executed_at: row.executed_at,
    result: parseResult(row.id, row.result_snapshot)
  };
};
