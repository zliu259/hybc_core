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

import { parseActionDetail, type PendingActionDetail } from "./agent-action-detail";
import { sha256Hex } from "./agent-replay";
import type { AgentPendingRow, PendingPublicView, RequestSnapshot } from "../types/agent";

/** 待确认动作的有效期：10 分钟。够员工收到企微卡片并确认，又不至于让令牌快照长期驻留。 */
export const PENDING_TTL_SECONDS = 600;

/** 卡死 executing 行的清扫宽限期：1 小时，远超一次正常重放的耗时，不会误伤在途请求。 */
export const STALE_EXECUTING_GRACE_SECONDS = 3600;

/**
 * 单个 grant 同时在途（pending 且未过期）的待确认动作上限 —— 这道闸管【并发】。
 *
 * 没有它，一枚泄漏的令牌可以循环 `POST /approval/{1..N}/approve`，把员工的企业微信
 * 埋进确认卡片里。这【直接攻击人在环控制本身】——通知疲劳是收割一次不经心确认的标准手法：
 * 淹没式推送里只要有一张被随手点了同意，攻击就成功了。而且每 park 一次就多存一份含
 * Bearer 令牌的请求快照，泄漏面的体量本来完全由调用方决定。
 *
 * 取 5：正常使用下一个人手里同时压着五件待确认高危写已属罕见，故几乎不会误伤。
 *
 * 【它保证的仅仅是「同时最多 5 张未处理的卡片」，不是「一共最多 5 张」。】
 * 计数只看 pending 且未过期：卡片一被拒绝、或确认窗口一过，额度立刻回收。于是
 *   park 满 5 → 员工逐条拒绝 → 计数归零 → 再 park 5 条
 * 可以无限循环，攻击者的产能反而【与员工的尽责程度成正比】。总量必须另有一道闸，
 * 见 MAX_PARKS_PER_ROLLING_DAY —— 两道正交，缺一不可。
 */
export const MAX_OUTSTANDING_PENDING_PER_GRANT = 5;

/**
 * 单个 grant 在滚动 24 小时内允许 park 的【总】次数 —— 这道闸管总量。
 *
 * 按 created_at 计数，且【不分状态】：已拒绝、已过期、已执行的行照样占额度。
 * 这正是它与在途上限的区别所在 —— 处理掉一张卡片不会退还预算，故「员工越认真、
 * 攻击者恢复得越快」这个倒置的激励在此被切断。
 *
 * 取 20：远高于任何正常人一天的高危写量（P2a 首批只放开审批 approve/reject），
 * 又低到让泛洪在员工能察觉的量级上就撞墙。触顶不是故障，是一条正常的审计化拒绝通路。
 */
export const MAX_PARKS_PER_ROLLING_DAY = 20;

/** 滚动预算的窗口长度（秒）。 */
export const PARK_BUDGET_WINDOW_SECONDS = 24 * 3600;

export interface ParkInput {
  grantId: string;
  wecomUserid: string;
  actionKind: string;
  summary: string;
  snapshot: RequestSnapshot;
  riskReason?: string;
  /** 员工据以判断的动作详情（动词 / 目标 / 业务上下文 / 智能体填写的意见）。 */
  detail?: PendingActionDetail | null;
  /**
   * rank5：park 当刻解析出的审批任务身份，钉进行里，重放时只认这一条。
   * 仅 agent 的 approval approve/reject 会传；其它 kind 不传（落 NULL）。
   */
  target_task_id?: number | null;
  target_node_instance_id?: number | null;
  target_round?: number | null;
}

/**
 * park 的结局。判别式联合而非「成功即返回 ParkResult、失败抛异常」：
 * 触顶是一个【预期内的正常裁决】，不是故障；用类型逼调用方显式处理这条分支，
 * 免得哪天有人在 catch 里把它和真实故障一起吞掉，限额就此形同虚设。
 */
export type ParkRefusal =
  | {
      readonly kind: "refused";
      /** 同时在途的卡片太多 —— 员工处理掉几张就能继续。 */
      readonly reason: "too_many_outstanding";
      readonly count: number;
      readonly max: number;
    }
  | {
      readonly kind: "refused";
      /** 24 小时总量刷爆 —— 处理卡片【不会】退还额度，必须等窗口滑过。 */
      readonly reason: "rolling_budget_exhausted";
      readonly count: number;
      readonly max: number;
      readonly windowSeconds: number;
    };

export type ParkOutcome =
  | {
      readonly kind: "parked";
      readonly id: string;
      /** 明文确认令牌，只在此刻返回一次；库里只存其 SHA-256。 */
      readonly confirmToken: string;
      readonly expiresAt: string;
    }
  | ParkRefusal;

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

/** 该 grant 当前在途（pending 且确认窗口未关）的待确认动作数。 */
export const countOutstandingPending = async (
  db: D1Database,
  grantId: string,
  nowIso: string = new Date().toISOString()
): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_pending_action WHERE grant_id = ? AND status = 'pending' AND expires_at > ?`
    )
    .bind(grantId, nowIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

/**
 * 该 grant 在滚动窗口内 park 过的动作【总数】—— 不分状态。
 *
 * 与 countOutstandingPending 的唯一实质区别就是「不分状态」：这里刻意不加 status 条件，
 * 也刻意不看 expires_at。已拒绝 / 已过期 / 已执行的行都必须继续占额度，否则这道闸
 * 会退化成第二个在途上限，而在途上限恰恰是它要补的洞。
 */
export const countParksInWindow = async (
  db: D1Database,
  grantId: string,
  windowSeconds: number = PARK_BUDGET_WINDOW_SECONDS,
  now: number = Date.now()
): Promise<number> => {
  const since = new Date(now - windowSeconds * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_pending_action WHERE grant_id = ? AND created_at > ?`
    )
    .bind(grantId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

/**
 * 落库一条待确认动作，或在该 grant 触顶时拒绝落库。
 *
 * id 用 crypto.randomUUID()（不含 ":"）——重放标记的签名载荷是 `${id}:${bodyHash}`，
 * id 内若出现 ":" 会造成分隔符歧义，进而让不同 (id, bodyHash) 对撞上同一载荷。
 *
 * 限额检查放在【存储层】而不是调用方：park 是这枚令牌在库里留下快照的唯一入口，
 * 闸门那侧将来若多出一条 park 路径，限额必须跟着走，不能靠每个调用方各记一次。
 * 计数与插入之间没有事务（生产 D1 无回滚），故并发峰值可能略微越线——这不影响本闸的
 * 目的：它要挡的是「一枚令牌刷出几百张卡片」，不是精确到个位的配额。
 */
export const parkPendingAction = async (
  db: D1Database,
  input: ParkInput
): Promise<ParkOutcome> => {
  const outstanding = await countOutstandingPending(db, input.grantId);
  if (outstanding >= MAX_OUTSTANDING_PENDING_PER_GRANT) {
    return {
      kind: "refused",
      reason: "too_many_outstanding",
      count: outstanding,
      max: MAX_OUTSTANDING_PENDING_PER_GRANT
    };
  }

  // 总量闸排在并发闸之后：两者互不替代，且这一条即便在途为 0 也可能触发（正是它的存在意义）。
  const parkedInWindow = await countParksInWindow(db, input.grantId);
  if (parkedInWindow >= MAX_PARKS_PER_ROLLING_DAY) {
    return {
      kind: "refused",
      reason: "rolling_budget_exhausted",
      count: parkedInWindow,
      max: MAX_PARKS_PER_ROLLING_DAY,
      windowSeconds: PARK_BUDGET_WINDOW_SECONDS
    };
  }

  const id = crypto.randomUUID();
  const confirmToken = generateConfirmToken();
  const confirmTokenHash = await sha256Hex(confirmToken);
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PENDING_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO agent_pending_action (id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason, summary, status, confirm_token_hash, created_at, expires_at, action_detail, target_task_id, target_node_instance_id, target_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      expiresAt,
      input.detail ? JSON.stringify(input.detail) : null,
      // rank5：钉住的审批任务身份（仅 approval approve/reject 传值，其余 NULL）。
      input.target_task_id ?? null,
      input.target_node_instance_id ?? null,
      input.target_round ?? null
    )
    .run();

  return { kind: "parked", id, confirmToken, expiresAt };
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
 * 清扫所有会让 request_snapshot（内含 agent bearer 令牌）无限期驻留 D1 的静止状态。
 *
 * 本模块头部承诺「令牌只在确认→重放这段窗口内存在」。兑现这个承诺不能只靠 reject/finish 这些
 * **happy path**——它们只覆盖了动作被推进到终态的情形。真正需要兜底的是那些**没有任何后续请求
 * 会再碰它们**的静止状态：所有状态流转函数的 WHERE 都不再匹配，行就此永远躺在库里带着一枚
 * 180 天有效的凭据。共有三类，全部在此收敛：
 *
 * 1.【executing 超过宽限期】worker 在 claim 与 finish 之间被回收（CPU 超时、实例驱逐）。
 *    标 failed：这行确实进过 executing，写**可能已经落库**，failed 只断言「我们没能记录到成功
 *    结果」，不谎称什么都没发生。
 *
 * 2.【confirmed 超过宽限期】确认路由在 confirmPending 与 claimForExecution 之间 await 了一次
 *    审计写，worker 若在此被回收，行就停在 confirmed —— confirm 要 pending、claim 已经过、
 *    finish 要 executing，三道守卫全不匹配。同样标 failed：员工确实确认过，但这次确认再也无法
 *    被兑现，必须如实呈现，不能让确认页永远显示「已确认，执行中」。
 *
 * 3.【pending 且已过期】员工无视卡片——**最常见的结局**，也是量最大的一类：智能体可以随意 park，
 *    这条泄漏面的体量由调用方决定。此类只抹快照、**不改状态**：expired 由 toPublicView 按
 *    expires_at 惰性呈现（见其文档），落库改写成别的状态会与那套语义打架。
 *    WHERE 带 `request_snapshot != ''` 保证幂等——否则每轮 cron 都会重复命中同一批行，
 *    让返回的行数永远大于 0，把「本次真的清掉了东西」这个信号变成噪声。
 *
 * 三条 UPDATE 的 WHERE 互斥（按 status 分区），故行数可直接相加而不会重复计数。
 * 每条仍是单条条件 UPDATE，行数即真实影响行数——不做「先 SELECT 再逐行更新」。
 *
 * 注意宽限期从 created_at 起算，而非从 claim/confirm 起算——表里没有 claimed_at 列，
 * created_at 是唯一可用的钟。故实际留给重放的时间是 grace 减去确认窗口（最多 10 分钟），
 * 1 小时的默认值下仍有 ≥50 分钟，绰绰有余。
 *
 * @returns 本次清扫掉的总行数（三类之和）
 */
export const sweepStalePendingActions = async (
  db: D1Database,
  graceSeconds = STALE_EXECUTING_GRACE_SECONDS
): Promise<number> => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - graceSeconds * 1000).toISOString();
  const sweptResult = (reason: string) =>
    JSON.stringify({
      swept: true,
      reason,
      grace_seconds: graceSeconds,
      swept_at: nowIso
    });

  const staleExecuting = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'failed', request_snapshot = '', result_snapshot = ?, executed_at = ? WHERE status = 'executing' AND executed_at IS NULL AND created_at < ?`
    )
    .bind(
      sweptResult("execution did not report back within the grace period"),
      nowIso,
      cutoff
    )
    .run();

  const staleConfirmed = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'failed', request_snapshot = '', result_snapshot = ?, executed_at = ? WHERE status = 'confirmed' AND created_at < ?`
    )
    .bind(
      sweptResult("confirmation was never claimed for execution within the grace period"),
      nowIso,
      cutoff
    )
    .run();

  const expiredPending = await db
    .prepare(
      `UPDATE agent_pending_action SET request_snapshot = '' WHERE status = 'pending' AND expires_at <= ? AND request_snapshot != ''`
    )
    .bind(nowIso)
    .run();

  return (
    (staleExecuting.meta.changes ?? 0) +
    (staleConfirmed.meta.changes ?? 0) +
    (expiredPending.meta.changes ?? 0)
  );
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
    // 详情在 park 时就已消毒定型（见 agent-action-detail.ts），此处只做解析与降级。
    detail: parseActionDetail(row.action_detail),
    created_at: row.created_at,
    expires_at: row.expires_at,
    confirmed_at: row.confirmed_at,
    executed_at: row.executed_at,
    result: parseResult(row.id, row.result_snapshot)
  };
};
