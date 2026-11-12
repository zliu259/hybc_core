/**
 * 微盘镜像的设置和每月调用次数。
 * 设置存在 system_config（键都以 warehouse.wedrive_ 开头）；调用次数存在 KV，按北京时间的月份分开记。
 * 非专业版企业每月只有 1000 次微盘调用，所以每一次调用都要过 addCall。
 */
import type { Env } from "../../types/env";
import { getSystemConfig, setSystemConfig } from "../system-config";

export interface WedriveSettings {
  space_id: string | null;
  enabled: boolean;
  /** 空间已经对全公司开放（开放后不再用直传） */
  space_open: boolean;
  /** 不为空就是暂停中，值是原因 */
  paused_reason: string | null;
  mirror_max_bytes: number;
  monthly_budget: number;
}

const KEY = {
  space_id: "warehouse.wedrive_space_id",
  enabled: "warehouse.wedrive_enabled",
  space_open: "warehouse.wedrive_space_open",
  paused_reason: "warehouse.wedrive_paused_reason",
  mirror_max_mb: "warehouse.wedrive_mirror_max_mb",
  monthly_budget: "warehouse.wedrive_monthly_budget"
} as const;

const MB = 1024 * 1024;
/** 实测：SHA1 约 95 MiB/s、base64 约 60 MiB/s（开发机）；Worker 一次调用默认 30 秒 CPU，留足余量 */
const DEFAULT_MIRROR_MAX_MB = 100;
const MAX_MIRROR_MAX_MB = 1000;
const DEFAULT_MONTHLY_BUDGET = 900;
/** 企业每月的上限；预算不能比它高 */
const ENTERPRISE_MONTHLY_LIMIT = 1000;
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
/** 次数的 KV 键留 70 天：够看上个月，之后自己过期 */
const CALL_COUNT_TTL_SECONDS = 70 * 86400;
const MAX_REASON_LENGTH = 200;

const intInRange = (raw: string | null, min: number, max: number, fallback: number): number => {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export const getWedriveSettings = async (env: Env): Promise<WedriveSettings> => {
  const [spaceId, enabled, spaceOpen, paused, maxMb, budget] = await Promise.all([
    getSystemConfig(env, KEY.space_id),
    getSystemConfig(env, KEY.enabled),
    getSystemConfig(env, KEY.space_open),
    getSystemConfig(env, KEY.paused_reason),
    getSystemConfig(env, KEY.mirror_max_mb),
    getSystemConfig(env, KEY.monthly_budget)
  ]);
  return {
    space_id: spaceId,
    enabled: enabled === "1",
    space_open: spaceOpen === "1",
    paused_reason: paused,
    mirror_max_bytes: intInRange(maxMb, 1, MAX_MIRROR_MAX_MB, DEFAULT_MIRROR_MAX_MB) * MB,
    monthly_budget: intInRange(budget, 1, ENTERPRISE_MONTHLY_LIMIT, DEFAULT_MONTHLY_BUDGET)
  };
};

export const saveWedriveSetting = async (
  env: Env,
  patch: Partial<Pick<WedriveSettings, "space_id" | "enabled" | "space_open" | "paused_reason">>,
  userid: string
): Promise<WedriveSettings> => {
  if (patch.space_id !== undefined) {
    await setSystemConfig(env, KEY.space_id, patch.space_id ?? "", userid);
  }
  if (patch.enabled !== undefined) {
    await setSystemConfig(env, KEY.enabled, patch.enabled ? "1" : "0", userid);
  }
  if (patch.space_open !== undefined) {
    await setSystemConfig(env, KEY.space_open, patch.space_open ? "1" : "0", userid);
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

const callCountKey = (now: Date): string => `wedrive:calls:${callMonth(now)}`;

export const getCallCount = async (env: Env, now: Date): Promise<number> => {
  const parsed = Number(await env.KV.get(callCountKey(now)));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

/** 把本月已用次数写成 count。客户端在内存里累加后用它落盘。 */
export const saveCallCount = async (env: Env, now: Date, count: number): Promise<void> => {
  await env.KV.put(callCountKey(now), String(count), { expirationTtl: CALL_COUNT_TTL_SECONDS });
};

/**
 * 记一次微盘调用，返回加完之后的数。
 * 先读后写，不是原子的：镜像同一时间只有一个在跑（见 mirror-run.ts 的锁），够用了。
 */
export const addCall = async (env: Env, now: Date): Promise<number> => {
  const next = (await getCallCount(env, now)) + 1;
  await saveCallCount(env, now, next);
  return next;
};
