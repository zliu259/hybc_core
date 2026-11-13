/**
 * 「粘贴模板行」：从 Excel 复制的表格 → 模板行。
 * 必有的列：分节、类型、品名；可选：规格、单位、默认数量、设备类别、备注，
 * 以及计算规则的六列：计算方式、系数、另加、每套一份、规格随管径、标记。
 */
import type {
  KitLineKind,
  KitLineRole,
  KitLineRule,
  KitQtyBasis,
  TemplateLineInput
} from "@/api/wh/kit-types";
import type { ImportRowError } from "@/api/wh/types";
import type { ParsedTable } from "../shared/csv";
import { emptyRule } from "./kit-plan-view";

const KIND_BY_LABEL: Record<string, KitLineKind> = {
  设备: "device",
  按台: "device",
  物资: "material",
  周转: "material",
  消耗: "material",
  备忘: "text"
};

const BASIS_BY_LABEL: Record<string, KitQtyBasis> = {
  "": "fixed",
  固定: "fixed",
  按总长: "per_total_metre",
  按最长一段: "per_longest_metre",
  按段: "per_section"
};

const ROLE_BY_LABEL: Record<string, KitLineRole | null> = {
  "": null,
  主机: "main_machine",
  发电: "power",
  住宿: "lodging"
};

const FLAG_BY_LABEL: Record<string, boolean> = {
  "": false,
  否: false,
  "0": false,
  是: true,
  "1": true,
  "√": true
};

const optional = (text: string): string | null =>
  text.trim() === "" ? null : text.trim();

type Cell = (column: string) => string;

/** 只认表里自己写的词；「constructor」这类词不会碰巧查到东西。 */
const lookup = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** 一格数字：空的是 null；填错了返回那句错误。 */
const numberCell = (column: string, text: string): number | null | string => {
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return `${column}不是数字：${text}`;
  if (value < 0) return `${column}不能是负数：${text}`;
  return value;
};

/** 一格是或否：填错了返回那句错误。 */
const flagCell = (column: string, text: string): boolean | string => {
  const flag = lookup(FLAG_BY_LABEL, text);
  return flag === undefined ? `${column}只能填 是 或 否：${text}` : flag;
};

/** 一行的规则；填错了返回那句错误。 */
const ruleOfRow = (cell: Cell, lineKind: KitLineKind): KitLineRule | string => {
  if (lineKind === "text") return emptyRule();
  const basis = lookup(BASIS_BY_LABEL, cell("计算方式"));
  if (!basis)
    return `计算方式只能填 固定、按总长、按最长一段、按段：${cell("计算方式")}`;
  const factor = numberCell("系数", cell("系数"));
  if (typeof factor === "string") return factor;
  const extra = numberCell("另加", cell("另加"));
  if (typeof extra === "string") return extra;
  if (basis === "fixed") {
    // 固定的行不用系数和另加。填了多半是忘了选计算方式：说出来，不悄悄丢掉
    const filled = factor !== null ? "系数" : extra !== null ? "另加" : null;
    if (filled)
      return `填了${filled}，但计算方式是固定。要按它算就填计算方式，不用就把${filled}清掉`;
  }
  const perSet = flagCell("每套一份", cell("每套一份"));
  if (typeof perSet === "string") return perSet;
  const byDiameter = flagCell("规格随管径", cell("规格随管径"));
  if (typeof byDiameter === "string") return byDiameter;
  const role = lookup(ROLE_BY_LABEL, cell("标记"));
  if (role === undefined) return `标记只能填 主机、发电、住宿：${cell("标记")}`;
  return {
    qty_basis: basis,
    qty_factor: factor,
    qty_extra: extra,
    qty_per_set: perSet,
    spec_by_diameter: byDiameter,
    role
  };
};

/**
 * 粘贴的模板表格 → 模板行。类型认 设备/按台、物资/周转/消耗、备忘；设备类别按名字找。
 * 没有规则的那几列时，每一行都是固定、不勾、不标。
 */
export const mapTemplateRows = (
  table: ParsedTable,
  categories: readonly { id: number; name: string }[]
): { rows: TemplateLineInput[]; errors: ImportRowError[] } => {
  const missing = ["分节", "类型", "品名"].filter(
    column => !table.headers.includes(column)
  );
  if (missing.length)
    return {
      rows: [],
      errors: [{ row: 0, message: `缺少列：${missing.join("、")}` }]
    };
  const categoryByName = new Map(
    categories.map(category => [category.name, category.id])
  );
  const rows: TemplateLineInput[] = [];
  const errors: ImportRowError[] = [];
  table.rows.forEach((row, index) => {
    const cell: Cell = column => (row[column] ?? "").trim();
    const fail = (message: string) => errors.push({ row: index + 1, message });
    const lineKind = lookup(KIND_BY_LABEL, cell("类型"));
    if (!lineKind)
      return fail(`类型只能填 设备、物资 或 备忘：${cell("类型")}`);
    let categoryId: number | null = null;
    if (lineKind === "device") {
      if (!cell("设备类别")) return fail("设备行要填设备类别");
      categoryId = categoryByName.get(cell("设备类别")) ?? null;
      if (categoryId === null)
        return fail(
          `设备类别不存在：${cell("设备类别")}，请先在库房设置里添加`
        );
    }
    const qtyText = cell("默认数量");
    const qty = qtyText === "" ? null : Number(qtyText);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0))
      return fail(`默认数量不是数字：${qtyText}`);
    if (lineKind === "device" && qty !== null && !Number.isInteger(qty))
      return fail("设备数量必须是整数");
    const rule = ruleOfRow(cell, lineKind);
    if (typeof rule === "string") return fail(rule);
    rows.push({
      section: cell("分节"),
      line_kind: lineKind,
      device_category_id: categoryId,
      name_text: cell("品名"),
      spec_text: optional(cell("规格")),
      unit: optional(cell("单位")),
      default_qty: qty,
      note: optional(cell("备注")),
      ...rule
    });
  });
  return { rows, errors };
};
