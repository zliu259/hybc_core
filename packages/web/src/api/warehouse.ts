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
  executed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
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
    data: StockOrder & { items: Array<Record<string, unknown>> };
  }>("get", `/api/v1/warehouse/stock-order/${id}`);

export const createStockOrder = (data: {
  order_type: "inbound" | "outbound" | "transfer";
  project_id?: number;
  from_warehouse_id?: number;
  to_warehouse_id?: number;
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
