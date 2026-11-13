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

/** 一行的规则；填错了返回那句错误。 */
const ruleOfRow = (cell: Cell, lineKind: KitLineKind): KitLineRule | string => {
  if (lineKind === "text") return emptyRule();
  const basis = BASIS_BY_LABEL[cell("计算方式")];
  if (!basis)
    return `计算方式只能填 固定、按总长、按最长一段、按段：${cell("计算方式")}`;
  const numbers: Record<string, number | null> = {};
  for (const column of ["系数", "另加"]) {
    const text = cell(column);
    const value = text === "" ? null : Number(text);
    if (value !== null && !Number.isFinite(value))
      return `${column}不是数字：${text}`;
    if (value !== null && value < 0) return `${column}不能是负数：${text}`;
    numbers[column] = value;
  }
  const flags: Record<string, boolean> = {};
  for (const column of ["每套一份", "规格随管径"]) {
    const flag = FLAG_BY_LABEL[cell(column)];
    if (flag === undefined) return `${column}只能填 是 或 否：${cell(column)}`;
    flags[column] = flag;
  }
  const role = ROLE_BY_LABEL[cell("标记")];
  if (role === undefined) return `标记只能填 主机、发电、住宿：${cell("标记")}`;
  return {
    qty_basis: basis,
    // 固定的行不存系数和另加，和服务端一致
    qty_factor: basis === "fixed" ? null : numbers["系数"],
    qty_extra: basis === "fixed" ? null : numbers["另加"],
    qty_per_set: flags["每套一份"],
    spec_by_diameter: flags["规格随管径"],
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
    const lineKind = KIND_BY_LABEL[cell("类型")];
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
