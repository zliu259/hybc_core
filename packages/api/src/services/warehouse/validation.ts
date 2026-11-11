/**
 * 库房接口在路由边界的输入校验。不合规一律 throw 400 的 WarehouseError，文案是中文。
 */
import { badRequest } from "./errors";

const MAX_QUANTITY = 1_000_000;

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const hasAtMostThreeDecimals = (value: number): boolean => {
  const scaled = value * 1000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

export const requireText = (value: unknown, label: string, maxLength: number): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw badRequest(`${label}不能为空`);
  if (text.length > maxLength) throw badRequest(`${label}不能超过${maxLength}个字`);
  return text;
};

export const optionalText = (value: unknown, label: string, maxLength: number): string | null => {
  if (isBlank(value)) return null;
  if (typeof value !== "string") throw badRequest(`${label}格式不对`);
  const text = value.trim();
  if (text.length > maxLength) throw badRequest(`${label}不能超过${maxLength}个字`);
  return text;
};

export const requireId = (value: unknown, label: string): number => {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`请选择${label}`);
  }
  return parsed;
};

export const optionalId = (value: unknown, label: string): number | null =>
  isBlank(value) ? null : requireId(value, label);

export const requireQuantity = (value: unknown, label: string): number => {
  const parsed = typeof value === "boolean" ? null : toNumber(value);
  if (parsed === null || parsed <= 0 || parsed > MAX_QUANTITY || !hasAtMostThreeDecimals(parsed)) {
    throw badRequest(`${label}必须是大于 0 的数字，最多 3 位小数`);
  }
  return parsed;
};

/** 计划数这类可以为 0 的数量：空返回 null；否则 0 到 1000000，最多 3 位小数，integer 时必须是整数。 */
export const optionalQuantity = (
  value: unknown,
  label: string,
  options: { integer?: boolean } = {}
): number | null => {
  if (isBlank(value)) return null;
  const parsed = typeof value === "boolean" ? null : toNumber(value);
  if (parsed === null || parsed < 0 || parsed > MAX_QUANTITY || !hasAtMostThreeDecimals(parsed)) {
    throw badRequest(`${label}必须是不小于 0 的数字，最多 3 位小数`);
  }
  if (options.integer && !Number.isInteger(parsed)) throw badRequest(`${label}必须是整数`);
  return parsed;
};

export const optionalNumber = (
  value: unknown,
  label: string,
  range: { min: number; max: number; integer?: boolean }
): number | null => {
  if (isBlank(value)) return null;
  const parsed = typeof value === "boolean" ? null : toNumber(value);
  const kind = range.integer ? "整数" : "数字";
  if (
    parsed === null ||
    parsed < range.min ||
    parsed > range.max ||
    (range.integer && !Number.isInteger(parsed))
  ) {
    throw badRequest(`${label}必须是 ${range.min} 到 ${range.max} 之间的${kind}`);
  }
  return parsed;
};

export const requireEnum = <T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[]
): T => {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw badRequest(`${label}不对`);
};

export const optionalDate = (value: unknown, label: string): string | null => {
  if (isBlank(value)) return null;
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text) return text;
  }
  throw badRequest(`${label}格式应为 YYYY-MM-DD`);
};
