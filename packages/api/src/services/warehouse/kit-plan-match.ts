/**
 * 按项目参数生成的清单存下来的那份记录（参数、来源、模板、生成时的原样），
 * 以及读清单时怎么把生成时的数量和算式配回现在的行。
 *
 * 清单行保存时整份替换，行号每次都变，小程序保存时也不带额外的字段，
 * 所以算式不存在行上，而是按「分节、类型、品名」配回去：同一组里先认规格相同的，剩下的按先后。
 */
import type { KitLineKind } from "../../types/wh";
import { badRequest } from "./errors";
import type { PlannedLine, PlanResult } from "./kit-plan-build";
import type { PlanParams } from "./kit-plan-calc";
import { optionalText } from "./validation";

export interface PlanSnapshotLine {
  section: string;
  line_kind: KitLineKind;
  name_text: string;
  spec_text: string | null;
  qty: number;
  calc_text: string | null;
}

const SOURCE_FROM = ["section", "project", "ai", "manual"] as const;
export type PlanSourceFrom = (typeof SOURCE_FROM)[number];
export type PlanSources = Partial<
  Record<keyof PlanParams, { from: PlanSourceFrom; quote?: string }>
>;

export interface KitPlanRecord {
  v: 1;
  params: PlanParams;
  sources: PlanSources;
  template: PlanResult["template"];
  generated: PlanSnapshotLine[];
}

/** 详情接口带出去的部分：不含生成时的原样。 */
export type KitPlanView = Omit<KitPlanRecord, "generated">;

const PARAM_KEYS: readonly (keyof PlanParams)[] = [
  "machine_type",
  "pipe_diameter_mm",
  "total_length_m",
  "longest_drive_m",
  "section_count",
  "set_count",
  "soil",
  "client_supplies"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 每个参数是从哪来的（工作段、项目档案、AI、手填）。只是说明，不参与计算。 */
export const parsePlanSources = (raw: unknown): PlanSources => {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) throw badRequest("参数来源不对");
  const allowedKeys: readonly string[] = PARAM_KEYS;
  const allowedFrom: readonly string[] = SOURCE_FROM;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      if (!allowedKeys.includes(key) || !isRecord(value)) throw badRequest("参数来源不对");
      if (typeof value.from !== "string" || !allowedFrom.includes(value.from)) {
        throw badRequest("参数来源不对");
      }
      const quote = optionalText(value.quote, "原文片段", 100);
      return [key, quote === null ? { from: value.from } : { from: value.from, quote }];
    })
  );
};

const snapshotOf = (line: PlannedLine): PlanSnapshotLine => ({
  section: line.section,
  line_kind: line.line_kind,
  name_text: line.name_text,
  spec_text: line.spec_text,
  qty: line.qty,
  calc_text: line.calc_text
});

export const buildPlanRecord = (
  params: PlanParams,
  sources: PlanSources,
  result: PlanResult
): KitPlanRecord => ({
  v: 1,
  params,
  sources,
  template: result.template,
  generated: result.lines.map(snapshotOf)
});

/** 库里的 plan_json 读成记录；坏了或者不认识的版本当作没有。 */
export const readPlanRecord = (json: string | null): KitPlanRecord | null => {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || parsed.v !== 1) return null;
    if (!isRecord(parsed.params) || !isRecord(parsed.template)) return null;
    if (!Array.isArray(parsed.generated)) return null;
    return parsed as unknown as KitPlanRecord;
  } catch {
    return null;
  }
};

interface Matchable {
  section: string;
  line_kind: KitLineKind;
  name_text: string;
  spec_text?: string | null;
}

const groupKey = (line: Matchable): string =>
  `${line.section}\u0000${line.line_kind}\u0000${line.name_text}`;

const specOf = (line: Matchable): string => (line.spec_text ?? "").trim();

interface Assignment {
  /** 第 i 行配到了生成时的第几行；没配上是 null */
  picks: readonly (number | null)[];
  taken: ReadonlySet<number>;
}

const assign = <T extends Matchable>(
  lines: readonly T[],
  generated: readonly PlanSnapshotLine[],
  start: Assignment,
  fits: (line: T, candidate: PlanSnapshotLine) => boolean
): Assignment =>
  lines.reduce<Assignment>((state, line, index) => {
    if (state.picks[index] !== null) return state;
    const found = generated.findIndex(
      (candidate, at) =>
        !state.taken.has(at) && groupKey(candidate) === groupKey(line) && fits(line, candidate)
    );
    if (found < 0) return state;
    return {
      picks: state.picks.map((pick, at) => (at === index ? found : pick)),
      taken: new Set([...state.taken, found])
    };
  }, start);

/**
 * 把生成时的数量和算式配回现在的行。配不上的（库管新加的、改了品名的）两项都是空的。
 */
export const matchGenerated = <T extends Matchable>(
  lines: readonly T[],
  generated: readonly PlanSnapshotLine[]
): (T & { calc_text: string | null; generated_qty: number | null })[] => {
  const empty: Assignment = { picks: lines.map(() => null), taken: new Set() };
  // 先认规格相同的（同品名的两行换了顺序也认得回来），剩下的按先后
  const bySpec = assign(
    lines,
    generated,
    empty,
    (line, candidate) => specOf(line) === specOf(candidate)
  );
  const { picks } = assign(lines, generated, bySpec, () => true);
  return lines.map((line, index) => {
    const pick = picks[index];
    const source = pick === null ? null : generated[pick];
    return {
      ...line,
      calc_text: source ? (source.calc_text ?? null) : null,
      generated_qty: source ? Number(source.qty) : null
    };
  });
};
