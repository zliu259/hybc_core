/**
 * 库房每日摘要：低库存、超期任务、待检超过 3 天的设备、到期的证书。
 * 每小时的定时任务在北京时间 8 点调用 publishDailyDigestIfDue；真正的内容在投递那一刻由 collectDigest 现算。
 */
import type { Env } from "../../types/env";
import { EXPIRING_DAYS, IS_LATEST } from "../doc-library/query";
import { publishEvent } from "../event-bus";
import { listKeeperUserids } from "./access";
import { LOW_STOCK_SQL } from "./material";
import { getWarehouseSettings } from "./settings";

export interface DigestSection {
  count: number;
  /** 最多 3 个 */
  examples: string[];
}

export interface WarehouseDigest {
  /** 北京日期 YYYY-MM-DD */
  date: string;
  /** 例子是「品名 规格」 */
  low_stock: DigestSection;
  /** 例子是任务标题 */
  overdue_tasks: DigestSection;
  /** 例子是设备编号 */
  stale_inspections: DigestSection;
  /** 例子是资料标题 */
  certs_soon: DigestSection;
  certs_expired: DigestSection;
}

export type DigestPublishOutcome =
  | "published"
  | "not_due"
  | "already"
  | "disabled"
  | "no_keeper"
  | "empty"
  | "error";

const EXAMPLE_LIMIT = 3;
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const DIGEST_HOUR = 8;
/** 返库检查超过这么久没做，算「待检太久」 */
const STALE_INSPECTION_MS = 3 * DAY_MS;
/** 「今天发过了」的标记留几天就够了 */
const SENT_FLAG_TTL_SECONDS = 3 * 86400;

const beijing = (now: Date, offsetDays = 0): Date =>
  new Date(now.getTime() + BEIJING_OFFSET_MS + offsetDays * DAY_MS);
const beijingDate = (now: Date, offsetDays = 0): string =>
  beijing(now, offsetDays).toISOString().slice(0, 10);
const beijingHour = (now: Date): number => beijing(now).getUTCHours();

/** 当天已发的标记 */
export const digestSentKey = (date: string): string => `warehouse:digest:${date}`;

const CERT_LIVE_SQL = `f.deleted_at IS NULL AND ${IS_LATEST} AND f.valid_until IS NOT NULL`;

/** 一段：先数总数，再取前几个当例子。fromWhere 从 FROM 开始，label 是要显示的那一列。 */
const section = async (
  env: Env,
  label: string,
  fromWhere: string,
  orderBy: string,
  params: readonly (string | number)[]
): Promise<DigestSection> => {
  const [count, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${fromWhere}`)
      .bind(...params)
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT ${label} AS label ${fromWhere} ORDER BY ${orderBy} LIMIT ?`)
      .bind(...params, EXAMPLE_LIMIT)
      .all<{ label: string }>()
  ]);
  return {
    count: Number(count?.n ?? 0),
    examples: (rows.results ?? []).map((row) => String(row.label ?? "").trim())
  };
};

/** 快到期和已过期的证书各多少份（总览上的数字也用它）。 */
export const countCertsNeedingAttention = async (env: Env, now: Date): Promise<number> => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM doc_file f WHERE ${CERT_LIVE_SQL} AND f.valid_until <= ?`
  )
    .bind(beijingDate(now, EXPIRING_DAYS))
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
};

export const collectDigest = async (env: Env, now: Date): Promise<WarehouseDigest> => {
  const today = beijingDate(now);
  const staleBefore = new Date(now.getTime() - STALE_INSPECTION_MS).toISOString();
  const [lowStock, overdue, stale, soon, expired] = await Promise.all([
    section(
      env,
      "TRIM(m.name || ' ' || COALESCE(m.spec, ''))",
      `FROM material m WHERE m.status = 'active' AND ${LOW_STOCK_SQL}`,
      "m.id ASC",
      []
    ),
    section(
      env,
      "t.title",
      `FROM wh_task t WHERE t.status IN ('todo', 'submitted') AND t.due_date IS NOT NULL AND t.due_date < ?`,
      "t.due_date ASC, t.id ASC",
      [today]
    ),
    section(
      env,
      "d.device_code",
      `FROM device d WHERE d.location = 'warehouse' AND EXISTS (
         SELECT 1 FROM wh_task t
          WHERE t.device_id = d.id AND t.kind = 'inspection' AND t.blocking = 1
            AND t.status IN ('todo', 'submitted') AND t.created_at < ?)`,
      "d.device_code ASC",
      [staleBefore]
    ),
    section(
      env,
      "f.title",
      `FROM doc_file f WHERE ${CERT_LIVE_SQL} AND f.valid_until >= ? AND f.valid_until <= ?`,
      "f.valid_until ASC, f.id ASC",
      [today, beijingDate(now, EXPIRING_DAYS)]
    ),
    section(
      env,
      "f.title",
      `FROM doc_file f WHERE ${CERT_LIVE_SQL} AND f.valid_until < ?`,
      "f.valid_until ASC, f.id ASC",
      [today]
    )
  ]);
  return {
    date: today,
    low_stock: lowStock,
    overdue_tasks: overdue,
    stale_inspections: stale,
    certs_soon: soon,
    certs_expired: expired
  };
};

export const isEmptyDigest = (digest: WarehouseDigest): boolean =>
  [
    digest.low_stock,
    digest.overdue_tasks,
    digest.stale_inspections,
    digest.certs_soon,
    digest.certs_expired
  ].every((part) => part.count === 0);

/**
 * 定时任务里调用，永不抛出。北京时间 8 点、开关开着、有库管、有内容，才发一个摘要事件。
 * 先占「今天发过了」的标记再发布，发布失败再把标记撤掉：同一小时触发两次时只发一次。
 * 注意 publishEvent 会吞掉队列发送的错误（只留日志），那种失败这里看不到，和别的库房通知一样。
 */
export const publishDailyDigestIfDue = async (
  env: Env,
  now: Date
): Promise<DigestPublishOutcome> => {
  if (beijingHour(now) !== DIGEST_HOUR) return "not_due";
  try {
    const date = beijingDate(now);
    const key = digestSentKey(date);
    if (await env.KV.get(key)) return "already";
    if (!(await getWarehouseSettings(env)).notify_enabled) return "disabled";
    if ((await listKeeperUserids(env)).length === 0) return "no_keeper";
    if (isEmptyDigest(await collectDigest(env, now))) return "empty";
    await env.KV.put(key, now.toISOString(), { expirationTtl: SENT_FLAG_TTL_SECONDS });
    try {
      await publishEvent(env, "WAREHOUSE_NOTICE", "warehouse", {
        kind: "daily_digest",
        date,
        actor_userid: "system"
      });
    } catch (error) {
      await env.KV.delete(key);
      throw error;
    }
    return "published";
  } catch (error) {
    console.error("[warehouse] 每日摘要发布失败", error);
    return "error";
  }
};
