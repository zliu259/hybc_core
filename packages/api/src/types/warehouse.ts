import type { InstanceConfig } from "./approval";

export interface Warehouse {
  id: number;
  warehouse_code: string;
  warehouse_name: string;
  location: string | null;
  manager_userid: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryRow {
  id: number;
  warehouse_id: number;
  asset_type_id: number;
  quantity: number;
  min_stock: number | null;
  status: string;
  updated_at: string;
}

export interface StockOrder {
  id: number;
  order_no: string;
  order_type: string;
  project_id: number | null;
  from_warehouse_id: number | null;
  to_warehouse_id: number | null;
  applicant_userid: string;
  status: string;
  approval_instance_id: number | null;
  rental_term_id: number | null;
  executed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockOrderItem {
  id: number;
  stock_order_id: number;
  asset_type_id: number | null;
  tracked_asset_id: number | null;
  quantity: number;
  unit: string | null;
  remark: string | null;
  status: string;
  created_at: string;
}

export interface ProjectEquipmentPlan {
  id: number;
  plan_no: string;
  project_id: number;
  applicant_userid: string;
  plan_status: string;
  ai_status: string;
  ai_task_id: number | null;
  recommendation_result_json: string | null;
  stock_order_id: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectEquipmentPlanItem {
  id: number;
  plan_id: number;
  asset_type_id: number;
  planned_qty: number;
  recommended_qty: number | null;
  source: string | null;
  note: string | null;
  created_at: string;
}

export interface CreateWarehouseRequest {
  warehouse_code: string;
  warehouse_name: string;
  location?: string;
  manager_userid?: string;
  remark?: string;
}

export interface UpdateWarehouseRequest {
  warehouse_name?: string;
  location?: string;
  manager_userid?: string;
  status?: string;
  remark?: string;
}

export interface CreateStockOrderRequest {
  order_type: "inbound" | "outbound" | "transfer";
  project_id?: number;
  from_warehouse_id?: number;
  to_warehouse_id?: number;
  rental_term_id?: number;
  remark?: string;
  items: {
    asset_type_id?: number;
    tracked_asset_id?: number;
    quantity: number;
    unit?: string;
    remark?: string;
  }[];
}

export interface SubmitStockOrderApprovalRequest {
  biz_summary?: string;
  instance_config?: InstanceConfig;
}

export interface CreateEquipmentPlanRequest {
  project_id: number;
  remark?: string;
  items: {
    asset_type_id: number;
    planned_qty: number;
    note?: string;
  }[];
}

export interface ConfirmEquipmentPlanRequest {
  from_warehouse_id: number;
  note?: string;
}

export interface StocktakeTask {
  id: number;
  task_no: string;
  task_title: string;
  scope: "company" | "warehouse";
  warehouse_id: number | null;
  planned_date: string;
  status: "draft" | "counting" | "completed";
  creator_userid: string;
  completed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface StocktakeLine {
  id: number;
  stocktake_task_id: number;
  warehouse_id: number;
  item_kind: "asset" | "consumable";
  asset_type_id: number | null;
  tracked_asset_id: number | null;
  item_name: string;
  unit: string | null;
  expected_qty: number;
  counted_qty: number | null;
  diff_qty: number;
  line_status: "normal" | "new" | "damaged" | "lost";
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStocktakeTaskRequest {
  task_title: string;
  scope: "company" | "warehouse";
  warehouse_id?: number;
  planned_date: string;
  remark?: string;
}

export interface AddStocktakeLineRequest {
  warehouse_id: number;
  item_kind: "asset" | "consumable";
  asset_type_id?: number;
  tracked_asset_id?: number;
  item_name?: string;
  unit?: string;
  counted_qty: number;
  line_status?: "normal" | "new" | "damaged" | "lost";
  note?: string;
}

export interface UpdateStocktakeLineRequest {
  counted_qty?: number;
  line_status?: "normal" | "new" | "damaged" | "lost";
  note?: string;
}
