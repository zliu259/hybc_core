// lib/table-presets.ts — 清单表格（设备/材料）纯函数层。
// 列 schema 按预设派生（不入库、不自由列）；含税金额 = 数量 × 单价 由此处计算，
// 合同大写金额仍由后端 amount-cn 权威生成，这里只做展示与「合计 vs 合同总价」一致性判断。
// 与后端 contract-draft-table.ts 的 preset 枚举保持一致。

export const TABLE_PRESETS = [
  "equipment_wet",
  "equipment_dry",
  "goods"
] as const;
export type TablePreset = (typeof TABLE_PRESETS)[number];

export type TableColumnType =
  | "seq"
  | "text"
  | "number"
  | "money"
  | "enum"
  | "amount";

export interface TableColumn {
  key: string;
  label: string;
  type: TableColumnType;
  required?: boolean;
  options?: string[];
  /** 单元格宽度提示：docx 用 dxa，编辑器按比例折算 */
  width: number;
  placeholder?: string;
  defaultValue?: string;
}

/** 单行：仅存原始录入值（不含 seq/amount 计算列）。 */
export type TableRow = Record<string, string | number | boolean | undefined>;

export interface ContractTable {
  preset: TablePreset;
  rows: TableRow[];
}

const TAX_RATE_OPTIONS = ["13%", "9%", "6%", "3%", "1%", "0%"];

const EQUIPMENT_WET_COLUMNS: TableColumn[] = [
  { key: "seq", label: "序号", type: "seq", width: 640 },
  { key: "name", label: "设备名称", type: "text", required: true, width: 1700 },
  { key: "spec", label: "规格型号", type: "text", required: true, width: 1700 },
  {
    key: "work_content",
    label: "工作内容/绑定工序",
    type: "text",
    required: true,
    width: 2000
  },
  {
    key: "unit",
    label: "计价单位",
    type: "enum",
    options: ["台班", "月"],
    required: true,
    width: 1000
  },
  { key: "qty", label: "数量", type: "number", required: true, width: 900 },
  {
    key: "unit_price",
    label: "含税单价(元)",
    type: "money",
    required: true,
    width: 1300
  },
  { key: "amount", label: "含税金额(元)", type: "amount", width: 1400 },
  {
    key: "operator",
    label: "是否含操作人员",
    type: "enum",
    options: ["含操作人员", "不含操作人员"],
    required: true,
    width: 1500
  },
  {
    key: "tax_rate",
    label: "税率",
    type: "enum",
    options: TAX_RATE_OPTIONS,
    defaultValue: "13%",
    width: 900
  },
  { key: "remark", label: "备注", type: "text", width: 1500 }
];

const EQUIPMENT_DRY_COLUMNS: TableColumn[] = [
  { key: "seq", label: "序号", type: "seq", width: 640 },
  { key: "name", label: "设备名称", type: "text", required: true, width: 1900 },
  { key: "spec", label: "规格型号", type: "text", required: true, width: 1900 },
  {
    key: "unit",
    label: "计价单位",
    type: "enum",
    options: ["台班", "月"],
    required: true,
    width: 1100
  },
  { key: "qty", label: "数量", type: "number", required: true, width: 1000 },
  {
    key: "unit_price",
    label: "含税单价(元)",
    type: "money",
    required: true,
    width: 1400
  },
  { key: "amount", label: "含税金额(元)", type: "amount", width: 1500 },
  {
    key: "tax_rate",
    label: "税率",
    type: "enum",
    options: TAX_RATE_OPTIONS,
    defaultValue: "13%",
    width: 1000
  },
  { key: "remark", label: "备注", type: "text", width: 1600 }
];

const GOODS_COLUMNS: TableColumn[] = [
  { key: "seq", label: "序号", type: "seq", width: 640 },
  { key: "name", label: "货物名称", type: "text", required: true, width: 1900 },
  {
    key: "spec",
    label: "规格型号/材质",
    type: "text",
    required: true,
    width: 1900
  },
  {
    key: "unit",
    label: "单位",
    type: "text",
    required: true,
    width: 900,
    placeholder: "如 吨/m³/卷"
  },
  { key: "qty", label: "数量", type: "number", required: true, width: 1000 },
  {
    key: "unit_price",
    label: "含税单价(元)",
    type: "money",
    required: true,
    width: 1400
  },
  { key: "amount", label: "含税金额(元)", type: "amount", width: 1500 },
  {
    key: "tax_rate",
    label: "税率",
    type: "enum",
    options: TAX_RATE_OPTIONS,
    defaultValue: "13%",
    width: 900
  },
  {
    key: "delivery_date",
    label: "交货期",
    type: "text",
    width: 1400,
    placeholder: "如 签订后30日内"
  },
  { key: "remark", label: "备注", type: "text", width: 1400 }
];

const PRESET_COLUMNS: Record<TablePreset, TableColumn[]> = {
  equipment_wet: EQUIPMENT_WET_COLUMNS,
  equipment_dry: EQUIPMENT_DRY_COLUMNS,
  goods: GOODS_COLUMNS
};

const PRESET_LABELS: Record<TablePreset, string> = {
  equipment_wet: "设备清单（湿租·含操作人员列）",
  equipment_dry: "设备清单（干租）",
  goods: "材料/货物清单"
};

const isPreset = (v: unknown): v is TablePreset =>
  typeof v === "string" && (TABLE_PRESETS as readonly string[]).includes(v);

/** 列 schema（含 seq/amount 计算列，用于渲染）。 */
export const getPresetColumns = (preset: TablePreset): TableColumn[] =>
  PRESET_COLUMNS[preset];

/** 可录入列（剔除 seq/amount 计算列），用于建空行与序列化。 */
export const editableColumns = (preset: TablePreset): TableColumn[] =>
  PRESET_COLUMNS[preset].filter(c => c.type !== "seq" && c.type !== "amount");

export const presetLabel = (preset: TablePreset): string =>
  PRESET_LABELS[preset];

/**
 * (section_key, variant_key) → 预设。equipment_schedule 干租变体走 dry，其余（含默认）走湿租；
 * goods_spec 走货物；其他节无表格。
 */
export const presetForSection = (
  sectionKey: string,
  variantKey: string
): TablePreset | null => {
  if (sectionKey === "equipment_schedule") {
    return variantKey === "dry_lease" ? "equipment_dry" : "equipment_wet";
  }
  if (sectionKey === "goods_spec") return "goods";
  return null;
};

/** 该节是否为清单表格节。 */
export const sectionHasTable = (
  sectionKey: string,
  variantKey: string
): boolean => presetForSection(sectionKey, variantKey) !== null;

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** 含税金额 = 数量 × 单价（任一缺失或非法记 0）。 */
export const computeRowAmount = (row: TableRow): number =>
  Math.round(toNumber(row.qty) * toNumber(row.unit_price) * 100) / 100;

/** 合计 = 各行含税金额之和。 */
export const computeTableTotal = (table: ContractTable): number =>
  Math.round(
    table.rows.reduce((sum, r) => sum + computeRowAmount(r), 0) * 100
  ) / 100;

/** 空行：带默认值列填入默认值，其余为空串。 */
export const emptyRow = (preset: TablePreset): TableRow => {
  const row: TableRow = {};
  for (const col of editableColumns(preset)) {
    row[col.key] = col.defaultValue ?? "";
  }
  return row;
};

/** 解析 table_json；预设非法或结构不符返回 null。 */
export const parseTable = (
  json: string | null | undefined
): ContractTable | null => {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!isPreset(obj.preset) || !Array.isArray(obj.rows)) return null;
  const rows = obj.rows.filter(
    (r): r is TableRow =>
      typeof r === "object" && r !== null && !Array.isArray(r)
  );
  return { preset: obj.preset, rows };
};

/** 序列化：仅保留可录入列的值（剔除 seq/amount 计算列），保证入库形状稳定。 */
export const serializeTable = (table: ContractTable): string => {
  const cols = editableColumns(table.preset).map(c => c.key);
  const rows = table.rows.map(r => {
    const clean: TableRow = {};
    for (const key of cols) {
      const v = r[key];
      if (v !== undefined && v !== "") clean[key] = v;
    }
    return clean;
  });
  return JSON.stringify({ preset: table.preset, rows });
};

export interface TableRowError {
  rowIndex: number;
  colKey: string;
  colLabel: string;
  message: string;
}

/** 校验：必填列缺失（湿租 operator 即在必填之列，天然强制）。空表不报错（用户可不填清单）。 */
export const validateTable = (table: ContractTable): TableRowError[] => {
  const errors: TableRowError[] = [];
  const required = editableColumns(table.preset).filter(c => c.required);
  table.rows.forEach((row, rowIndex) => {
    for (const col of required) {
      const v = row[col.key];
      const empty =
        v === undefined || (typeof v === "string" && v.trim() === "");
      if (empty) {
        errors.push({
          rowIndex,
          colKey: col.key,
          colLabel: col.label,
          message: `第 ${rowIndex + 1} 行「${col.label}」未填写`
        });
      }
    }
  });
  return errors;
};

/** 金额展示：千分位 + 两位小数。 */
export const formatMoney = (n: number): string =>
  n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export interface TableGrid {
  header: string[];
  widths: number[];
  /** 各数据行（seq/amount 计算列已填好）+ 末行合计。 */
  rows: string[][];
}

/**
 * 渲染网格（docx 真表格 / 结构化预览用）：表头 + 各行（含序号、含税金额计算列）+ 合计行。
 * 空表返回空 rows。金额取 computeRowAmount，合计取 computeTableTotal。
 */
export const tableToGrid = (table: ContractTable): TableGrid => {
  const cols = getPresetColumns(table.preset);
  const header = cols.map(c => c.label);
  const widths = cols.map(c => c.width);
  const bodyRows = table.rows.map((row, i) =>
    cols.map(c => {
      if (c.type === "seq") return String(i + 1);
      if (c.type === "amount") return formatMoney(computeRowAmount(row));
      const v = row[c.key];
      return v === undefined || v === "" ? "" : String(v);
    })
  );
  const totalRow = cols.map((c, idx) => {
    if (idx === 0) return "合计";
    if (c.type === "amount") return formatMoney(computeTableTotal(table));
    return "";
  });
  const rows = table.rows.length ? [...bodyRows, totalRow] : [];
  return { header, widths, rows };
};

/** 渲染为纯文本（AI 上下文 / 预览用）。带表头、逐行、合计。 */
export const tableToPlainText = (table: ContractTable): string => {
  if (!table.rows.length) return "";
  const cols = getPresetColumns(table.preset);
  const header = cols.map(c => c.label).join(" | ");
  const lines = table.rows.map((row, i) =>
    cols
      .map(c => {
        if (c.type === "seq") return String(i + 1);
        if (c.type === "amount") return formatMoney(computeRowAmount(row));
        const v = row[c.key];
        return v === undefined || v === "" ? "—" : String(v);
      })
      .join(" | ")
  );
  const total = `合计：¥${formatMoney(computeTableTotal(table))}`;
  return [header, ...lines, total].join("\n");
};
