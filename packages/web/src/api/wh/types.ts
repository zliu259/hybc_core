/** 新库房接口的类型，字段与后端 packages/api/src/types/wh.ts 和各 service 的返回一致。 */

export type DeviceState =
  | "scrapped"
  | "on_project"
  | "repairing"
  | "pending_inspection"
  | "blocked"
  | "available";
export type MaterialKind = "turnover" | "consumable";
export type WhDocType =
  | "opening"
  | "inbound"
  | "out"
  | "back"
  | "transfer"
  | "adjust"
  | "scrap"
  | "unscrap";
export type TaskKind = "inspection" | "maintenance" | "servicing" | "other";
export type TaskStatus = "todo" | "submitted" | "done" | "cancelled";
export type TaskSystem = "hydraulic" | "electric" | "drive" | "other";

export interface ApiResult<T> {
  success: boolean;
  data: T;
}
export interface PagedResult<T> extends ApiResult<T[]> {
  pagination: { page: number; pageSize: number; total: number };
}

export interface WarehouseCapabilities {
  is_keeper: boolean;
  is_doc_admin: boolean;
  can_scrap: boolean;
  can_unscrap: boolean;
  can_manage_settings: boolean;
  can_create_kit: boolean;
}
export interface WarehouseSettings {
  default_inspector_userid: string | null;
  return_inspection_photo_count: number;
}
export interface WarehouseMember {
  userid: string;
  role: "keeper" | "doc_admin";
  added_by_userid: string;
  created_at: string;
}
export interface DeviceCategory {
  id: number;
  name: string;
  sort_order: number;
  status: "active" | "disabled";
}

export interface DeviceRow {
  id: number;
  device_code: string;
  name: string;
  alias: string | null;
  category_id: number;
  category_name: string;
  machine_type: string | null;
  diameter_mm: number | null;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  spec: string | null;
  ownership: "owned" | "leased_in";
  purchased_date: string | null;
  location: "warehouse" | "project" | "scrapped";
  current_project_id: number | null;
  project_name: string | null;
  storage_note: string | null;
  photo_key: string | null;
  remark: string | null;
  version: number;
  state: DeviceState;
  state_label: string;
}
export interface DeviceEvent {
  id: number;
  device_id: number;
  event_type: string;
  summary: string;
  operator_userid: string;
  occurred_at: string;
}
export interface DeviceUsageRecord {
  doc_no: string;
  project_name: string;
  returned_at: string;
  usage_meters: number | null;
  soil_type: string | null;
}
export interface DeviceDetail extends DeviceRow {
  open_tasks: {
    id: number;
    task_no: string;
    kind: TaskKind;
    status: TaskStatus;
    title: string;
    blocking: 0 | 1;
  }[];
  events: DeviceEvent[];
  usage_records: DeviceUsageRecord[];
  usage_meters_total: number;
}

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
}

export interface WhDocRow {
  id: number;
  doc_no: string;
  doc_type: WhDocType;
  project_id: number | null;
  project_name: string | null;
  to_project_id: number | null;
  to_project_name: string | null;
  counterparty: string | null;
  handover_name: string | null;
  remark: string | null;
  photo_keys_json: string | null;
  reverses_doc_id: number | null;
  reversed_by_doc_no: string | null;
  operator_userid: string;
  occurred_at: string;
  line_count: number;
}
export interface WhDocLineRow {
  id: number;
  device_id: number | null;
  device_code: string | null;
  device_name: string | null;
  material_id: number | null;
  material_name: string | null;
  material_spec: string | null;
  unit: string | null;
  quantity: number;
  outcome: "normal" | "returned" | "lost";
  stock_delta: number;
  balance_after: number | null;
  project_delta: number;
  usage_meters: number | null;
  soil_type: string | null;
  note: string | null;
}
export interface LedgerRow extends WhDocLineRow {
  doc_no: string;
  doc_type: WhDocType;
  occurred_at: string;
  operator_userid: string;
  project_name: string | null;
}
export interface WhDocResult {
  id: number;
  doc_no: string;
  replayed: boolean;
  created_task_ids: number[];
}
export interface CreateWhDocInput {
  doc_type: "inbound" | "out" | "back" | "transfer";
  client_request_id: string;
  project_id?: number;
  to_project_id?: number;
  counterparty?: string;
  handover_name?: string;
  remark?: string;
  photo_keys?: string[];
  device_lines?: {
    device_id: number;
    usage_meters?: number;
    soil_type?: string;
  }[];
  material_lines?: {
    material_id: number;
    quantity: number;
    outcome?: "returned" | "lost";
  }[];
}
export interface MaterialHolding {
  material_id: number;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  holding: number;
}
export interface ProjectHoldings {
  devices: DeviceRow[];
  materials: MaterialHolding[];
}

export interface TaskRow {
  id: number;
  task_no: string;
  kind: TaskKind;
  source: "return" | "followup" | "manual";
  device_id: number | null;
  device_code: string | null;
  device_name: string | null;
  title: string;
  description: string | null;
  systems_json: string | null;
  blocking: 0 | 1;
  required_photo_count: number;
  due_date: string | null;
  assignee_userid: string | null;
  status: TaskStatus;
  result: "pass" | "fail" | null;
  result_note: string | null;
  review_note: string | null;
  supplement_round: number;
  parent_task_id: number | null;
  done_at: string | null;
  cancel_reason: string | null;
  version: number;
  photo_count: number;
  created_at: string;
}
export interface TaskPhoto {
  id: number;
  task_id: number;
  file_key: string;
  uploaded_by_userid: string;
}
export interface TaskDetail extends TaskRow {
  photos: TaskPhoto[];
}

export interface WarehouseOverview {
  tasks_to_confirm: number;
  tasks_unassigned: number;
  tasks_overdue: number;
  devices_pending_inspection: number;
  devices_repairing: number;
  devices_on_project: number;
  low_stock_count: number;
  recent_docs: WhDocRow[];
}

export interface ImportRowError {
  row: number;
  message: string;
}
export interface ImportResult {
  created: number;
  errors: ImportRowError[];
  opening_doc_no: string | null;
}
export interface DeviceImportRow {
  device_code: string;
  name: string;
  alias: string;
  category_name: string;
  machine_type: string;
  diameter_mm: number | null;
  manufacturer: string;
  model: string;
  serial_no: string;
  spec: string;
  project_name: string;
  storage_note: string;
  remark: string;
}
export interface MaterialImportRow {
  name: string;
  spec: string;
  unit: string;
  category: string;
  kind: MaterialKind;
  opening_quantity: number | null;
  unit_price: number | null;
  min_stock: number | null;
  storage_note: string;
  remark: string;
}
