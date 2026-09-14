/**
 * 通用系统级键值配置（表 system_config，迁移 0088）。
 * 直连 D1、不做 KV 缓存：现有使用方（AI 关卡兜底审核人）只在 AI 拦截时读一次。
 */
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

export type SystemConfigEntry = {
  value: string;
  updated_by: string | null;
  updated_at: string;
};

/** 读取一项配置；不存在或值为空白时返回 null。 */
export const getSystemConfigEntry = async (
  env: Env,
  key: string
): Promise<SystemConfigEntry | null> => {
  const row = await env.DB.prepare(
    "SELECT config_value, updated_by, updated_at FROM system_config WHERE config_key = ?"
  )
    .bind(key)
    .first<{ config_value: string; updated_by: string | null; updated_at: string }>();
  if (!row) return null;
  const value = String(row.config_value ?? "").trim();
  if (!value) return null;
  return { value, updated_by: row.updated_by ?? null, updated_at: row.updated_at };
};

export const getSystemConfig = async (env: Env, key: string): Promise<string | null> => {
  const entry = await getSystemConfigEntry(env, key);
  return entry ? entry.value : null;
};

/** upsert；value 先 trim，空串也允许写入（表示清除）。 */
export const setSystemConfig = async (
  env: Env,
  key: string,
  value: string,
  updatedBy: string | null
): Promise<void> => {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO system_config (config_key, config_value, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(config_key) DO UPDATE SET
       config_value = excluded.config_value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  )
    .bind(key, value.trim(), updatedBy, now, now)
    .run();
};
