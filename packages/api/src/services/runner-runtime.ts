import type { RunnerRuntimeConfigItem } from "../types/ai";
import type { Env } from "../types/env";

const RUNNER_RUNTIME_KV_KEY = "runner:runtime:config:v1";

type RunnerRuntimeSnapshot = {
  version: number;
  updated_at: string;
  items: RunnerRuntimeConfigItem[];
};

const nowIso = () => new Date().toISOString();

const toInt = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
};

const parseSnapshot = (raw: string | null): RunnerRuntimeSnapshot | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RunnerRuntimeSnapshot>;
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .filter((item): item is RunnerRuntimeConfigItem => {
        return (
          typeof item?.config_key === "string" &&
          typeof item?.config_value === "string" &&
          (item?.is_secret === 0 || item?.is_secret === 1)
        );
      })
      .map((item) => ({
        id: toInt(item.id, 0),
        config_key: item.config_key,
        config_value: item.config_value,
        is_secret: item.is_secret,
        updated_by: typeof item.updated_by === "string" ? item.updated_by : null,
        created_at: typeof item.created_at === "string" ? item.created_at : nowIso(),
        updated_at: typeof item.updated_at === "string" ? item.updated_at : nowIso()
      }))
      .sort((a, b) => a.config_key.localeCompare(b.config_key));

    return {
      version: toInt(parsed.version, 1),
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : nowIso(),
      items
    };
  } catch {
    return null;
  }
};

const rowsFromDb = async (env: Env): Promise<RunnerRuntimeConfigItem[]> => {
  const rows = await env.DB.prepare(
    "SELECT * FROM runner_runtime_config ORDER BY config_key ASC"
  ).all<RunnerRuntimeConfigItem>();
  return rows.results ?? [];
};

const writeSnapshot = async (env: Env, items: RunnerRuntimeConfigItem[]) => {
  const raw = await env.KV.get(RUNNER_RUNTIME_KV_KEY);
  const current = parseSnapshot(raw);
  const next: RunnerRuntimeSnapshot = {
    version: (current?.version ?? 0) + 1,
    updated_at: nowIso(),
    items: items
      .map((item, index) => ({
        ...item,
        id: item.id > 0 ? item.id : index + 1
      }))
      .sort((a, b) => a.config_key.localeCompare(b.config_key))
  };
  await env.KV.put(RUNNER_RUNTIME_KV_KEY, JSON.stringify(next));
};

export const listRunnerRuntimeConfig = async (env: Env): Promise<RunnerRuntimeConfigItem[]> => {
  const snapshot = parseSnapshot(await env.KV.get(RUNNER_RUNTIME_KV_KEY));
  if (snapshot && snapshot.items.length > 0) {
    return snapshot.items;
  }

  const dbRows = await rowsFromDb(env);
  if (dbRows.length > 0) {
    await writeSnapshot(env, dbRows);
  }
  return dbRows;
};

export const loadRunnerRuntimeMap = async (env: Env): Promise<Record<string, string>> => {
  const rows = await listRunnerRuntimeConfig(env);
  const output: Record<string, string> = {};
  for (const row of rows) {
    output[row.config_key] = row.config_value;
  }
  return output;
};

export const upsertRunnerRuntimeConfig = async (
  env: Env,
  items: Array<{ config_key: string; config_value: string; is_secret: 0 | 1 }>,
  updatedBy: string
): Promise<RunnerRuntimeConfigItem[]> => {
  const now = nowIso();

  for (const item of items) {
    await env.DB.prepare(
      `INSERT INTO runner_runtime_config
        (config_key, config_value, is_secret, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(config_key) DO UPDATE SET
         config_value = excluded.config_value,
         is_secret = excluded.is_secret,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    )
      .bind(item.config_key, item.config_value, item.is_secret, updatedBy, now, now)
      .run();
  }

  const rows = await rowsFromDb(env);
  await writeSnapshot(env, rows);
  return rows;
};

export const refreshRunnerRuntimeKvFromDb = async (
  env: Env
): Promise<RunnerRuntimeConfigItem[]> => {
  const rows = await rowsFromDb(env);
  await writeSnapshot(env, rows);
  return rows;
};
