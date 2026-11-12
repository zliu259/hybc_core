/** 盘点接口的类型，字段和后端 services/warehouse/stocktake-*.ts 的返回一致。 */

export type StocktakeScope = "material" | "device" | "all";
export type StocktakeStatus = "counting" | "done" | "cancelled";

export interface StocktakeRow {
  id: number;
  stocktake_no: string;
  scope: StocktakeScope;
  status: StocktakeStatus;
  remark: string | null;
  cancel_reason: string | null;
  created_by_userid: string;
  completed_by_userid: string | null;
  completed_at: string | null;
  cancelled_by_userid: string | null;
  cancelled_at: string | null;
  /** 每次改这次盘点或它的行都加一；完成时带上 */
  version: number;
  created_at: string;
  updated_at: string;
  material_total: number;
  material_counted: number;
  /** 已录且实盘数和账面数不一样的条数 */
  material_diff: number;
  /** 发起时账上在库的台数 */
  device_expected: number;
  device_found: number;
  /** 盘点中：现在点完成会被记成没找到的台数；已完成：记成没找到的台数 */
  device_missing: number;
  /** 扫到了但发起时账上不在库的 */
  device_unexpected: number;
  adjust_doc_id: number | null;
  adjust_doc_no: string | null;
}

export interface StocktakeMaterialLineRow {
  id: number;
  stocktake_id: number;
  material_id: number;
  counted_qty: number | null;
  /** 录入实盘数那一刻的账面数 */
  book_qty: number | null;
  note: string | null;
  counted_by_userid: string | null;
  counted_at: string | null;
  created_at: string;
  updated_at: string;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  storage_note: string | null;
  /** 现在的账面数 */
  current_qty: number;
  /** 实盘数减录入时的账面数；没录是 null */
  diff: number | null;
}

export interface StocktakeDeviceLineRow {
  id: number;
  stocktake_id: number;
  device_id: number;
  /** 1：发起时账上在库；0：盘的时候扫到的 */
  expected: 0 | 1;
  /** null：还没看；1：找到；0：没找到 */
  found: 0 | 1 | null;
  note: string | null;
  scanned_by_userid: string | null;
  scanned_at: string | null;
  created_at: string;
  updated_at: string;
  device_code: string;
  device_name: string;
  alias: string | null;
  category_name: string | null;
  storage_note: string | null;
  location: "warehouse" | "project" | "scrapped";
  project_name: string | null;
}

export interface StocktakeDetail extends StocktakeRow {
  material_lines: StocktakeMaterialLineRow[];
  device_lines: StocktakeDeviceLineRow[];
}

export interface DeviceMarkResult {
  line: StocktakeDeviceLineRow;
  /** 这台设备账上不在库 */
  unexpected: boolean;
  hint: string | null;
}

export interface CompleteStocktakeResult {
  stocktake: StocktakeDetail;
  adjust_doc: { id: number; doc_no: string } | null;
  replayed: boolean;
}

export interface StocktakeQuery {
  status?: StocktakeStatus;
  page?: number;
  pageSize?: number;
}

/** 带 counted_qty 是录数（null 是清掉这一行）；只带 note 是只改备注，不重记账面数 */
export interface StocktakeCountInput {
  counted_qty?: number | null;
  note?: string;
}

export interface DeviceMarkInput {
  device_id?: number;
  device_code?: string;
  found: boolean | null;
  note?: string;
}
