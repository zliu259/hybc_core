/** 盘点的查询：列表、详情、汇总数。汇总数都在 SQL 里算，不在 JS 里遍历行。 */
import type { Env } from "../../types/env";
import type {
  DeviceLocation,
  Stocktake,
  StocktakeDeviceLine,
  StocktakeMaterialLine,
  StocktakeStatus
} from "../../types/wh";
import type { Paged } from "./device";
import { requireEnum } from "./validation";

export interface StocktakeSummary {
  material_total: number;
  material_counted: number;
  /** 已录且实盘数和账面数不一样的条数 */
  material_diff: number;
  /** 发起时账上在库的台数 */
  device_expected: number;
  /** 其中已经标记找到的 */
  device_found: number;
  /**
   * 没找到的：已完成的盘点里是记成没找到的台数；
   * 盘点中是「现在点完成会被记成没找到」的台数（账上在库、没标记找到、现在仍在库）。
   */
  device_missing: number;
  /** 扫到了但发起时账上不在库的 */
  device_unexpected: number;
}

export type StocktakeRow = Stocktake &
  StocktakeSummary & {
    adjust_doc_id: number | null;
    adjust_doc_no: string | null;
  };

export type StocktakeMaterialLineRow = StocktakeMaterialLine & {
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  storage_note: string | null;
  /** 现在的账面数 */
  current_qty: number;
  /** ROUND(counted_qty - book_qty, 3)，没录是 null */
  diff: number | null;
};

export type StocktakeDeviceLineRow = StocktakeDeviceLine & {
  device_code: string;
  device_name: string;
  alias: string | null;
  category_name: string | null;
  storage_note: string | null;
  location: DeviceLocation;
  project_name: string | null;
};

export interface StocktakeDetail extends StocktakeRow {
  material_lines: StocktakeMaterialLineRow[];
  device_lines: StocktakeDeviceLineRow[];
}

export const STOCKTAKE_STATUSES: readonly StocktakeStatus[] = ["counting", "done", "cancelled"];

/** 断言用，绑定一个参数（盘点 id）：这次盘点还在进行中。 */
export const STOCKTAKE_COUNTING_EXISTS_SQL =
  "SELECT 1 FROM stocktake WHERE id = ? AND status = 'counting'";

/** 以 l 为物资行别名：已录且有差额。完成盘点时出调整单的也是这些行。 */
export const LINE_HAS_DIFF_SQL =
  "l.counted_qty IS NOT NULL AND ROUND(l.counted_qty - l.book_qty, 3) <> 0";

const materialCount = (extra = ""): string =>
  `(SELECT COUNT(*) FROM stocktake_material_line l WHERE l.stocktake_id = s.id${extra})`;
const deviceCount = (extra: string): string =>
  `(SELECT COUNT(*) FROM stocktake_device_line dl JOIN device d ON d.id = dl.device_id
     WHERE dl.stocktake_id = s.id AND ${extra})`;
const adjustDoc = (column: "id" | "doc_no"): string =>
  `(SELECT doc.${column} FROM wh_doc doc WHERE doc.stocktake_id = s.id ORDER BY doc.id ASC LIMIT 1)`;

const SELECT_ROW = `SELECT s.*,
    ${materialCount()} AS material_total,
    ${materialCount(" AND l.counted_qty IS NOT NULL")} AS material_counted,
    ${materialCount(` AND ${LINE_HAS_DIFF_SQL}`)} AS material_diff,
    ${deviceCount("dl.expected = 1")} AS device_expected,
    ${deviceCount("dl.expected = 1 AND dl.found = 1")} AS device_found,
    ${deviceCount(
      `dl.expected = 1 AND (dl.found = 0
         OR (dl.found IS NULL AND s.status = 'counting' AND d.location = 'warehouse'))`
    )} AS device_missing,
    ${deviceCount("dl.expected = 0 AND dl.found = 1")} AS device_unexpected,
    ${adjustDoc("id")} AS adjust_doc_id,
    ${adjustDoc("doc_no")} AS adjust_doc_no
  FROM stocktake s`;

export const SELECT_MATERIAL_LINE = `SELECT l.*, m.material_code, m.name, m.spec, m.unit, m.category,
    m.storage_note, m.quantity AS current_qty,
    CASE WHEN l.counted_qty IS NULL THEN NULL ELSE ROUND(l.counted_qty - l.book_qty, 3) END AS diff
  FROM stocktake_material_line l
  JOIN material m ON m.id = l.material_id`;

export const SELECT_DEVICE_LINE = `SELECT dl.*, d.device_code, d.name AS device_name, d.alias,
    c.name AS category_name, d.storage_note, d.location, p.project_name
  FROM stocktake_device_line dl
  JOIN device d ON d.id = dl.device_id
  LEFT JOIN device_category c ON c.id = d.category_id
  LEFT JOIN project p ON p.id = d.current_project_id`;

const SUMMARY_KEYS: readonly (keyof StocktakeSummary)[] = [
  "material_total",
  "material_counted",
  "material_diff",
  "device_expected",
  "device_found",
  "device_missing",
  "device_unexpected"
];

const toRow = (row: StocktakeRow): StocktakeRow => ({
  ...row,
  ...Object.fromEntries(SUMMARY_KEYS.map((key) => [key, Number(row[key] ?? 0)])),
  id: Number(row.id),
  version: Number(row.version),
  adjust_doc_id: row.adjust_doc_id === null ? null : Number(row.adjust_doc_id)
});

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listStocktakes = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<StocktakeRow>> => {
  const status = query.status ? requireEnum(query.status, "盘点状态", STOCKTAKE_STATUSES) : null;
  const whereSql = status ? " WHERE s.status = ?" : "";
  const params = status ? [status] : [];
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 100);
  const [rows, count] = await Promise.all([
    env.DB.prepare(`${SELECT_ROW}${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<StocktakeRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM stocktake s${whereSql}`)
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return {
    items: (rows.results ?? []).map(toRow),
    total: Number(count?.n ?? 0),
    page,
    pageSize
  };
};

/** 单头加汇总数，不带行。 */
export const getStocktakeRow = async (env: Env, id: number): Promise<StocktakeRow | null> => {
  const row = await env.DB.prepare(`${SELECT_ROW} WHERE s.id = ?`).bind(id).first<StocktakeRow>();
  return row ? toRow(row) : null;
};

/** 进行中的那一次（最多一个）。 */
export const getCountingStocktake = async (
  env: Env
): Promise<Pick<Stocktake, "id" | "stocktake_no"> | null> =>
  env.DB.prepare("SELECT id, stocktake_no FROM stocktake WHERE status = 'counting' LIMIT 1").first<
    Pick<Stocktake, "id" | "stocktake_no">
  >();

export const getStocktake = async (env: Env, id: number): Promise<StocktakeDetail | null> => {
  const row = await getStocktakeRow(env, id);
  if (!row) return null;
  const [materials, devices] = await Promise.all([
    env.DB.prepare(
      `${SELECT_MATERIAL_LINE} WHERE l.stocktake_id = ?
       ORDER BY m.category ASC, m.name ASC, m.spec ASC, m.id ASC`
    )
      .bind(id)
      .all<StocktakeMaterialLineRow>(),
    env.DB.prepare(`${SELECT_DEVICE_LINE} WHERE dl.stocktake_id = ? ORDER BY d.device_code ASC`)
      .bind(id)
      .all<StocktakeDeviceLineRow>()
  ]);
  return {
    ...row,
    material_lines: materials.results ?? [],
    device_lines: devices.results ?? []
  };
};
