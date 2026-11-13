/** 库房重做（迁移 0095）的表行类型，字段与列一一对应。 */

export type WarehouseMemberRole = "keeper" | "doc_admin";

export interface WarehouseMember {
  userid: string;
  role: WarehouseMemberRole;
  added_by_userid: string;
  created_at: string;
}

export interface DeviceCategory {
  id: number;
  name: string;
  /** 这个类别的设备自动编号用的开头（顶管机 DG）；没设是 null，用 SB */
  code_prefix: string | null;
  sort_order: number;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export type DeviceLocation = "warehouse" | "project" | "scrapped";

export interface Device {
  id: number;
  device_code: string;
  name: string;
  alias: string | null;
  category_id: number;
  machine_type: string | null;
  diameter_mm: number | null;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  spec: string | null;
  ownership: "owned" | "leased_in";
  purchased_date: string | null;
  location: DeviceLocation;
  current_project_id: number | null;
  storage_note: string | null;
  photo_key: string | null;
  remark: string | null;
  version: number;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceEvent {
  id: number;
  device_id: number;
  event_type: string;
  ref_type: string | null;
  ref_id: number | null;
  summary: string;
  photo_keys_json: string | null;
  operator_userid: string;
  occurred_at: string;
  created_at: string;
}

export type MaterialKind = "turnover" | "consumable";

export interface Material {
  id: number;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  kind: MaterialKind;
  quantity: number;
  unit_price: number | null;
  min_stock: number | null;
  storage_note: string | null;
  status: "active" | "disabled";
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export type WhDocType =
  | "opening"
  | "inbound"
  | "out"
  | "back"
  | "transfer"
  | "adjust"
  | "scrap"
  | "unscrap";

export interface WhDoc {
  id: number;
  doc_no: string;
  doc_type: WhDocType;
  project_id: number | null;
  to_project_id: number | null;
  project_kit_id: number | null;
  counterparty: string | null;
  handover_name: string | null;
  remark: string | null;
  photo_keys_json: string | null;
  stocktake_id: number | null;
  reverses_doc_id: number | null;
  operator_userid: string;
  occurred_at: string;
  client_request_id: string;
  created_at: string;
}

export type WhDocLineOutcome = "normal" | "returned" | "lost";

export interface WhDocLine {
  id: number;
  doc_id: number;
  device_id: number | null;
  material_id: number | null;
  quantity: number;
  outcome: WhDocLineOutcome;
  stock_delta: number;
  balance_after: number | null;
  project_id: number | null;
  project_delta: number;
  usage_meters: number | null;
  soil_type: string | null;
  note: string | null;
  created_at: string;
}

export type WhTaskKind = "inspection" | "maintenance" | "servicing" | "other";
export type WhTaskSource = "return" | "followup" | "manual";
export type WhTaskStatus = "todo" | "submitted" | "done" | "cancelled";

export interface WhTask {
  id: number;
  task_no: string;
  kind: WhTaskKind;
  source: WhTaskSource;
  device_id: number | null;
  title: string;
  description: string | null;
  systems_json: string | null;
  blocking: 0 | 1;
  required_photo_count: number;
  due_date: string | null;
  assignee_userid: string | null;
  created_by_userid: string;
  status: WhTaskStatus;
  result: "pass" | "fail" | null;
  result_note: string | null;
  review_note: string | null;
  supplement_round: number;
  parent_task_id: number | null;
  origin_doc_id: number | null;
  submitted_at: string | null;
  done_at: string | null;
  done_by_userid: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface WhTaskPhoto {
  id: number;
  task_id: number;
  file_key: string;
  uploaded_by_userid: string;
  created_at: string;
  deleted_at: string | null;
}

// ─── 配套清单（阶段 2）──────────

export type KitLineKind = "device" | "material" | "text";
export type KitLineSource = "warehouse" | "site_purchase" | "rental" | "on_site";
export type ProjectKitStatus = "draft" | "submitted" | "confirmed" | "closed";

/** 模板行的数量怎么算：固定、按总长、按最长一段、按段。 */
export type KitQtyBasis = "fixed" | "per_total_metre" | "per_longest_metre" | "per_section";
/** 生成时要特殊处理的行：主机（机头）、发电、住宿。 */
export type KitLineRole = "main_machine" | "power" | "lodging";

export interface KitTemplate {
  id: number;
  name: string;
  machine_type: string | null;
  /** 模板对应的管径（毫米），按参数生成时用来选模板和判断规格要不要重选。 */
  diameter_mm: number | null;
  remark: string | null;
  status: "active" | "disabled";
  version: number;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
}

export interface KitTemplateLine {
  id: number;
  template_id: number;
  section: string;
  sort_order: number;
  line_kind: KitLineKind;
  device_category_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  default_qty: number | null;
  note: string | null;
  qty_basis: KitQtyBasis;
  qty_factor: number | null;
  qty_extra: number | null;
  qty_per_set: 0 | 1;
  spec_by_diameter: 0 | 1;
  role: KitLineRole | null;
}

export interface ProjectKit {
  id: number;
  kit_no: string;
  project_id: number;
  title: string;
  template_id: number | null;
  copied_from_kit_id: number | null;
  status: ProjectKitStatus;
  remark: string | null;
  created_by_userid: string;
  submitted_by_userid: string | null;
  submitted_at: string | null;
  confirmed_by_userid: string | null;
  confirmed_at: string | null;
  closed_by_userid: string | null;
  closed_at: string | null;
  close_reason: string | null;
  /** 按项目参数生成时存的参数、来源和生成时的原样（JSON）。别的清单是空的。 */
  plan_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectKitLine {
  id: number;
  kit_id: number;
  section: string;
  sort_order: number;
  line_kind: KitLineKind;
  device_category_id: number | null;
  material_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  planned_qty: number;
  source: KitLineSource;
  note: string | null;
}

// ─── 资料库（阶段 4A） ──────────

export type DocCategory = "cert" | "report" | "params" | "manual" | "maintenance" | "other";
/** 镜像到微盘的进度。skipped：不镜像（比如文件太大），原因在 mirror_error 里 */
export type DocMirrorStatus = "pending" | "syncing" | "synced" | "failed" | "skipped";

export interface DocFile {
  id: number;
  title: string;
  file_name: string;
  file_key: string;
  file_size: number;
  content_type: string;
  doc_category: DocCategory;
  /** 归属：单台设备，或整个设备类别；都为空是通用资料 */
  device_id: number | null;
  device_category_id: number | null;
  valid_until: string | null;
  supersedes_id: number | null;
  uploaded_by_userid: string;
  deleted_at: string | null;
  deleted_by_userid: string | null;
  version: number;
  mirror_status: DocMirrorStatus;
  mirror_error: string | null;
  mirror_attempts: number;
  mirror_started_at: string | null;
  mirrored_at: string | null;
  /** 在微盘里的文件、名字、所在目录；不在微盘里时都是 null */
  wedrive_fileid: string | null;
  wedrive_name: string | null;
  wedrive_folder_key: string | null;
  created_at: string;
  updated_at: string;
}

/** 在微盘里建过的目录。folder_key：general、uncategorized、category:<id>、category-general:<id>、device:<id> */
export interface WedriveFolder {
  folder_key: string;
  fileid: string;
  name: string;
  parent_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocShare {
  id: number;
  token: string;
  doc_file_id: number;
  expires_at: string;
  created_by_userid: string;
  revoked_at: string | null;
  access_count: number;
  created_at: string;
}

// ─── 盘点（阶段 5） ──────────

export type StocktakeScope = "material" | "device" | "all";
export type StocktakeStatus = "counting" | "done" | "cancelled";

export interface Stocktake {
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
  /** 每次改这次盘点或它的行都加一；完成时核对 */
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StocktakeMaterialLine {
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
}

export interface StocktakeDeviceLine {
  id: number;
  stocktake_id: number;
  device_id: number;
  /** 1：发起时账上在库；0：盘的时候扫到的、账上不在库的 */
  expected: 0 | 1;
  /** null：还没看；1：找到；0：没找到 */
  found: 0 | 1 | null;
  note: string | null;
  scanned_by_userid: string | null;
  scanned_at: string | null;
  created_at: string;
  updated_at: string;
}
