export const warehouseAssetWorkOrderTypes = [
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "scrapping"
] as const;

export type WarehouseAssetWorkOrderType = (typeof warehouseAssetWorkOrderTypes)[number];

export const warehouseAssetWorkOrderStatuses = [
  "draft",
  "pending_assignment",
  "assigned",
  "pending_approval",
  "approved",
  "in_progress",
  "submitted",
  "completed",
  "rejected",
  "cancelled"
] as const;

export type WarehouseAssetWorkOrderStatus = (typeof warehouseAssetWorkOrderStatuses)[number];

export const warehouseTaskPriorities = ["low", "normal", "high", "urgent"] as const;

export type WarehouseTaskPriority = (typeof warehouseTaskPriorities)[number];

export const warehouseTaskSources = [
  "manual",
  "return_receipt",
  "stock_order",
  "stocktake",
  "ai_schedule"
] as const;

export type WarehouseTaskSource = (typeof warehouseTaskSources)[number];

export interface WarehouseAssetWorkOrder {
  id: number;
  work_order_no: string;
  work_order_type: WarehouseAssetWorkOrderType;
  tracked_asset_id: number | null;
  tracked_asset_configuration_id: number | null;
  stock_order_id: number | null;
  project_id: number | null;
  warehouse_id: number | null;
  applicant_userid: string;
  assignee_userid: string | null;
  blocking_flag: number;
  status: WarehouseAssetWorkOrderStatus;
  approval_instance_id: number | null;
  source: WarehouseTaskSource;
  priority: WarehouseTaskPriority;
  package_id: number | null;
  assigned_by_userid: string | null;
  reviewer_userid: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  manual_version_id: number | null;
  mobile_enabled: number;
  required_photo_count: number;
  completion_summary_json: string | null;
  scheduled_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWarehouseAssetWorkOrderRequest {
  work_order_type: WarehouseAssetWorkOrderType;
  tracked_asset_id?: number;
  tracked_asset_configuration_id?: number;
  stock_order_id?: number;
  project_id?: number;
  warehouse_id?: number;
  assignee_userid?: string;
  blocking_flag?: number;
  source?: WarehouseTaskSource;
  priority?: WarehouseTaskPriority;
  package_id?: number;
  manual_version_id?: number;
  mobile_enabled?: number;
  required_photo_count?: number;
  scheduled_date?: string;
  remark?: string;
}

export interface UpdateWarehouseAssetWorkOrderRequest {
  assignee_userid?: string | null;
  blocking_flag?: number;
  priority?: WarehouseTaskPriority;
  package_id?: number | null;
  manual_version_id?: number | null;
  mobile_enabled?: number;
  required_photo_count?: number;
  scheduled_date?: string | null;
  result_summary?: string | null;
  remark?: string | null;
}

export interface SubmitWarehouseAssetWorkOrderApprovalRequest {
  biz_summary?: string;
}

export interface CompleteWarehouseAssetWorkOrderRequest {
  result_summary?: string;
}

export interface WarehouseTaskPackage {
  id: number;
  package_no: string;
  package_title: string;
  package_type: string;
  warehouse_id: number | null;
  project_id: number | null;
  priority: WarehouseTaskPriority;
  status: "open" | "in_progress" | "completed" | "exception";
  assignee_userid: string | null;
  assigned_by_userid: string | null;
  planned_start_date: string | null;
  due_date: string | null;
  source: WarehouseTaskSource;
  source_biz_type: string | null;
  source_biz_id: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarehouseTaskEvidenceInput {
  step_id?: number | null;
  tracked_asset_id?: number | null;
  evidence_type: "photo" | "video" | "voice" | "brief" | "document";
  file_key?: string | null;
  file_name?: string | null;
  summary?: string | null;
  captured_at?: string | null;
}
