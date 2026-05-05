import { http } from "@/utils/http";

export type Warehouse = {
  id: number;
  warehouse_code: string;
  warehouse_name: string;
  location: string | null;
  manager_userid: string | null;
  status: string;
  remark: string | null;
};

export type InventoryRow = {
  id: number;
  warehouse_id: number;
  asset_type_id: number;
  quantity: number;
  min_stock: number | null;
  status: string;
  updated_at: string;
  warehouse_name?: string;
  type_code?: string;
  type_name?: string;
  unit?: string;
  threshold?: number;
};

export type StockOrderItemInput = {
  asset_type_id?: number;
  tracked_asset_id?: number;
  configuration_role?:
    | "whole_machine"
    | "shell"
    | "core"
    | "console"
    | "generic";
  configuration_group_key?: string;
  requires_modification?: number;
  quantity: number;
  unit?: string;
  remark?: string;
};

export type StockOrder = {
  id: number;
  order_no: string;
  order_type: "inbound" | "outbound" | "transfer";
  project_id: number | null;
  from_warehouse_id: number | null;
  to_warehouse_id: number | null;
  applicant_userid: string;
  status: string;
  approval_instance_id: number | null;
  rental_term_id: number | null;
  override_status: "none" | "requested" | "approved" | "rejected";
  override_reason: string | null;
  override_approver_userid: string | null;
  override_risk_acknowledged: number;
  executed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type StockOrderItem = {
  id: number;
  stock_order_id: number;
  asset_type_id: number | null;
  tracked_asset_id: number | null;
  configuration_role:
    | "whole_machine"
    | "shell"
    | "core"
    | "console"
    | "generic"
    | null;
  configuration_group_key: string | null;
  requires_modification: number;
  quantity: number;
  unit: string | null;
  remark: string | null;
  status: string;
  created_at: string;
};

export type WarehouseAssetWorkOrder = {
  id: number;
  work_order_no: string;
  work_order_type:
    | "inspection"
    | "maintenance"
    | "servicing"
    | "modification"
    | "scrapping";
  tracked_asset_id: number | null;
  tracked_asset_configuration_id: number | null;
  stock_order_id: number | null;
  project_id: number | null;
  warehouse_id: number | null;
  applicant_userid: string;
  assignee_userid: string | null;
  blocking_flag: number;
  status:
    | "draft"
    | "pending_assignment"
    | "assigned"
    | "pending_approval"
    | "approved"
    | "in_progress"
    | "submitted"
    | "completed"
    | "rejected"
    | "cancelled";
  approval_instance_id: number | null;
  source:
    | "manual"
    | "return_receipt"
    | "stock_order"
    | "stocktake"
    | "ai_schedule";
  priority: "low" | "normal" | "high" | "urgent";
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
};

export type WarehouseTaskEvidence = {
  id: number;
  work_order_id: number;
  step_id: number | null;
  tracked_asset_id: number | null;
  evidence_type: "photo" | "video" | "voice" | "brief" | "document";
  file_key: string | null;
  file_name: string | null;
  summary: string | null;
  operator_userid: string;
  captured_at: string;
  created_at: string;
};

export type WarehouseTaskPackage = {
  id: number;
  package_no: string;
  package_title: string;
  package_type: string;
  warehouse_id: number | null;
  project_id: number | null;
  priority: WarehouseAssetWorkOrder["priority"];
  status: "open" | "in_progress" | "completed" | "exception";
  assignee_userid: string | null;
  assigned_by_userid: string | null;
  planned_start_date: string | null;
  due_date: string | null;
  source: WarehouseAssetWorkOrder["source"];
  source_biz_type: string | null;
  source_biz_id: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type WarehouseTaskWorkloadSummary = {
  assignee_userid: string | null;
  open_count: number;
  urgent_count: number;
  submitted_count: number;
};

export type EquipmentPlan = {
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
};

export type StocktakeTask = {
  id: number;
  task_no: string;
  task_title: string;
  scope: "company" | "warehouse";
  warehouse_id: number | null;
  warehouse_name?: string | null;
  planned_date: string;
  status: "draft" | "counting" | "completed";
  creator_userid: string;
  completed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type StocktakeLine = {
  id: number;
  stocktake_task_id: number;
  warehouse_id: number;
  warehouse_name?: string | null;
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
};

export const listWarehouses = (params?: { keyword?: string }) =>
  http.request<{ success: boolean; data: Warehouse[] }>(
    "get",
    "/api/v1/warehouse",
    { params }
  );

export const createWarehouse = (data: {
  warehouse_code: string;
  warehouse_name: string;
  location?: string;
  manager_userid?: string;
  remark?: string;
}) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/warehouse",
    { data }
  );

export const updateWarehouse = (
  id: number,
  data: {
    warehouse_name?: string;
    location?: string;
    manager_userid?: string;
    status?: string;
    remark?: string;
  }
) =>
  http.request<{ success: boolean }>("put", `/api/v1/warehouse/${id}`, {
    data
  });

export const deleteWarehouse = (id: number) =>
  http.request<{ success: boolean }>("delete", `/api/v1/warehouse/${id}`);

export const listInventory = (params?: {
  warehouse_id?: number;
  asset_type_id?: number;
}) =>
  http.request<{ success: boolean; data: InventoryRow[] }>(
    "get",
    "/api/v1/warehouse/inventory",
    { params }
  );

export const listInventoryAlerts = () =>
  http.request<{ success: boolean; data: InventoryRow[] }>(
    "get",
    "/api/v1/warehouse/inventory/alert"
  );

export const analyzeInventoryAlert = (inventoryId: number) =>
  http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/warehouse/inventory/alert/${inventoryId}/analyze`
  );

export const listConsumptions = (params?: { project_id?: number }) =>
  http.request<{ success: boolean; data: Array<Record<string, unknown>> }>(
    "get",
    "/api/v1/warehouse/consumption",
    { params }
  );

export const createConsumption = (data: {
  warehouse_id: number;
  project_id?: number;
  asset_type_id: number;
  quantity: number;
  consumed_date: string;
  remark?: string;
}) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/warehouse/consumption",
    {
      data
    }
  );

export const listStockOrders = (params?: {
  status?: string;
  order_type?: string;
}) =>
  http.request<{ success: boolean; data: StockOrder[] }>(
    "get",
    "/api/v1/warehouse/stock-order",
    {
      params
    }
  );

export const getStockOrder = (id: number) =>
  http.request<{
    success: boolean;
    data: StockOrder & { items: StockOrderItem[] };
  }>("get", `/api/v1/warehouse/stock-order/${id}`);

export const createStockOrder = (data: {
  order_type: "inbound" | "outbound" | "transfer";
  project_id?: number;
  from_warehouse_id?: number;
  to_warehouse_id?: number;
  rental_term_id?: number;
  override_status?: "none" | "requested" | "approved";
  override_reason?: string;
  override_risk_acknowledged?: number;
  remark?: string;
  items: StockOrderItemInput[];
}) =>
  http.request<{ success: boolean; data: { id: number; order_no: string } }>(
    "post",
    "/api/v1/warehouse/stock-order",
    { data }
  );

export const submitStockOrderApproval = (
  id: number,
  data?: { biz_summary?: string }
) =>
  http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/warehouse/stock-order/${id}/submit-approval`, { data });

export const executeStockOrder = (id: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/stock-order/${id}/execute`
  );

export const cancelStockOrder = (id: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/stock-order/${id}/cancel`
  );

export const listEquipmentPlans = (params?: { project_id?: number }) =>
  http.request<{ success: boolean; data: EquipmentPlan[] }>(
    "get",
    "/api/v1/warehouse/equipment-plan",
    {
      params
    }
  );

export const getEquipmentPlan = (id: number) =>
  http.request<{
    success: boolean;
    data: EquipmentPlan & { items: Array<Record<string, unknown>> };
  }>("get", `/api/v1/warehouse/equipment-plan/${id}`);

export const createEquipmentPlan = (data: {
  project_id: number;
  remark?: string;
  items: { asset_type_id: number; planned_qty: number; note?: string }[];
}) =>
  http.request<{ success: boolean; data: { id: number; plan_no: string } }>(
    "post",
    "/api/v1/warehouse/equipment-plan",
    { data }
  );

export const triggerEquipmentRecommend = (id: number) =>
  http.request<{
    success: boolean;
    data: { task_id: number; ai_status: string };
  }>("post", `/api/v1/warehouse/equipment-plan/${id}/trigger-recommend`);

export const getEquipmentRecommendation = (id: number) =>
  http.request<{
    success: boolean;
    data: {
      status: string;
      task_id: number | null;
      result: Record<string, unknown> | null;
    };
  }>("get", `/api/v1/warehouse/equipment-plan/${id}/recommendation`);

export const confirmEquipmentPlan = (
  id: number,
  data: { from_warehouse_id: number; note?: string }
) =>
  http.request<{
    success: boolean;
    data: { stock_order_id: number; order_no: string };
  }>("post", `/api/v1/warehouse/equipment-plan/${id}/confirm`, { data });

export const listStocktakeTasks = (params?: {
  status?: string;
  warehouse_id?: number;
}) =>
  http.request<{ success: boolean; data: StocktakeTask[] }>(
    "get",
    "/api/v1/warehouse/stocktake",
    {
      params
    }
  );

export const getStocktakeTask = (id: number) =>
  http.request<{
    success: boolean;
    data: StocktakeTask & { lines: StocktakeLine[] };
  }>("get", `/api/v1/warehouse/stocktake/${id}`);

export const createStocktakeTask = (data: {
  task_title: string;
  scope: "company" | "warehouse";
  warehouse_id?: number;
  planned_date: string;
  remark?: string;
}) =>
  http.request<{ success: boolean; data: { id: number; task_no: string } }>(
    "post",
    "/api/v1/warehouse/stocktake",
    { data }
  );

export const addStocktakeLine = (
  id: number,
  data: {
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
) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/warehouse/stocktake/${id}/line`,
    { data }
  );

export const updateStocktakeLine = (
  id: number,
  lineId: number,
  data: {
    counted_qty?: number | null;
    line_status?: "normal" | "new" | "damaged" | "lost";
    note?: string;
  }
) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/warehouse/stocktake/${id}/line/${lineId}`,
    {
      data
    }
  );

export const completeStocktakeTask = (id: number) =>
  http.request<{
    success: boolean;
    data: {
      status: "completed";
      completed_at: string;
      total: number;
      diff_count: number;
      diff_total: number;
    };
  }>("post", `/api/v1/warehouse/stocktake/${id}/complete`);

export const listWarehouseAssetWorkOrders = (params?: {
  status?: WarehouseAssetWorkOrder["status"];
  work_order_type?: WarehouseAssetWorkOrder["work_order_type"];
  tracked_asset_id?: number;
  project_id?: number;
  warehouse_id?: number;
  blocking_flag?: 0 | 1;
  source?: WarehouseAssetWorkOrder["source"];
  assignee_userid?: string;
}) =>
  http.request<{ success: boolean; data: WarehouseAssetWorkOrder[] }>(
    "get",
    "/api/v1/warehouse/work-order",
    { params }
  );

export const getWarehouseAssetWorkOrder = (id: number) =>
  http.request<{ success: boolean; data: WarehouseAssetWorkOrder }>(
    "get",
    `/api/v1/warehouse/work-order/${id}`
  );

export const listWarehouseTaskPackages = (params?: {
  status?: WarehouseTaskPackage["status"];
  assignee_userid?: string;
  warehouse_id?: number;
}) =>
  http.request<{ success: boolean; data: WarehouseTaskPackage[] }>(
    "get",
    "/api/v1/warehouse/work-order/package",
    { params }
  );

export const createWarehouseTaskPackage = (data: {
  package_title: string;
  package_type?: string;
  warehouse_id?: number | null;
  project_id?: number | null;
  priority?: WarehouseAssetWorkOrder["priority"];
  assignee_userid?: string | null;
  planned_start_date?: string | null;
  due_date?: string | null;
  source?: WarehouseAssetWorkOrder["source"];
  source_biz_type?: string | null;
  source_biz_id?: number | null;
  remark?: string | null;
}) =>
  http.request<{ success: boolean; data: { id: number; package_no: string } }>(
    "post",
    "/api/v1/warehouse/work-order/package",
    { data }
  );

export const listWarehouseTaskWorkload = (params?: {
  warehouse_id?: number;
  project_id?: number;
  source?: WarehouseAssetWorkOrder["source"];
  assignee_userid?: string;
}) =>
  http.request<{ success: boolean; data: WarehouseTaskWorkloadSummary[] }>(
    "get",
    "/api/v1/warehouse/work-order/workload",
    { params }
  );

export const assignWarehouseTaskPackageTasks = (
  id: number,
  data: {
    task_ids: number[];
    assignee_userid?: string | null;
    scheduled_date?: string | null;
    manual_version_id?: number | null;
  }
) =>
  http.request<{ success: boolean; data: { updated: number } }>(
    "post",
    `/api/v1/warehouse/work-order/package/${id}/assign-tasks`,
    { data }
  );

export const getWarehouseMobileTaskConfig = () =>
  http.request<{
    success: boolean;
    data: {
      contract_version: number;
      visible_statuses: WarehouseAssetWorkOrder["status"][];
      evidence_types: WarehouseTaskEvidence["evidence_type"][];
      actions: string[];
      min_photo_count_source: string;
      manual_source: string;
    };
  }>("get", "/api/v1/warehouse/work-order/mobile/config");

export const listMyMobileWarehouseTasks = () =>
  http.request<{ success: boolean; data: WarehouseAssetWorkOrder[] }>(
    "get",
    "/api/v1/warehouse/work-order/mobile/my-tasks"
  );

export const getMobileWarehouseTask = (id: number) =>
  http.request<{
    success: boolean;
    data: WarehouseAssetWorkOrder & {
      manual_title: string | null;
      manual_version_no: number | null;
      manual_content: Record<string, unknown> | null;
      steps: Array<Record<string, unknown>>;
      evidence: WarehouseTaskEvidence[];
    };
  }>("get", `/api/v1/warehouse/work-order/mobile/task/${id}`);

export const startMobileWarehouseTask = (id: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/mobile/task/${id}/start`
  );

export const submitMobileWarehouseTask = (
  id: number,
  data?: {
    result_summary?: string | null;
    completion_summary_json?: string | null;
    evidence?: {
      step_id?: number | null;
      tracked_asset_id?: number | null;
      evidence_type: WarehouseTaskEvidence["evidence_type"];
      file_key?: string | null;
      file_name?: string | null;
      summary?: string | null;
      captured_at?: string | null;
    }[];
  }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/mobile/task/${id}/submit`,
    { data }
  );

export const listWarehouseTaskEvidence = (id: number) =>
  http.request<{ success: boolean; data: WarehouseTaskEvidence[] }>(
    "get",
    `/api/v1/warehouse/work-order/${id}/evidence`
  );

export const getWarehouseTaskEvidenceAccess = (evidenceId: number) =>
  http.request<{
    success: boolean;
    data: {
      evidence_id: number;
      work_order_id: number;
      work_order_no: string;
      file_key: string;
      file_name: string | null;
      evidence_type: WarehouseTaskEvidence["evidence_type"];
      expires_at: string;
      url: string;
    };
  }>("get", `/api/v1/warehouse/work-order/evidence/${evidenceId}/access`);

export const createWarehouseAssetWorkOrder = (data: {
  work_order_type: WarehouseAssetWorkOrder["work_order_type"];
  tracked_asset_id?: number;
  tracked_asset_configuration_id?: number;
  stock_order_id?: number;
  project_id?: number;
  warehouse_id?: number;
  assignee_userid?: string;
  blocking_flag?: number;
  source?: WarehouseAssetWorkOrder["source"];
  priority?: WarehouseAssetWorkOrder["priority"];
  package_id?: number;
  manual_version_id?: number;
  mobile_enabled?: number;
  required_photo_count?: number;
  scheduled_date?: string;
  remark?: string;
}) =>
  http.request<{
    success: boolean;
    data: { id: number; work_order_no: string };
  }>("post", "/api/v1/warehouse/work-order", { data });

export const updateWarehouseAssetWorkOrder = (
  id: number,
  data: {
    assignee_userid?: string | null;
    blocking_flag?: number;
    priority?: WarehouseAssetWorkOrder["priority"];
    package_id?: number | null;
    manual_version_id?: number | null;
    mobile_enabled?: number;
    required_photo_count?: number;
    scheduled_date?: string | null;
    result_summary?: string | null;
    remark?: string | null;
  }
) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/warehouse/work-order/${id}`,
    {
      data
    }
  );

export const assignWarehouseAssetWorkOrder = (
  id: number,
  data: {
    assignee_userid: string;
    package_id?: number | null;
    scheduled_date?: string | null;
    manual_version_id?: number | null;
  }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/assign`,
    { data }
  );

export const submitWarehouseAssetWorkOrderApproval = (
  id: number,
  data?: { biz_summary?: string }
) =>
  http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/warehouse/work-order/${id}/submit-approval`, { data });

export const startWarehouseAssetWorkOrder = (id: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/start`
  );

export const completeWarehouseAssetWorkOrder = (
  id: number,
  data?: { result_summary?: string }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/complete`,
    {
      data
    }
  );

export const submitWarehouseAssetWorkOrder = (
  id: number,
  data?: {
    result_summary?: string | null;
    completion_summary_json?: string | null;
    evidence?: {
      step_id?: number | null;
      tracked_asset_id?: number | null;
      evidence_type: "photo" | "video" | "voice" | "brief" | "document";
      file_key?: string | null;
      file_name?: string | null;
      summary?: string | null;
      captured_at?: string | null;
    }[];
  }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/submit`,
    { data }
  );

export const reviewWarehouseAssetWorkOrder = (
  id: number,
  data: { action: "approve" | "reject"; result_summary?: string | null }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/review`,
    { data }
  );

export const cancelWarehouseAssetWorkOrder = (id: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/work-order/${id}/cancel`
  );
