/**
 * 配套清单模板行和项目清单行共用的校验。错误信息带行号，方便对着表格改。
 */
import type { Env } from "../../types/env";
import type {
  KitLineKind,
  KitLineRole,
  KitLineSource,
  KitQtyBasis,
  Material
} from "../../types/wh";
import { materialLabel } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { queryIn } from "./query-in";
import {
  optionalId,
  optionalNumber,
  optionalQuantity,
  optionalText,
  requireEnum,
  requireText
} from "./validation";

export const MAX_KIT_LINES = 300;

export const KIT_LINE_KINDS: readonly KitLineKind[] = ["device", "material", "text"];
export const KIT_LINE_SOURCES: readonly KitLineSource[] = [
  "warehouse",
  "site_purchase",
  "rental",
  "on_site"
];

export const KIT_QTY_BASES: readonly KitQtyBasis[] = [
  "fixed",
  "per_total_metre",
  "per_longest_metre",
  "per_section"
];
export const KIT_LINE_ROLES: readonly KitLineRole[] = ["main_machine", "power", "lodging"];

/** 模板行上的计算规则。清单行没有规则，恒为默认值。 */
export interface KitLineRule {
  qty_basis: KitQtyBasis;
  /** 每米、每段多少；固定时为空 */
  qty_factor: number | null;
  /** 算完再加的固定余量；固定时为空 */
  qty_extra: number | null;
  /** 每套设备各要一份：结果再乘套数 */
  qty_per_set: boolean;
  spec_by_diameter: boolean;
  role: KitLineRole | null;
}

export const defaultRule = (): KitLineRule => ({
  qty_basis: "fixed",
  qty_factor: null,
  qty_extra: null,
  qty_per_set: false,
  spec_by_diameter: false,
  role: null
});

export interface ParsedKitLine {
  section: string;
  sort_order: number;
  line_kind: KitLineKind;
  device_category_id: number | null;
  material_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  /** 模板里是默认数量（可空），清单里是计划数（空当 0）。 */
  qty: number | null;
  source: KitLineSource;
  note: string | null;
  rule: KitLineRule;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const withRow = <T>(index: number, parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof WarehouseError) throw badRequest(`第 ${index + 1} 行：${error.message}`);
    throw error;
  }
};

const RULE_NUMBER_RANGE = { min: 0, max: 1_000_000 };

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

const parseFlag = (value: unknown, label: string): boolean => {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  throw badRequest(`${label}只能是勾或不勾`);
};

/** 模板行的规则。备忘行不参与计算，不存规则；固定的行不存系数和另加。 */
const parseRule = (line: Record<string, unknown>, lineKind: KitLineKind): KitLineRule => {
  if (lineKind === "text") return defaultRule();
  const basis = isBlank(line.qty_basis)
    ? "fixed"
    : requireEnum(line.qty_basis, "计算方式", KIT_QTY_BASES);
  const factor = optionalNumber(line.qty_factor, "系数", RULE_NUMBER_RANGE);
  const extra = optionalNumber(line.qty_extra, "另加", RULE_NUMBER_RANGE);
  return {
    qty_basis: basis,
    qty_factor: basis === "fixed" ? null : factor,
    qty_extra: basis === "fixed" ? null : extra,
    qty_per_set: parseFlag(line.qty_per_set, "每套一份"),
    spec_by_diameter: parseFlag(line.spec_by_diameter, "规格随管径"),
    role: isBlank(line.role) ? null : requireEnum(line.role, "标记", KIT_LINE_ROLES)
  };
};

const parseLine = (raw: unknown, index: number, mode: "template" | "kit"): ParsedKitLine =>
  withRow(index, () => {
    const line = asRecord(raw);
    const lineKind = requireEnum(line.line_kind, "类型", KIT_LINE_KINDS);
    const deviceCategoryId =
      lineKind === "device" ? optionalId(line.device_category_id, "设备类别") : null;
    if (lineKind === "device" && deviceCategoryId === null) throw badRequest("设备行要选设备类别");
    const qtyValue = mode === "template" ? line.default_qty : line.planned_qty;
    const qty = optionalQuantity(qtyValue, lineKind === "device" ? "设备数量" : "数量", {
      integer: lineKind === "device"
    });
    return {
      section: requireText(line.section, "分节", 20),
      sort_order: index,
      line_kind: lineKind,
      device_category_id: deviceCategoryId,
      material_id:
        mode === "kit" && lineKind === "material" ? optionalId(line.material_id, "物资") : null,
      name_text: requireText(line.name_text, "品名", 60),
      spec_text: optionalText(line.spec_text, "规格", 60),
      unit: optionalText(line.unit, "单位", 10),
      qty: mode === "kit" ? (qty ?? 0) : qty,
      source:
        mode === "kit" && line.source !== undefined && line.source !== null
          ? requireEnum(line.source, "来源", KIT_LINE_SOURCES)
          : "warehouse",
      note: optionalText(line.note, "备注", 200),
      rule: mode === "template" ? parseRule(line, lineKind) : defaultRule()
    };
  });

export const parseKitLines = (raw: unknown, mode: "template" | "kit"): ParsedKitLine[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("行的格式不对");
  if (raw.length > MAX_KIT_LINES) throw badRequest(`最多 ${MAX_KIT_LINES} 行`);
  return raw.map((line, index) => parseLine(line, index, mode));
};

const firstRowOf = (lines: readonly ParsedKitLine[], match: (line: ParsedKitLine) => boolean) =>
  lines.findIndex(match) + 1;

export const assertCategoriesExist = async (
  env: Env,
  lines: readonly ParsedKitLine[]
): Promise<void> => {
  const ids = [
    ...new Set(lines.flatMap((line) => (line.device_category_id ? [line.device_category_id] : [])))
  ];
  const found = new Set(
    (
      await queryIn<{ id: number }>(
        env.DB,
        (inList) => `SELECT id FROM device_category WHERE id IN (${inList})`,
        ids
      )
    ).map((row) => Number(row.id))
  );
  const missing = ids.find((id) => !found.has(id));
  if (missing !== undefined) {
    const row = firstRowOf(lines, (line) => line.device_category_id === missing);
    throw badRequest(`第 ${row} 行：设备类别不存在`);
  }
};

export const assertMaterialsActive = async (
  env: Env,
  lines: readonly Pick<ParsedKitLine, "material_id">[]
): Promise<void> => {
  const ids = [...new Set(lines.flatMap((line) => (line.material_id ? [line.material_id] : [])))];
  const materials = new Map(
    (
      await queryIn<Material>(
        env.DB,
        (inList) => `SELECT * FROM material WHERE id IN (${inList})`,
        ids
      )
    ).map((row) => [Number(row.id), row])
  );
  lines.forEach((line, index) => {
    if (!line.material_id) return;
    const material = materials.get(line.material_id);
    if (!material) throw badRequest(`第 ${index + 1} 行：物资不存在`);
    if (material.status !== "active")
      throw badRequest(`第 ${index + 1} 行：物资已停用：${materialLabel(material)}`);
  });
};
