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
  "pending_approval",
  "approved",
  "in_progress",
  "completed",
  "cancelled"
] as const;

export type WarehouseAssetWorkOrderStatus = (typeof warehouseAssetWorkOrderStatuses)[number];

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
  scheduled_date?: string;
  remark?: string;
}

export interface UpdateWarehouseAssetWorkOrderRequest {
  assignee_userid?: string | null;
  blocking_flag?: number;
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
