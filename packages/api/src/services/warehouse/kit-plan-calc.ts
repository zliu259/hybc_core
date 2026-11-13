/**
 * 按项目参数生成配套清单：参数校验、单行数量和算式。
 * 纯函数，不碰数据库。数量由模板行上的规则算，不由 AI 算。
 */
import type { KitQtyBasis } from "../../types/wh";
import { badRequest } from "./errors";
import type { KitLineRule } from "./kit-lines";
import { optionalText } from "./validation";

export const CLIENT_SUPPLIES = ["power", "lodging"] as const;
export type ClientSupply = (typeof CLIENT_SUPPLIES)[number];

/** 生成清单用的项目参数。除了套数，都可以空着。 */
export interface PlanParams {
  machine_type: string | null;
  pipe_diameter_mm: number | null;
  total_length_m: number | null;
  /** 最长的一段。排泥管、电缆这类沿一段铺、下一段接着用的东西按它算 */
  longest_drive_m: number | null;
  section_count: number | null;
  set_count: number;
  soil: string | null;
  /** 甲方提供的项：发电、住宿 */
  client_supplies: ClientSupply[];
}

export type MissingInput = "total_length" | "longest_drive" | "section_count" | "factor";

export interface LineQty {
  qty: number;
  /** 数量是怎么算出来的；固定而且没乘套数的行是空的 */
  calc_text: string | null;
  /** 缺了什么才退回默认数量；正常算出来的是空的 */
  missing: MissingInput | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const optionalInteger = (
  value: unknown,
  min: number,
  max: number,
  message: string
): number | null => {
  if (isBlank(value)) return null;
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest(message);
  }
  return parsed;
};

const MAX_LENGTH_M = 20000;

const optionalLength = (value: unknown, label: string): number | null => {
  if (isBlank(value)) return null;
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0 || parsed > MAX_LENGTH_M) {
    throw badRequest(`${label}必须大于 0，不超过 ${MAX_LENGTH_M}`);
  }
  return parsed;
};

const parseClientSupplies = (value: unknown): ClientSupply[] => {
  if (isBlank(value)) return [];
  const message = "甲方提供只能是发电、住宿";
  if (!Array.isArray(value)) throw badRequest(message);
  const allowed: readonly string[] = CLIENT_SUPPLIES;
  if (value.some((item) => typeof item !== "string" || !allowed.includes(item))) {
    throw badRequest(message);
  }
  return CLIENT_SUPPLIES.filter((item) => value.includes(item));
};

export const parsePlanParams = (input: unknown): PlanParams => {
  const raw = asRecord(input);
  const total = optionalLength(raw.total_length_m, "总长度");
  const longest = optionalLength(raw.longest_drive_m, "最长一段");
  if (total !== null && longest !== null && longest > total) {
    throw badRequest("最长一段不能超过总长度");
  }
  return {
    machine_type: optionalText(raw.machine_type, "机型", 20),
    pipe_diameter_mm: optionalInteger(
      raw.pipe_diameter_mm,
      300,
      5000,
      "管径必须是 300 到 5000 之间的整数"
    ),
    total_length_m: total,
    longest_drive_m: longest,
    section_count: optionalInteger(raw.section_count, 1, 200, "段数必须是 1 到 200 的整数"),
    set_count: optionalInteger(raw.set_count, 1, 200, "套数必须是 1 到 200 的整数") ?? 1,
    soil: optionalText(raw.soil, "土质", 100),
    client_supplies: parseClientSupplies(raw.client_supplies)
  };
};

type CalculatedBasis = Exclude<KitQtyBasis, "fixed">;

const BASIS_INPUT: Record<
  CalculatedBasis,
  {
    label: string;
    paramLabel: string;
    missing: MissingInput;
    read: (p: PlanParams) => number | null;
  }
> = {
  per_total_metre: {
    label: "按总长",
    paramLabel: "总长度",
    missing: "total_length",
    read: (p) => p.total_length_m
  },
  per_longest_metre: {
    label: "按最长一段",
    paramLabel: "最长一段",
    missing: "longest_drive",
    read: (p) => p.longest_drive_m
  },
  per_section: {
    label: "按段",
    paramLabel: "段数",
    missing: "section_count",
    read: (p) => p.section_count
  }
};

/** 浮点误差：0.1 × 30 不能变成 3.0000000000000004 再被取整成 4。 */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** 整数不带小数点；小数最多 3 位，去掉末尾的 0。 */
const show = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));

interface Base {
  qty: number;
  text: string | null;
  missing: MissingInput | null;
}

const baseOf = (rule: KitLineRule, defaultQty: number | null, params: PlanParams): Base => {
  const fallback = defaultQty ?? 0;
  if (rule.qty_basis === "fixed") return { qty: fallback, text: null, missing: null };
  const input = BASIS_INPUT[rule.qty_basis];
  if (rule.qty_factor === null) {
    return { qty: fallback, text: "没填系数，用模板默认数量", missing: "factor" };
  }
  const value = input.read(params);
  if (value === null) {
    return {
      qty: fallback,
      text: `缺${input.paramLabel}，用模板默认数量`,
      missing: input.missing
    };
  }
  const product = round6(rule.qty_factor * value);
  const whole = Math.ceil(product);
  const extra = rule.qty_extra ?? 0;
  const qty = round6(whole + extra);
  const head = `${input.label}：${show(rule.qty_factor)} × ${show(value)}`;
  if (whole === product) {
    const text = extra > 0 ? `${head} + ${show(extra)} = ${show(qty)}` : `${head} = ${show(qty)}`;
    return { qty, text, missing: null };
  }
  const rounded = `${head} = ${show(product)}，取整 ${show(whole)}`;
  return {
    qty,
    text: extra > 0 ? `${rounded}，另加 ${show(extra)}，共 ${show(qty)}` : rounded,
    missing: null
  };
};

/**
 * 一行的数量：先按计算方式算基数（缺参数或没填系数时退回模板默认数量），
 * 勾了「每套一份」再乘套数。
 */
export const calcLineQty = (
  rule: KitLineRule,
  defaultQty: number | null,
  params: PlanParams
): LineQty => {
  const base = baseOf(rule, defaultQty, params);
  const sets = rule.qty_per_set ? params.set_count : 1;
  if (sets === 1) return { qty: base.qty, calc_text: base.text, missing: base.missing };
  const qty = round6(base.qty * sets);
  const calcText = base.text
    ? `${base.text}；每套一份 × ${sets} = ${show(qty)}`
    : `每套一份：${show(base.qty)} × ${sets} = ${show(qty)}`;
  return { qty, calc_text: calcText, missing: base.missing };
};

/** 模板有没有配过计算规则：有一行不是固定，或者勾了每套一份。 */
export const hasAnyRule = (rules: readonly KitLineRule[]): boolean =>
  rules.some((rule) => rule.qty_basis !== "fixed" || rule.qty_per_set);
