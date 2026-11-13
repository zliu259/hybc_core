/**
 * 按项目参数生成的清单存下来的那份记录（参数、来源、模板、生成时的原样），
 * 以及读清单时怎么把生成时的数量和算式配回现在的行。
 *
 * 清单行保存时整份替换，行号每次都变，小程序保存时也不带额外的字段，
 * 所以算式不存在行上，而是按「分节、类型、品名」配回去：同一组里看规格、备注、位置、数量哪条最像。
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
  /** 生成时的备注（规格被清空的行靠它里面的「模板规格」认回去）；早先存的记录没有 */
  note?: string | null;
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
  calc_text: line.calc_text,
  note: line.note
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
  note?: string | null;
  planned_qty?: number | null;
}

const groupKey = (line: { section: string; line_kind: KitLineKind; name_text: string }): string =>
  `${line.section}\u0000${line.line_kind}\u0000${line.name_text}`;

const textOf = (value: string | null | undefined): string => (value ?? "").trim();

/** 每一行在自己那一组（同分节、类型、品名）里是第几个，以及这一组一共几行。 */
const positions = (
  lines: readonly { section: string; line_kind: KitLineKind; name_text: string }[]
): { index: number; size: number }[] => {
  const sizes = lines.reduce<Map<string, number>>(
    (map, line) => new Map(map).set(groupKey(line), (map.get(groupKey(line)) ?? 0) + 1),
    new Map()
  );
  return lines.map((line, at) => ({
    index: lines.slice(0, at).filter((other) => groupKey(other) === groupKey(line)).length,
    size: sizes.get(groupKey(line)) ?? 0
  }));
};

// 越像分越高：规格相同 > 备注相同 > 位置相同 > 数量相同
const SPEC = 8;
const NOTE = 4;
const POSITION = 2;
const QTY = 1;
const SCORES = Array.from({ length: SPEC + NOTE + POSITION + QTY + 1 }, (_, i) => i).reverse();

interface Assignment {
  /** 第 i 行配到了生成时的第几行；没配上是 null */
  picks: readonly (number | null)[];
  taken: ReadonlySet<number>;
}

/**
 * 把生成时的数量和算式配回现在的行。配不上的（库管新加的、改了品名的）两项都是空的。
 *
 * 同一组里按像的程度从高到低配：规格相同最要紧（同品名的两行换了顺序也认得回来）；
 * 规格被清空或后来才选的行看备注；这一组没增没减时看位置；最后看数量。
 * 两边都写了规格而且不一样的，不算同一行。
 */
export const matchGenerated = <T extends Matchable>(
  lines: readonly T[],
  generated: readonly PlanSnapshotLine[]
): (T & { calc_text: string | null; generated_qty: number | null })[] => {
  const linePositions = positions(lines);
  const generatedPositions = positions(generated);
  const lineKeys = lines.map(groupKey);
  const generatedKeys = generated.map(groupKey);

  const likeness = (lineAt: number, candidateAt: number): number | null => {
    const line = lines[lineAt];
    const candidate = generated[candidateAt];
    if (lineKeys[lineAt] !== generatedKeys[candidateAt]) return null;
    const lineSpec = textOf(line.spec_text);
    const candidateSpec = textOf(candidate.spec_text);
    const sameSpec = lineSpec === candidateSpec;
    if (!sameSpec && lineSpec !== "" && candidateSpec !== "") return null;
    const note = textOf(candidate.note);
    const sameNote = note !== "" && textOf(line.note) === note;
    // 这一组行数没变，才能信位置；删过或加过行以后位置就不准了
    const samePosition =
      linePositions[lineAt].size === generatedPositions[candidateAt].size &&
      linePositions[lineAt].index === generatedPositions[candidateAt].index;
    const sameQty =
      line.planned_qty !== undefined &&
      line.planned_qty !== null &&
      Number(line.planned_qty) === Number(candidate.qty);
    return (
      (sameSpec ? SPEC : 0) +
      (sameNote ? NOTE : 0) +
      (samePosition ? POSITION : 0) +
      (sameQty ? QTY : 0)
    );
  };

  const empty: Assignment = { picks: lines.map(() => null), taken: new Set() };
  const { picks } = SCORES.reduce<Assignment>(
    (state, wanted) =>
      lines.reduce<Assignment>((inner, _line, lineAt) => {
        if (inner.picks[lineAt] !== null) return inner;
        const found = generated.findIndex(
          (_candidate, at) => !inner.taken.has(at) && likeness(lineAt, at) === wanted
        );
        if (found < 0) return inner;
        return {
          picks: inner.picks.map((pick, at) => (at === lineAt ? found : pick)),
          taken: new Set([...inner.taken, found])
        };
      }, state),
    empty
  );

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
