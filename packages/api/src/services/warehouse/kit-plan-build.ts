/**
 * 按项目参数生成配套清单的生成器：模板 + 参数 → 行、主要设备的候选、提醒。
 * 预览和创建共用，自己不写库。
 */
import type { Env } from "../../types/env";
import type { KitTemplate, KitTemplateLine } from "../../types/wh";
import { badRequest } from "./errors";
import { pickMaterial } from "./kit-build";
import { defaultRule, type KitLineRule, type ParsedKitLine } from "./kit-lines";
import { calcLineQty, hasAnyRule, type MissingInput, type PlanParams } from "./kit-plan-calc";
import { loadSpecChoices } from "./kit-query";

export interface PlannedLine extends ParsedKitLine {
  /** 生成的行数量总是有的 */
  qty: number;
  /** 数量是怎么算的；固定的行是空的 */
  calc_text: string | null;
  /** 物资行还没对上具体的物资，要人选规格 */
  needs_spec: boolean;
  material_label: string | null;
}

export interface PlanCandidate {
  device_code: string;
  name: string;
  diameter_mm: number | null;
}

export interface PlanDevice {
  name_text: string;
  qty: number;
  /** 库里合适的设备，只有标了「主机」的行才列 */
  candidates: PlanCandidate[];
}

export interface PlanResult {
  template: { id: number; version: number; name: string; diameter_mm: number | null };
  lines: PlannedLine[];
  devices: PlanDevice[];
  warnings: string[];
}

const NOTE_MAX = 200;
const MAX_CANDIDATES = 5;

const ruleOf = (row: KitTemplateLine): KitLineRule => ({
  qty_basis: row.qty_basis,
  qty_factor: row.qty_factor === null ? null : Number(row.qty_factor),
  qty_extra: row.qty_extra === null ? null : Number(row.qty_extra),
  qty_round_to: row.qty_round_to === null ? null : Number(row.qty_round_to),
  qty_per_set: Number(row.qty_per_set) === 1,
  spec_by_diameter: Number(row.spec_by_diameter) === 1,
  role: row.role
});

const joinNote = (parts: readonly (string | null)[]): string | null =>
  parts
    .filter((part): part is string => Boolean(part))
    .join("；")
    .slice(0, NOTE_MAX) || null;

/** 规格里有没有这个管径：数字要整段相同，D16000 不算 1600。 */
const containsDiameter = (spec: string, diameter: number): boolean =>
  new RegExp(`(^|[^0-9])${diameter}([^0-9]|$)`).test(spec);

const loadCandidates = async (
  env: Env,
  categoryId: number,
  params: PlanParams
): Promise<PlanCandidate[]> => {
  const filters = ["category_id = ?", "location = 'warehouse'"];
  const binds: (string | number)[] = [categoryId];
  if (params.machine_type) {
    filters.push("machine_type = ?");
    binds.push(params.machine_type);
  }
  // 有管径：口径相同的排最前，其次是最接近的。没有管径：按口径从小到大。
  const order =
    params.pipe_diameter_mm === null
      ? "COALESCE(diameter_mm, 999999) ASC"
      : "ABS(COALESCE(diameter_mm, 999999) - ?) ASC";
  if (params.pipe_diameter_mm !== null) binds.push(params.pipe_diameter_mm);
  const rows =
    (
      await env.DB.prepare(
        `SELECT device_code, name, diameter_mm FROM device
          WHERE ${filters.join(" AND ")}
          ORDER BY ${order}, device_code ASC LIMIT ${MAX_CANDIDATES}`
      )
        .bind(...binds)
        .all<PlanCandidate>()
    ).results ?? [];
  return rows.map((row) => ({
    device_code: row.device_code,
    name: row.name,
    diameter_mm: row.diameter_mm === null ? null : Number(row.diameter_mm)
  }));
};

/** 候选设备的那句话。后面还要接别的备注，放不下就少列几台。 */
const candidatesText = (
  candidates: readonly PlanCandidate[],
  hasMachineType: boolean,
  tail: string | null
): string => {
  if (candidates.length === 0) {
    return hasMachineType ? "生成时库里没有同机型的在库设备" : "生成时库里没有在库的设备";
  }
  const budget = NOTE_MAX - (tail ? tail.length + 1 : 0);
  const entries = candidates.map(
    (device) =>
      `${device.device_code} ${device.name}${device.diameter_mm === null ? "" : `（${device.diameter_mm}）`}`
  );
  return entries
    .slice(1)
    .reduce(
      (text, entry) => (text.length + 1 + entry.length <= budget ? `${text}、${entry}` : text),
      `生成时在库：${entries[0]}`
    );
};

interface LineContext {
  env: Env;
  params: PlanParams;
  diameterDiffers: boolean;
  choices: Map<string, { id: number; spec: string }[]>;
}

interface BuiltLine {
  line: PlannedLine;
  missing: MissingInput | null;
  device: PlanDevice | null;
}

const buildLine = async (
  row: KitTemplateLine,
  index: number,
  ctx: LineContext
): Promise<BuiltLine> => {
  const rule = ruleOf(row);
  const base = {
    section: row.section,
    sort_order: index,
    line_kind: row.line_kind,
    device_category_id: row.device_category_id,
    name_text: row.name_text,
    unit: row.unit,
    rule: defaultRule()
  };
  if (row.line_kind === "text") {
    return {
      line: {
        ...base,
        material_id: null,
        spec_text: row.spec_text,
        qty: 0,
        source: "warehouse",
        note: row.note,
        calc_text: null,
        needs_spec: false,
        material_label: null
      },
      missing: null,
      device: null
    };
  }

  const calc = calcLineQty(
    rule,
    row.default_qty === null ? null : Number(row.default_qty),
    ctx.params
  );
  const supplies = ctx.params.client_supplies;
  const source =
    (rule.role === "power" && supplies.includes("power")) ||
    (rule.role === "lodging" && supplies.includes("lodging"))
      ? "on_site"
      : "warehouse";

  if (row.line_kind === "device") {
    // 设备按台记，数量总是整数
    const whole = Number.isInteger(calc.qty) ? calc.qty : Math.ceil(calc.qty);
    const calcText = whole === calc.qty ? calc.calc_text : `${calc.calc_text}，设备取整 ${whole}`;
    const isMain = rule.role === "main_machine" && row.device_category_id !== null;
    const candidates = isMain
      ? await loadCandidates(ctx.env, Number(row.device_category_id), ctx.params)
      : [];
    const diameter = ctx.params.pipe_diameter_mm;
    const specText = isMain && diameter !== null ? `D${diameter}` : row.spec_text;
    const tail = joinNote([
      row.note,
      isMain && row.spec_text && row.spec_text !== specText ? `模板规格：${row.spec_text}` : null
    ]);
    const note = isMain
      ? joinNote([candidatesText(candidates, Boolean(ctx.params.machine_type), tail), tail])
      : row.note;
    return {
      line: {
        ...base,
        material_id: null,
        spec_text: specText,
        qty: whole,
        source,
        note,
        calc_text: calcText,
        needs_spec: false,
        material_label: null
      },
      missing: calc.missing,
      device: { name_text: row.name_text, qty: whole, candidates }
    };
  }

  const candidates = ctx.choices.get(row.name_text) ?? [];
  const repick = rule.spec_by_diameter && ctx.diameterDiffers;
  const diameter = ctx.params.pipe_diameter_mm;
  const hits =
    repick && diameter !== null
      ? candidates.filter((candidate) => containsDiameter(candidate.spec, diameter))
      : [];
  const materialId = repick
    ? hits.length === 1
      ? hits[0].id
      : null
    : pickMaterial(row.spec_text, candidates);
  const chosen = candidates.find((candidate) => candidate.id === materialId) ?? null;
  return {
    line: {
      ...base,
      material_id: materialId,
      // 重选规格：选上了就用那条物资的规格，没选上就空着，不沿用模板的
      spec_text: repick ? (chosen ? chosen.spec : null) : row.spec_text,
      qty: calc.qty,
      source,
      note:
        repick && !chosen
          ? joinNote([row.spec_text ? `模板规格：${row.spec_text}` : null, row.note])
          : row.note,
      calc_text: calc.calc_text,
      needs_spec: materialId === null,
      material_label: chosen ? `${row.name_text} ${chosen.spec}`.trim() : null
    },
    missing: calc.missing,
    device: null
  };
};

const MISSING_PARAM_LABEL: Record<Exclude<MissingInput, "factor">, string> = {
  total_length: "总长度",
  longest_drive: "最长一段",
  section_count: "段数"
};

const warningsOf = (
  template: KitTemplate,
  params: PlanParams,
  rows: readonly KitTemplateLine[],
  built: readonly BuiltLine[]
): string[] => {
  const count = (missing: MissingInput) => built.filter((item) => item.missing === missing).length;
  const needSpec = built.filter((item) => item.line.needs_spec && item.line.qty > 0).length;
  const paramKeys: Exclude<MissingInput, "factor">[] = [
    "total_length",
    "longest_drive",
    "section_count"
  ];
  return [
    template.diameter_mm !== null &&
    params.pipe_diameter_mm !== null &&
    template.diameter_mm !== params.pipe_diameter_mm
      ? `模板是 DN${template.diameter_mm}，本项目 D${params.pipe_diameter_mm}`
      : null,
    needSpec > 0 ? `${needSpec} 行要重新选规格` : null,
    ...paramKeys.map((key) =>
      count(key) > 0 ? `缺${MISSING_PARAM_LABEL[key]}，${count(key)} 行用了模板默认数量` : null
    ),
    count("factor") > 0 ? `${count("factor")} 行没填系数，用了模板默认数量` : null,
    hasAnyRule(rows.filter((row) => row.line_kind !== "text").map(ruleOf))
      ? null
      : "这个模板还没配计算规则，数量都是模板默认数量"
  ].filter((text): text is string => text !== null);
};

export const buildPlan = async (
  env: Env,
  templateId: number,
  params: PlanParams
): Promise<PlanResult> => {
  const template = await env.DB.prepare("SELECT * FROM kit_template WHERE id = ?")
    .bind(templateId)
    .first<KitTemplate>();
  if (!template) throw badRequest("模板不存在");
  if (template.status !== "active") throw badRequest("模板已停用");
  const rows =
    (
      await env.DB.prepare(
        "SELECT * FROM kit_template_line WHERE template_id = ? ORDER BY sort_order ASC, id ASC"
      )
        .bind(templateId)
        .all<KitTemplateLine>()
    ).results ?? [];
  const diameterMm = template.diameter_mm === null ? null : Number(template.diameter_mm);
  const ctx: LineContext = {
    env,
    params,
    // 模板没填管径时没法比，按不同处理，不悄悄沿用模板的规格
    diameterDiffers: params.pipe_diameter_mm !== null && diameterMm !== params.pipe_diameter_mm,
    choices: await loadSpecChoices(
      env,
      rows.filter((row) => row.line_kind === "material").map((row) => row.name_text)
    )
  };
  const built = await Promise.all(rows.map((row, index) => buildLine(row, index, ctx)));
  return {
    template: {
      id: Number(template.id),
      version: Number(template.version),
      name: template.name,
      diameter_mm: diameterMm
    },
    lines: built.map((item) => item.line),
    devices: built.flatMap((item) => (item.device ? [item.device] : [])),
    warnings: warningsOf({ ...template, diameter_mm: diameterMm }, params, rows, built)
  };
};
