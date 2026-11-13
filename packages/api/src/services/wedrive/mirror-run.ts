/**
 * 镜像的排队和排空。
 * 资料的上传、改、删只做一件事：把那一行标成 pending，再往队列里发一条「去排空」。
 * 排空在队列消费者里跑，一次只有一个（system_config 里的锁），按 id 从小到大逐份对到微盘。
 * 每小时的定时任务把卡住的、失败未满次数的重新排上。
 */
import type { Env } from "../../types/env";
import { publishEvent } from "../event-bus";
import { getSystemConfig, setSystemConfig } from "../system-config";
import {
  createWedriveClient,
  SourceFileError,
  WedriveError,
  WedriveQuotaError,
  type WedriveClient
} from "./client";
import { reconcileDoc } from "./mirror-doc";
import { acquireLock, extendLock, releaseLock } from "./mirror-lock";
import { notifyMirrorPaused } from "./notify";
import {
  getWedriveSettings,
  mirrorActive,
  saveWedriveSetting,
  type WedriveSettings
} from "./settings";

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
/** 连着这么多趟都是这样停下的：不再每个整点去试，暂停并通知超管，等人来看 */
const TRIPS_BEFORE_PAUSE = 3;
const TRIP_KEY = "warehouse.wedrive_trip_count";
const INTERRUPTED_REASON = "同步中断了 5 次，多半是文件太大、一趟传不完";
/** f 是 doc_file 的别名：有一个没删除的新版本替换了它 */
const SUPERSEDED = `EXISTS (SELECT 1 FROM doc_file n WHERE n.supersedes_id = f.id AND n.deleted_at IS NULL)`;
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

/**
 * 对一遍账，不花微盘调用：写着「已同步」但和库里的样子对不上的，标回待镜像。
 * 资料的写操作只是「标一下」，那一步出错只记日志；没有这一遍的话，标丢了的那一次改动永远到不了微盘。
 *  - 微盘里还留着文件，但资料已经删除或被替换了
 *  - 该在微盘里（没删、是最新版）却没有文件：新版被删掉、上一版重新成了最新版
 *  - 同步之后资料又改过
 */
const sweepInconsistent = async (env: Env): Promise<number> => {
  const result = await env.DB.prepare(
    `UPDATE doc_file AS f SET mirror_status = 'pending'
      WHERE f.mirror_status = 'synced' AND (
        (f.wedrive_fileid IS NOT NULL AND (f.deleted_at IS NOT NULL OR ${SUPERSEDED}))
        OR (f.wedrive_fileid IS NULL AND f.deleted_at IS NULL AND NOT ${SUPERSEDED})
        OR (f.wedrive_fileid IS NOT NULL AND f.mirrored_at IS NOT NULL AND f.updated_at > f.mirrored_at)
      )`
  ).run();
  return changesOf(result);
};

/**
 * 定时任务用：把卡住的、失败未满 5 次的重新标成 pending，再对一遍账；有待办就触发一次排空。
 * 返回标回待镜像的份数。永不抛出。
 */
export const requeueStaleMirrors = async (env: Env, now: Date): Promise<number> => {
  try {
    const staleBefore = new Date(now.getTime() - STALE_SYNCING_MS).toISOString();
    // 同步到一半就没了下文、而且已经这样 5 次了：多半是这个文件一趟传不完，不再每小时从头传一遍
    await env.DB.prepare(
      `UPDATE doc_file SET mirror_status = 'failed', mirror_error = ?
        WHERE mirror_status = 'syncing' AND mirror_attempts >= ?
          AND (mirror_started_at IS NULL OR mirror_started_at < ?)`
    )
      .bind(INTERRUPTED_REASON, MIRROR_MAX_ATTEMPTS, staleBefore)
      .run();
    const result = await env.DB.prepare(
      `UPDATE doc_file SET mirror_status = 'pending'
        WHERE (mirror_status = 'syncing' AND (mirror_started_at IS NULL OR mirror_started_at < ?))
           OR (mirror_status = 'failed' AND mirror_attempts < ?)`
    )
      .bind(staleBefore, MIRROR_MAX_ATTEMPTS)
      .run();
    const requeued = changesOf(result) + (await sweepInconsistent(env));
    if ((await countPending(env)) > 0 && mirrorActive(await getWedriveSettings(env))) {
      await kickMirrorDrain(env);
    }
    return requeued;
  } catch (error) {
    console.error("微盘镜像：补跑失败", error);
    return 0;
  }
};

// ─── 排空 ──────────────────────────────────────────────────────────────────

interface PendingDoc {
  id: number;
  file_size: number;
  wedrive_fileid: string | null;
}

/**
 * 下一份。先做「该从微盘删掉的」（已删除或被替换的），再做要传的：
 * 旧的那一份还占着名字的时候传新的，新的会被加上「（2）」。
 * 同一类里没试过的在前，试过的排在后面，免得几份有毛病的资料每次都挡在前头。
 */
const nextPending = (env: Env): Promise<PendingDoc | null> =>
  env.DB.prepare(
    `SELECT f.id, f.file_size, f.wedrive_fileid FROM doc_file f
      WHERE f.mirror_status = 'pending'
      ORDER BY (f.deleted_at IS NULL AND NOT ${SUPERSEDED}), f.mirror_attempts, f.id LIMIT 1`
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

const quotaReason = (error: WedriveQuotaError): string =>
  error.errcode === null
    ? BUDGET_REASON
    : `企微限制了微盘接口的调用次数（错误码 ${error.errcode}）`;

/** 写上暂停原因并通知超管。通知发不出去只记日志。 */
const pause = async (
  env: Env,
  reason: string,
  notify: (reason: string) => Promise<void>
): Promise<void> => {
  const saved = await saveWedriveSetting(env, { paused_reason: reason }, SYSTEM_USER);
  try {
    await notify(saved.paused_reason ?? reason);
  } catch (notifyError) {
    console.error("微盘镜像：暂停通知失败", notifyError);
  }
};

/**
 * 这次失败算哪一类原因，用来判断「是不是连着几份都是同一个毛病」。
 * 企微的原话每次都带一个不一样的 hint，所以有错误码的只认错误码；
 * 没有错误码的（超时、连不上、别的意外）不管原话是什么都算一类。
 * 资料自己的文件有问题不算数：返回 null。
 */
const failureKind = (error: unknown): string | null => {
  if (error instanceof SourceFileError) return null;
  if (error instanceof WedriveError && error.errcode !== null) return `errcode:${error.errcode}`;
  return "no-errcode";
};

const readTripCount = async (env: Env): Promise<number> => {
  const parsed = Number(await getSystemConfig(env, TRIP_KEY));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const saveTripCount = (env: Env, count: number): Promise<void> =>
  setSystemConfig(env, TRIP_KEY, count > 0 ? String(count) : "", SYSTEM_USER);

export const runMirrorDrain = async (env: Env, deps: DrainDeps = {}): Promise<DrainResult> => {
  const now = deps.now ?? (() => new Date());
  const maxDocs = deps.maxDocs ?? DEFAULT_MAX_DOCS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxMs = deps.maxMs ?? DEFAULT_MAX_MS;
  const notify = deps.notify ?? ((reason: string) => notifyMirrorPaused(env, reason));
  /** 现在不该跑的话是哪一种：没初始化或关着、暂停中；能跑返回 null */
  const haltOf = (settings: WedriveSettings): "inactive" | "paused" | null => {
    if (settings.space_id === null || !settings.enabled) return "inactive";
    return settings.paused_reason !== null ? "paused" : null;
  };
  const idle = async (stopped: DrainResult["stopped"]): Promise<DrainResult> => ({
    processed: 0,
    failed: 0,
    remaining: await countPending(env),
    stopped
  });

  const halted = haltOf(await getWedriveSettings(env));
  if (halted !== null) return idle(halted);

  const token = crypto.randomUUID();
  let held = await acquireLock(env, now(), token);
  if (held === null) return idle("locked");

  const client = deps.client ?? createWedriveClient(env, { now });
  const startedAt = now().getTime();
  let processed = 0;
  let failed = 0;
  let bytes = 0;
  let lastFailure: { kind: string; text: string } | null = null;
  let sameFailures = 0;
  let stopped: DrainResult["stopped"] = "done";
  try {
    let trips = await readTripCount(env);
    for (;;) {
      const overBudget =
        processed + failed >= maxDocs || bytes >= maxBytes || now().getTime() - startedAt >= maxMs;
      const doc = await nextPending(env);
      if (!doc) break;
      if (overBudget) {
        stopped = "budget";
        break;
      }
      // 每做一份之前都重新看一眼：有人关了镜像或点了暂停，就不再开始下一份
      const settings = await getWedriveSettings(env);
      const halt = haltOf(settings);
      if (halt !== null) {
        stopped = halt;
        break;
      }
      if (!(await claim(env, doc.id, now()))) continue;
      try {
        await reconcileDoc(env, client, settings, doc.id);
        processed += 1;
        lastFailure = null;
        sameFailures = 0;
        if (trips > 0) {
          trips = 0;
          await saveTripCount(env, 0);
        }
      } catch (error) {
        if (error instanceof WedriveQuotaError) {
          await releaseClaim(env, doc.id);
          await pause(env, quotaReason(error), notify);
          stopped = "paused";
          break;
        }
        await markFailed(env, doc.id, error);
        failed += 1;
        const kind = failureKind(error);
        if (kind !== null) {
          sameFailures = lastFailure?.kind === kind ? sameFailures + 1 : 1;
          lastFailure = { kind, text: errorText(error) };
        }
      }
      // 没有文件 ID 的才会上传；改名、移动、删除不占字节数
      if (!doc.wedrive_fileid) bytes += Number(doc.file_size);
      held = await extendLock(env, now(), token, held);
      if (held === null) {
        // 锁被别人接走了（这一份做得太久）：不再往下做，也不去清别人的锁
        stopped = "locked";
        break;
      }
      if (lastFailure !== null && sameFailures >= SAME_FAILURE_LIMIT) {
        // 微盘那头或网络多半出了问题：这一趟停下。连着几趟都这样就暂停，等人来看。
        if (trips + 1 >= TRIPS_BEFORE_PAUSE) {
          await saveTripCount(env, 0);
          await pause(
            env,
            `连着 ${TRIPS_BEFORE_PAUSE} 趟都因为同一个原因失败：${lastFailure.text}`,
            notify
          );
          stopped = "paused";
        } else {
          await saveTripCount(env, trips + 1);
          stopped = "failing";
        }
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
