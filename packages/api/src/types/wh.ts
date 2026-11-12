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

export interface KitTemplate {
  id: number;
  name: string;
  machine_type: string | null;
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
