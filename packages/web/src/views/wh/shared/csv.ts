/**
 * 导入用的表格解析：从 Excel 复制粘贴（制表符）或 CSV 都行。
 * 列名用中文，见 docs/superpowers/plans/2026-11-11-warehouse-phase0-verify.md 任务 4。
 */
import type { DeviceImportRow, MaterialImportRow } from "@/api/wh/types";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export interface MappedRows<T> {
  rows: T[];
  errors: { row: number; message: string }[];
}

const splitLine = (line: string, separator: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      quoted = true;
    } else if (char === separator) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

export const parseTable = (text: string): ParsedTable => {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter(line => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const separator = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], separator);
  const rows = lines.slice(1).map(line => {
    const cells = splitLine(line, separator);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""])
    );
  });
  return { headers, rows };
};

const missingColumns = (table: ParsedTable, required: string[]) =>
  required.filter(column => !table.headers.includes(column));

const toNumber = (text: string): number | null => {
  if (text.trim() === "") return null;
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : Number.NaN;
};

export const mapDeviceRows = (
  table: ParsedTable
): MappedRows<DeviceImportRow> => {
  const missing = missingColumns(table, ["名称", "类别"]);
  if (missing.length)
    return {
      rows: [],
      errors: [{ row: 0, message: `缺少列：${missing.join("、")}` }]
    };
  const rows: DeviceImportRow[] = [];
  const errors: MappedRows<DeviceImportRow>["errors"] = [];
  table.rows.forEach((row, index) => {
    const cell = (column: string) => (row[column] ?? "").trim();
    const diameter = toNumber(cell("口径"));
    if (diameter !== null && !Number.isInteger(diameter)) {
      errors.push({ row: index + 1, message: `口径不是整数：${cell("口径")}` });
      return;
    }
    rows.push({
      device_code: cell("编号"),
      name: cell("名称"),
      alias: cell("现场叫法"),
      category_name: cell("类别"),
      machine_type: cell("机型"),
      diameter_mm: diameter,
      manufacturer: cell("厂家"),
      model: cell("型号"),
      serial_no: cell("出厂编号"),
      spec: cell("规格"),
      project_name: cell("所在项目"),
      storage_note: cell("库位"),
      remark: cell("备注")
    });
  });
  return { rows, errors };
};

const KIND_BY_LABEL: Record<string, MaterialImportRow["kind"]> = {
  周转: "turnover",
  消耗: "consumable"
};

export const mapMaterialRows = (
  table: ParsedTable
): MappedRows<MaterialImportRow> => {
  const missing = missingColumns(table, ["品名", "单位", "分节", "管法"]);
  if (missing.length)
    return {
      rows: [],
      errors: [{ row: 0, message: `缺少列：${missing.join("、")}` }]
    };
  const rows: MaterialImportRow[] = [];
  const errors: MappedRows<MaterialImportRow>["errors"] = [];
  table.rows.forEach((row, index) => {
    const cell = (column: string) => (row[column] ?? "").trim();
    const fail = (message: string) => errors.push({ row: index + 1, message });
    const kind = KIND_BY_LABEL[cell("管法")];
    if (!kind) return fail(`管法只能填 周转 或 消耗：${cell("管法")}`);
    const numbers: Record<string, number | null> = {};
    for (const column of ["期初数量", "单价", "最低库存"]) {
      const value = toNumber(cell(column));
      if (Number.isNaN(value))
        return fail(`${column}不是数字：${cell(column)}`);
      numbers[column] = value;
    }
    rows.push({
      name: cell("品名"),
      spec: cell("规格"),
      unit: cell("单位"),
      category: cell("分节"),
      kind,
      opening_quantity: numbers["期初数量"],
      unit_price: numbers["单价"],
      min_stock: numbers["最低库存"],
      storage_note: cell("库位"),
      remark: cell("备注")
    });
  });
  return { rows, errors };
};
