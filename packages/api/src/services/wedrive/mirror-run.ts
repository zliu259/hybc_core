/**
 * 镜像的排队和排空。
 * 资料的上传、改、删只做一件事：把那一行标成 pending，再往队列里发一条「去排空」。
 * 排空在队列消费者里跑，一次只有一个（system_config 里的锁），按 id 从小到大逐份对到微盘。
 * 每小时的定时任务把卡住的、失败未满次数的重新排上。
 */
import type { Env } from "../../types/env";
import { publishEvent } from "../event-bus";
import { createWedriveClient, WedriveQuotaError, type WedriveClient } from "./client";
import { reconcileDoc } from "./mirror-doc";
import { notifyMirrorPaused } from "./notify";
import { getWedriveSettings, mirrorActive, saveWedriveSetting } from "./settings";

export const MIRROR_MAX_ATTEMPTS = 5;

export interface DrainResult {
  processed: number;
  failed: number;
  remaining: number;
  /** failing：连着几份因为同一个原因失败，这一趟不再往下做 */
  stopped: "done" | "budget" | "locked" | "inactive" | "paused" | "failing";
}

export interface DrainDeps {
  client?: WedriveClient;
  now?: () => Date;
  maxDocs?: number;
  maxBytes?: number;
  maxMs?: number;
  /** 暂停时通知超管；默认发企微消息 */
  notify?: (reason: string) => Promise<void>;
}

const EVENT_SOURCE = "wedrive-mirror";
const SYSTEM_USER = "system";
const LOCK_KEY = "warehouse.wedrive_lock_until";
/**
 * 锁的有效期。队列消费者一次最多跑 15 分钟，所以 16 分钟之后还没续上的锁，持有它的那次调用一定已经没了；
 * 比这短的话，一份大文件传得慢时锁会在它还活着的时候被别人抢走。
 */
const LOCK_MS = 16 * 60 * 1000;
const STALE_SYNCING_MS = 30 * 60 * 1000;
const DEFAULT_MAX_DOCS = 25;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_MS = 4 * 60 * 1000;
const MAX_ERROR_LENGTH = 200;
/**
 * 连着这么多份因为同一个原因失败，多半是微盘那头或网络出了问题，不是资料的问题：这一趟停下，剩下的留到下个整点。
 * 不停的话，一次故障会把所有待镜像的资料各耗掉一次机会，还白白用掉每月的调用次数。
 */
const SAME_FAILURE_LIMIT = 3;
const BUDGET_REASON = "本月微盘接口调用次数已经用到预算";
/** D1 一条语句最多 100 个参数 */
const MARK_CHUNK = 90;

const changesOf = (result: D1Result): number => Number(result.meta?.changes ?? 0);

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);

const countPending = async (env: Env): Promise<number> => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM doc_file WHERE mirror_status = 'pending'"
  ).first<{ n: number }>();
  return Number(row?.n ?? 0);
};

/** 往队列里发一条「去排空」。永不抛出。 */
export const kickMirrorDrain = async (env: Env): Promise<void> => {
  try {
    await publishEvent(env, "WAREHOUSE_DOC_MIRROR", EVENT_SOURCE, {});
  } catch (error) {
    console.error("微盘镜像：发排空消息失败", error);
  }
};

/** 把这些资料标成待镜像并触发一次排空。永不抛出。镜像没开时只标记不触发。 */
export const markForMirror = async (env: Env, docIds: number[]): Promise<void> => {
  try {
    const ids = [...new Set(docIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return;
    for (let offset = 0; offset < ids.length; offset += MARK_CHUNK) {
      const part = ids.slice(offset, offset + MARK_CHUNK);
      await env.DB.prepare(
        `UPDATE doc_file SET mirror_status = 'pending', mirror_attempts = 0, mirror_error = NULL
          WHERE id IN (${part.map(() => "?").join(", ")})`
      )
        .bind(...part)
        .run();
    }
    if (mirrorActive(await getWedriveSettings(env))) await kickMirrorDrain(env);
  } catch (error) {
    console.error("微盘镜像：标记待镜像失败", error);
  }
};

/** 定时任务用：把卡住的、失败未满 5 次的重新标成 pending，有待办就触发一次排空。永不抛出。 */
export const requeueStaleMirrors = async (env: Env, now: Date): Promise<number> => {
  try {
    const staleBefore = new Date(now.getTime() - STALE_SYNCING_MS).toISOString();
    const result = await env.DB.prepare(
      `UPDATE doc_file SET mirror_status = 'pending'
        WHERE (mirror_status = 'syncing' AND (mirror_started_at IS NULL OR mirror_started_at < ?))
           OR (mirror_status = 'failed' AND mirror_attempts < ?)`
    )
      .bind(staleBefore, MIRROR_MAX_ATTEMPTS)
      .run();
    const requeued = changesOf(result);
    if ((await countPending(env)) > 0 && mirrorActive(await getWedriveSettings(env))) {
      await kickMirrorDrain(env);
    }
    return requeued;
  } catch (error) {
    console.error("微盘镜像：补跑失败", error);
    return 0;
  }
};

// ─── 锁 ────────────────────────────────────────────────────────────────────
// 值是「到期时间 + 空格 + 这次排空的记号」。到期时间在前，所以直接按字符串比就能判断过没过期。

const lockValue = (now: Date, token: string): string =>
  `${new Date(now.getTime() + LOCK_MS).toISOString()} ${token}`;

/** 原来没人持锁、或者锁已经过期，才写成自己的。看影响行数知道抢没抢到。 */
const acquireLock = async (env: Env, now: Date, token: string): Promise<string | null> => {
  const value = lockValue(now, token);
  const stamp = now.toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO system_config (config_key, config_value, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(config_key) DO UPDATE SET
       config_value = excluded.config_value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at
     WHERE system_config.config_value = '' OR system_config.config_value < ?`
  )
    .bind(LOCK_KEY, value, SYSTEM_USER, stamp, stamp, stamp)
    .run();
  return changesOf(result) > 0 ? value : null;
};

/** 续期：锁还是自己的才续。返回新的值；锁已经不是自己的了返回 null。 */
const extendLock = async (
  env: Env,
  now: Date,
  token: string,
  held: string
): Promise<string | null> => {
  const value = lockValue(now, token);
  const result = await env.DB.prepare(
    "UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = ? AND config_value = ?"
  )
    .bind(value, now.toISOString(), LOCK_KEY, held)
    .run();
  return changesOf(result) > 0 ? value : null;
};

/** 只清自己的锁。 */
const releaseLock = async (env: Env, held: string): Promise<void> => {
  await env.DB.prepare(
    "UPDATE system_config SET config_value = '' WHERE config_key = ? AND config_value = ?"
  )
    .bind(LOCK_KEY, held)
    .run();
};

// ─── 排空 ──────────────────────────────────────────────────────────────────

interface PendingDoc {
  id: number;
  file_size: number;
  wedrive_fileid: string | null;
}

/** 下一份：没试过的在前，试过的排在后面，免得几份有毛病的资料每次都挡在前头。 */
const nextPending = (env: Env): Promise<PendingDoc | null> =>
  env.DB.prepare(
    `SELECT id, file_size, wedrive_fileid FROM doc_file
      WHERE mirror_status = 'pending' ORDER BY mirror_attempts, id LIMIT 1`
  ).first<PendingDoc>();

/** 认领一份：只有它还是 pending 才标成 syncing。 */
const claim = async (env: Env, id: number, now: Date): Promise<boolean> => {
  const result = await env.DB.prepare(
    `UPDATE doc_file SET mirror_status = 'syncing', mirror_attempts = mirror_attempts + 1,
            mirror_started_at = ?
      WHERE id = ? AND mirror_status = 'pending'`
  )
    .bind(now.toISOString(), id)
    .run();
  return changesOf(result) > 0;
};

const markFailed = async (env: Env, id: number, error: unknown): Promise<void> => {
  await env.DB.prepare(
    "UPDATE doc_file SET mirror_status = 'failed', mirror_error = ? WHERE id = ? AND mirror_status = 'syncing'"
  )
    .bind(errorText(error), id)
    .run();
};

/** 限额用完不是这份资料的问题：退回 pending，这一次不算次数。 */
const releaseClaim = async (env: Env, id: number): Promise<void> => {
  await env.DB.prepare(
    `UPDATE doc_file SET mirror_status = 'pending', mirror_attempts = MAX(mirror_attempts - 1, 0)
      WHERE id = ? AND mirror_status = 'syncing'`
  )
    .bind(id)
    .run();
};

const pauseReason = (error: WedriveQuotaError): string =>
  error.errcode === null
    ? BUDGET_REASON
    : `企微限制了微盘接口的调用次数（错误码 ${error.errcode}）`;

const pause = async (
  env: Env,
  error: WedriveQuotaError,
  notify: (reason: string) => Promise<void>
): Promise<void> => {
  const reason = pauseReason(error);
  await saveWedriveSetting(env, { paused_reason: reason }, SYSTEM_USER);
  try {
    await notify(reason);
  } catch (notifyError) {
    console.error("微盘镜像：暂停通知失败", notifyError);
  }
};

export const runMirrorDrain = async (env: Env, deps: DrainDeps = {}): Promise<DrainResult> => {
  const now = deps.now ?? (() => new Date());
  const maxDocs = deps.maxDocs ?? DEFAULT_MAX_DOCS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxMs = deps.maxMs ?? DEFAULT_MAX_MS;
  const notify = deps.notify ?? ((reason: string) => notifyMirrorPaused(env, reason));
  const idle = async (stopped: DrainResult["stopped"]): Promise<DrainResult> => ({
    processed: 0,
    failed: 0,
    remaining: await countPending(env),
    stopped
  });

  const settings = await getWedriveSettings(env);
  if (settings.space_id === null || !settings.enabled) return idle("inactive");
  if (settings.paused_reason !== null) return idle("paused");

  const token = crypto.randomUUID();
  let held = await acquireLock(env, now(), token);
  if (held === null) return idle("locked");

  const client = deps.client ?? createWedriveClient(env, { now });
  const startedAt = now().getTime();
  let processed = 0;
  let failed = 0;
  let bytes = 0;
  let lastFailure: string | null = null;
  let sameFailures = 0;
  let stopped: DrainResult["stopped"] = "done";
  try {
    for (;;) {
      const overBudget =
        processed + failed >= maxDocs || bytes >= maxBytes || now().getTime() - startedAt >= maxMs;
      const doc = await nextPending(env);
      if (!doc) break;
      if (overBudget) {
        stopped = "budget";
        break;
      }
      if (!(await claim(env, doc.id, now()))) continue;
      try {
        await reconcileDoc(env, client, settings, doc.id);
        processed += 1;
        lastFailure = null;
        sameFailures = 0;
      } catch (error) {
        if (error instanceof WedriveQuotaError) {
          await releaseClaim(env, doc.id);
          await pause(env, error, notify);
          stopped = "paused";
          break;
        }
        await markFailed(env, doc.id, error);
        failed += 1;
        const reason = errorText(error);
        sameFailures = reason === lastFailure ? sameFailures + 1 : 1;
        lastFailure = reason;
      }
      // 没有文件 ID 的才会上传；改名、移动、删除不占字节数
      if (!doc.wedrive_fileid) bytes += Number(doc.file_size);
      held = await extendLock(env, now(), token, held);
      if (held === null) {
        // 锁被别人接走了（这一份做得太久）：不再往下做，也不去清别人的锁
        stopped = "locked";
        break;
      }
      if (sameFailures >= SAME_FAILURE_LIMIT) {
        stopped = "failing";
        break;
      }
    }
  } finally {
    if (held !== null) await releaseLock(env, held);
  }

  const remaining = await countPending(env);
  // 做到上限停下的、或者收尾时正好又有新的进来：再发一条接着跑
  if (remaining > 0 && (stopped === "budget" || stopped === "done")) await kickMirrorDrain(env);
  return { processed, failed, remaining, stopped };
};
