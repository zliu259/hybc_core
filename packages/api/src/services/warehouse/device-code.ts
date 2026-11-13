/**
 * 设备编号的自动生成：「开头-流水号」。
 * 类别设了编号开头（device_category.code_prefix）的用它，各排各的流水；没设的用 SB。
 * 流水号接着这个开头现有的最大号往下排，位数跟着现有的走（DG-033 之后是 DG-034，DT-36 之后是 DT-37）。
 */
import type { Env } from "../../types/env";
import { badRequest } from "./errors";

export const DEFAULT_CODE_PREFIX = "SB";
const PREFIX_PATTERN = /^[A-Z]{1,4}$/;

/** 一个开头现在排到哪了：最大号，和数字部分最长有几位。 */
export interface CodeSequence {
  max: number;
  width: number;
}

/** 新开头从几位数字排起：SB 一直是四位，别的两位起（顶铁 DT-01）。 */
const minWidthOf = (prefix: string): number => (prefix === DEFAULT_CODE_PREFIX ? 4 : 2);

/** "DG-034" 在开头 DG 下是第 34 号、三位；不是「开头-纯数字」的返回 null。 */
export const parseCodeNumber = (
  prefix: string,
  code: string
): { number: number; width: number } | null => {
  const head = `${prefix}-`;
  if (!code.toUpperCase().startsWith(head)) return null;
  const digits = code.slice(head.length);
  return /^\d+$/.test(digits) ? { number: Number(digits), width: digits.length } : null;
};

/** 把一批编号并进一个开头的进度里。 */
export const withCodes = (
  prefix: string,
  sequence: CodeSequence,
  codes: readonly string[]
): CodeSequence =>
  codes.reduce((current, code) => {
    const parsed = parseCodeNumber(prefix, code);
    return parsed
      ? { max: Math.max(current.max, parsed.number), width: Math.max(current.width, parsed.width) }
      : current;
  }, sequence);

/** 库里这个开头现在排到哪了。 */
export const loadCodeSequence = async (env: Env, prefix: string): Promise<CodeSequence> => {
  const rows = await env.DB.prepare("SELECT device_code FROM device WHERE device_code GLOB ?")
    .bind(`${prefix}-[0-9]*`)
    .all<{ device_code: string }>();
  return withCodes(
    prefix,
    { max: 0, width: minWidthOf(prefix) },
    (rows.results ?? []).map((row) => row.device_code)
  );
};

/** 这个开头的第 number 号怎么写。 */
export const formatDeviceCode = (prefix: string, number: number, width: number): string =>
  `${prefix}-${String(number).padStart(width, "0")}`;

/** 这个类别的设备用哪个开头。 */
export const codePrefixOfCategory = async (env: Env, categoryId: number): Promise<string> => {
  const row = await env.DB.prepare("SELECT code_prefix FROM device_category WHERE id = ?")
    .bind(categoryId)
    .first<{ code_prefix: string | null }>();
  return row?.code_prefix || DEFAULT_CODE_PREFIX;
};

export const nextDeviceCode = async (env: Env, categoryId: number): Promise<string> => {
  const prefix = await codePrefixOfCategory(env, categoryId);
  const sequence = await loadCodeSequence(env, prefix);
  return formatDeviceCode(prefix, sequence.max + 1, sequence.width);
};

/**
 * 批量导入用：先把用得到的每个开头排到哪读出来（让开这批里自带的编号 ownCodes），
 * 之后每调一次给出这个开头的下一个编号。
 */
export const createCodeAllocator = async (
  env: Env,
  prefixes: readonly string[],
  ownCodes: readonly string[]
): Promise<(prefix: string) => string> => {
  const sequences = new Map<string, CodeSequence>();
  for (const prefix of new Set(prefixes)) {
    sequences.set(prefix, withCodes(prefix, await loadCodeSequence(env, prefix), ownCodes));
  }
  return (prefix) => {
    const current = sequences.get(prefix) ?? { max: 0, width: minWidthOf(prefix) };
    const next = { ...current, max: current.max + 1 };
    sequences.set(prefix, next);
    return formatDeviceCode(prefix, next.max, next.width);
  };
};

/**
 * 类别设置里填的编号开头：空的是「不设」（返回 null），否则去掉空白转成大写，只认 1 到 4 个英文字母。
 */
export const parseCodePrefix = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw badRequest("编号开头只能是 1 到 4 个英文字母");
  const text = value.trim().toUpperCase();
  if (!text) return null;
  if (!PREFIX_PATTERN.test(text)) throw badRequest("编号开头只能是 1 到 4 个英文字母");
  return text;
};
