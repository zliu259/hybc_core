/**
 * 排空用的锁：同一时间只让一个排空在跑，免得两个同时建同一个目录、各记各的调用次数。
 * 存在 system_config 里，值是「到期时间 + 空格 + 这次排空的记号」。到期时间在前，所以直接按字符串比就能判断过没过期。
 */
import type { Env } from "../../types/env";

const LOCK_KEY = "warehouse.wedrive_lock_until";
const SYSTEM_USER = "system";
/**
 * 锁的有效期。队列消费者一次最多跑 15 分钟，所以 16 分钟之后还没续上的锁，持有它的那次调用一定已经没了；
 * 比这短的话，一份大文件传得慢时锁会在它还活着的时候被别人抢走。
 */
const LOCK_MS = 16 * 60 * 1000;

const changesOf = (result: D1Result): number => Number(result.meta?.changes ?? 0);

const lockValue = (now: Date, token: string): string =>
  `${new Date(now.getTime() + LOCK_MS).toISOString()} ${token}`;

/** 原来没人持锁、或者锁已经过期，才写成自己的。看影响行数知道抢没抢到。 */
export const acquireLock = async (env: Env, now: Date, token: string): Promise<string | null> => {
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
export const extendLock = async (
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
export const releaseLock = async (env: Env, held: string): Promise<void> => {
  await env.DB.prepare(
    "UPDATE system_config SET config_value = '' WHERE config_key = ? AND config_value = ?"
  )
    .bind(LOCK_KEY, held)
    .run();
};
