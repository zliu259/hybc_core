/**
 * 配套清单模板行和项目清单行共用的校验。错误信息带行号，方便对着表格改。
 */
import type { Env } from "../../types/env";
import type { KitLineKind, KitLineSource, Material } from "../../types/wh";
import { materialLabel } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { queryIn } from "./query-in";
import { optionalId, optionalQuantity, optionalText, requireEnum, requireText } from "./validation";

export const MAX_KIT_LINES = 300;

export const KIT_LINE_KINDS: readonly KitLineKind[] = ["device", "material", "text"];
export const KIT_LINE_SOURCES: readonly KitLineSource[] = [
  "warehouse",
  "site_purchase",
  "rental",
  "on_site"
];

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
      note: optionalText(line.note, "备注", 200)
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
  lines: readonly ParsedKitLine[]
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
