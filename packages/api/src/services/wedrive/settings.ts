/**
 * 微盘镜像的设置和每月调用次数，都存在 system_config（键以 warehouse.wedrive_ 开头）。
 * 非专业版企业每月只有 1000 次微盘调用，所以每一次调用都要先过 countCall。
 * 次数不放 KV：KV 同一个键一秒只能写一次，连着两次微盘调用（建目录接着上传）就会被拒。
 */
import type { Env } from "../../types/env";
import { getSystemConfig, setSystemConfig } from "../system-config";

export interface WedriveSettings {
  space_id: string | null;
  enabled: boolean;
  /** 按「空间已经对全公司开放」来处理（开放后不再用直传）。问过企微但没收到答复时也是 true */
  space_open: boolean;
  /** 企微确实答复了「加上了」 */
  space_open_confirmed: boolean;
  /** 不为空就是暂停中，值是原因 */
  paused_reason: string | null;
  mirror_max_bytes: number;
  monthly_budget: number;
}

export type WedriveSettingsPatch = Partial<
  Pick<WedriveSettings, "space_id" | "enabled" | "paused_reason">
> & {
  /** "asked"：已经向企微发了开放的请求、还不知道结果，先按已开放处理 */
  space_open?: boolean | "asked";
};

const KEY = {
  space_id: "warehouse.wedrive_space_id",
  enabled: "warehouse.wedrive_enabled",
  space_open: "warehouse.wedrive_space_open",
  paused_reason: "warehouse.wedrive_paused_reason",
  mirror_max_mb: "warehouse.wedrive_mirror_max_mb",
  monthly_budget: "warehouse.wedrive_monthly_budget"
} as const;

/** space_open 存的值 */
const OPEN = { no: "0", yes: "1", asked: "2" } as const;

const MB = 1024 * 1024;
/** 实测：SHA1 约 95 MiB/s、base64 约 60 MiB/s（开发机）；Worker 一次调用默认 30 秒 CPU，留足余量 */
const DEFAULT_MIRROR_MAX_MB = 100;
const MAX_MIRROR_MAX_MB = 1000;
const DEFAULT_MONTHLY_BUDGET = 900;
/** 企业每月的上限；预算不能比它高 */
const ENTERPRISE_MONTHLY_LIMIT = 1000;
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const MAX_REASON_LENGTH = 200;
const SYSTEM_USER = "system";

const intInRange = (raw: string | null, min: number, max: number, fallback: number): number => {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

/** 一条语句把六项设置都读出来：排空里每做一份之前都要读一次。 */
export const getWedriveSettings = async (env: Env): Promise<WedriveSettings> => {
  const keys = Object.values(KEY);
  const rows = await env.DB.prepare(
    `SELECT config_key, config_value FROM system_config
      WHERE config_key IN (${keys.map(() => "?").join(", ")})`
  )
    .bind(...keys)
    .all<{ config_key: string; config_value: string | null }>();
  const stored = new Map(
    (rows.results ?? []).map((row) => [row.config_key, String(row.config_value ?? "").trim()])
  );
  /** 空白当没配 */
  const value = (key: string): string | null => stored.get(key) || null;
  const open = value(KEY.space_open);
  return {
    space_id: value(KEY.space_id),
    enabled: value(KEY.enabled) === "1",
    space_open: open === OPEN.yes || open === OPEN.asked,
    space_open_confirmed: open === OPEN.yes,
    paused_reason: value(KEY.paused_reason),
    mirror_max_bytes:
      intInRange(value(KEY.mirror_max_mb), 1, MAX_MIRROR_MAX_MB, DEFAULT_MIRROR_MAX_MB) * MB,
    monthly_budget: intInRange(
      value(KEY.monthly_budget),
      1,
      ENTERPRISE_MONTHLY_LIMIT,
      DEFAULT_MONTHLY_BUDGET
    )
  };
};

const openValue = (state: boolean | "asked"): string => {
  if (state === "asked") return OPEN.asked;
  return state ? OPEN.yes : OPEN.no;
};

export const saveWedriveSetting = async (
  env: Env,
  patch: WedriveSettingsPatch,
  userid: string
): Promise<WedriveSettings> => {
  if (patch.space_id !== undefined) {
    await setSystemConfig(env, KEY.space_id, patch.space_id ?? "", userid);
  }
  if (patch.enabled !== undefined) {
    await setSystemConfig(env, KEY.enabled, patch.enabled ? "1" : "0", userid);
  }
  if (patch.space_open !== undefined) {
    await setSystemConfig(env, KEY.space_open, openValue(patch.space_open), userid);
  }
  if (patch.paused_reason !== undefined) {
    const reason = (patch.paused_reason ?? "").trim().slice(0, MAX_REASON_LENGTH);
    await setSystemConfig(env, KEY.paused_reason, reason, userid);
  }
  return getWedriveSettings(env);
};

/** 现在能不能发微盘请求：已初始化、开着、没暂停。 */
export const mirrorActive = (settings: WedriveSettings): boolean =>
  settings.space_id !== null && settings.enabled && settings.paused_reason === null;

/** 北京时间的年月，如 "2026-11"。 */
export const callMonth = (now: Date): string =>
  new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 7);

const callCountKey = (now: Date): string => `warehouse.wedrive_calls.${callMonth(now)}`;

const asCount = (raw: string | null | undefined): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

/** 这个月（按北京时间）已经记了多少次微盘调用。 */
export const getCallCount = async (env: Env, now: Date): Promise<number> =>
  asCount(await getSystemConfig(env, callCountKey(now)));

/**
 * 记一次微盘调用：这个月的次数还没到预算才加一，返回加完之后的数；已经到预算就不加，返回 null。
 * 一条语句完成（不是先读后写），月份每次现算：一趟排空跨过月底时，新的一个月从 1 开始数。
 */
export const countCall = async (env: Env, now: Date, budget: number): Promise<number | null> => {
  const stamp = now.toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO system_config (config_key, config_value, updated_by, created_at, updated_at)
     VALUES (?, '1', ?, ?, ?)
     ON CONFLICT(config_key) DO UPDATE SET
       config_value = CAST(CAST(system_config.config_value AS INTEGER) + 1 AS TEXT),
       updated_at = excluded.updated_at
     WHERE CAST(system_config.config_value AS INTEGER) < ?
     RETURNING config_value`
  )
    .bind(callCountKey(now), SYSTEM_USER, stamp, stamp, budget)
    .first<{ config_value: string }>();
  return row ? asCount(row.config_value) : null;
};
