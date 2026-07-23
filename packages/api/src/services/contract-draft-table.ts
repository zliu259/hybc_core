// packages/api/src/services/contract-draft-table.ts
// 清单表格（设备/材料）的服务端边界校验与哨兵常量。
// 列 schema、金额计算、渲染都在前端；后端只把 table_json 当作结构化 blob 存取，
// 但入库前必须做边界校验（预设枚举 / 行数与单元格上限 / 归一化再序列化），
// 防止超大或畸形 blob 落库。合计=合同总价的一致性由前端与人工把关，后端不算数字。

/** 正文中标记清单表格插入位置的哨兵占位符键名（渲染时替换为真表格）。 */
export const TABLE_SENTINEL = "__table__";

/** 三种清单预设：湿租设备 / 干租设备 / 货物（材料）。列由前端按预设派生。 */
export const TABLE_PRESETS = ["equipment_wet", "equipment_dry", "goods"] as const;
export type TablePreset = (typeof TABLE_PRESETS)[number];

const MAX_TABLE_ROWS = 200;
const MAX_CELL_LEN = 500;
const MAX_TABLE_JSON_LEN = 200_000;

export type TableValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

const isPreset = (v: unknown): v is TablePreset =>
  typeof v === "string" && (TABLE_PRESETS as readonly string[]).includes(v);

/**
 * 校验并归一化前端提交的 table_json 字符串。
 * 合法则返回归一化后的 JSON 字符串（仅保留 preset + rows，剔除多余字段）；
 * 非法则返回带中文原因的失败结果，由路由转 400。
 */
export const validateTableJson = (raw: string): TableValidation => {
  if (raw.length > MAX_TABLE_JSON_LEN) {
    return { ok: false, message: "清单表格数据过大" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "table_json 不是合法 JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "table_json 必须是对象" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!isPreset(obj.preset)) {
    return { ok: false, message: "table_json.preset 非法" };
  }
  if (!Array.isArray(obj.rows)) {
    return { ok: false, message: "table_json.rows 必须是数组" };
  }
  if (obj.rows.length > MAX_TABLE_ROWS) {
    return { ok: false, message: `清单行数不能超过 ${MAX_TABLE_ROWS} 行` };
  }
  const normalizedRows: Record<string, string | number | boolean>[] = [];
  for (const row of obj.rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return { ok: false, message: "清单每一行必须是对象" };
    }
    const normalizedRow: Record<string, string | number | boolean> = {};
    for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
      if (cell === null || cell === undefined) continue;
      if (typeof cell === "string") {
        if (cell.length > MAX_CELL_LEN) {
          return { ok: false, message: "清单单元格内容过长" };
        }
        normalizedRow[key] = cell;
      } else if (typeof cell === "number") {
        if (!Number.isFinite(cell)) {
          return { ok: false, message: "清单数值非法" };
        }
        normalizedRow[key] = cell;
      } else if (typeof cell === "boolean") {
        normalizedRow[key] = cell;
      } else {
        return { ok: false, message: "清单单元格类型非法" };
      }
    }
    normalizedRows.push(normalizedRow);
  }
  return { ok: true, value: JSON.stringify({ preset: obj.preset, rows: normalizedRows }) };
};
