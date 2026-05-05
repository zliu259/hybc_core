import { http } from "@/utils/http";
import type {
  WarehouseAssetWorkOrder,
  WarehouseTaskEvidence
} from "@/api/warehouse";

export type AssetType = {
  id: number;
  type_code: string;
  type_name: string;
  tracked_flag: number;
  unit: string;
  property_schema: string | null;
  min_stock: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type TrackedAsset = {
  id: number;
  asset_code: string;
  asset_type_id: number;
  asset_name: string;
  brand: string | null;
  model: string | null;
  serial_no: string | null;
  status: string;
  current_project_id: number | null;
  current_warehouse_id: number | null;
  current_location: string | null;
  properties_json: string | null;
  purchased_date: string | null;
  ownership_type: "owned" | "leased_in";
  created_at: string;
  updated_at: string;
};

export type TrackedAssetConfiguration = {
  id: number;
  configuration_code: string;
  whole_machine_code: string | null;
  shell_asset_id: number | null;
  core_asset_id: number | null;
  console_asset_id: number | null;
  status: "planned" | "assembling" | "active" | "disassembling" | "closed";
  project_id: number | null;
  warehouse_id: number | null;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DispatchBoardState =
  | "available_now"
  | "available_after_modification"
  | "blocked"
  | "reserved"
  | "in_transit"
  | "on_project"
  | "scrapped";

export type DispatchBoardItem = {
  id: number;
  asset_code: string;
  asset_name: string;
  asset_type_id: number;
  asset_type_code: string | null;
  asset_type_name: string | null;
  status: string;
  current_project_id: number | null;
  current_warehouse_id: number | null;
  current_location: string | null;
  dispatch_state: DispatchBoardState;
  reasons: string[];
  configurations: Array<{
    id: number;
    configuration_code: string;
    whole_machine_code: string | null;
    status: TrackedAssetConfiguration["status"];
  }>;
  blocking_work_orders: Array<{ work_order_no: string; status: string }>;
  reservations: Array<{
    order_no: string;
    status: string;
    requires_modification: number;
  }>;
};

export type DispatchBoardResponse = {
  summary: Record<DispatchBoardState, number>;
  by_type: Array<{
    asset_type_id: number;
    type_code: string | null;
    type_name: string | null;
    count: number;
  }>;
  by_warehouse: Array<{
    warehouse_id: number;
    count: number;
  }>;
  items: DispatchBoardItem[];
};

export type AssetRentalTerm = {
  id: number;
  rental_no: string;
  tracked_asset_id: number;
  rental_mode: "lease_in" | "lease_out";
  project_id: number | null;
  contract_id: number | null;
  finance_mode: "contract" | "on_account";
  start_date: string;
  due_date: string;
  returned_date: string | null;
  status: "active" | "overdue" | "returned" | "closed";
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  overdue_days?: number;
};

type Pagination = { page: number; pageSize: number; total: number };

export const listAssetTypes = (params?: {
  keyword?: string;
  tracked_flag?: number;
}) =>
  http.request<{ success: boolean; data: AssetType[] }>(
    "get",
    "/api/v1/asset/type",
    { params }
  );

export const createAssetType = (data: {
  type_code: string;
  type_name: string;
  tracked_flag?: number;
  unit?: string;
  property_schema?: string;
  min_stock?: number;
}) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/asset/type",
    { data }
  );

export const updateAssetType = (
  id: number,
  data: {
    type_name?: string;
    tracked_flag?: number;
    unit?: string;
    property_schema?: string;
    min_stock?: number;
    status?: string;
  }
) =>
  http.request<{ success: boolean }>("put", `/api/v1/asset/type/${id}`, {
    data
  });

export const deleteAssetType = (id: number) =>
  http.request<{ success: boolean }>("delete", `/api/v1/asset/type/${id}`);

export const listTrackedAssets = (params?: {
  asset_type_id?: number;
  status?: string;
  project_id?: number;
  warehouse_id?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
  ownership_type?: "owned" | "leased_in";
}) =>
  http.request<{
    success: boolean;
    data: TrackedAsset[];
    pagination: Pagination;
  }>("get", "/api/v1/asset", {
    params
  });

export const createTrackedAsset = (data: {
  asset_type_id: number;
  asset_name: string;
  brand?: string;
  model?: string;
  serial_no?: string;
  current_project_id?: number;
  current_warehouse_id?: number;
  current_location?: string;
  properties_json?: string;
  purchased_date?: string;
  ownership_type?: "owned" | "leased_in";
}) =>
  http.request<{ success: boolean; data: { id: number; asset_code: string } }>(
    "post",
    "/api/v1/asset",
    { data }
  );

export const getTrackedAsset = (id: number) =>
  http.request<{
    success: boolean;
    data: TrackedAsset & {
      documents: {
        id: number;
        doc_type: string;
        file_key: string;
        file_name: string | null;
        remark: string | null;
        created_at: string;
      }[];
      events: {
        id: number;
        event_type: string;
        event_time: string;
        operator_userid: string;
        detail: string | null;
      }[];
      configurations: TrackedAssetConfiguration[];
      warehouse_tasks: Array<
        WarehouseAssetWorkOrder & {
          manual_title: string | null;
          manual_version_no: number | null;
        }
      >;
      task_evidence: Array<
        WarehouseTaskEvidence & {
          work_order_no: string;
          work_order_type: string;
          work_order_status: string;
          result_summary: string | null;
          manual_title: string | null;
          manual_version_no: number | null;
        }
      >;
    };
  }>("get", `/api/v1/asset/${id}`);

export const listTrackedAssetConfigurations = (params?: {
  status?: TrackedAssetConfiguration["status"];
  tracked_asset_id?: number;
  whole_machine_code?: string;
}) =>
  http.request<{ success: boolean; data: TrackedAssetConfiguration[] }>(
    "get",
    "/api/v1/asset/configuration",
    { params }
  );

export const createTrackedAssetConfiguration = (data: {
  whole_machine_code?: string;
  shell_asset_id?: number | null;
  core_asset_id?: number | null;
  console_asset_id?: number | null;
  status?: TrackedAssetConfiguration["status"];
  project_id?: number | null;
  warehouse_id?: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
  note?: string | null;
}) =>
  http.request<{
    success: boolean;
    data: { id: number; configuration_code: string };
  }>("post", "/api/v1/asset/configuration", { data });

export const updateTrackedAssetConfiguration = (
  id: number,
  data: {
    whole_machine_code?: string;
    shell_asset_id?: number | null;
    core_asset_id?: number | null;
    console_asset_id?: number | null;
    status?: TrackedAssetConfiguration["status"];
    project_id?: number | null;
    warehouse_id?: number | null;
    effective_from?: string | null;
    effective_to?: string | null;
    note?: string | null;
  }
) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/asset/configuration/${id}`,
    { data }
  );

export const updateTrackedAsset = (
  id: number,
  data: {
    asset_name?: string;
    brand?: string;
    model?: string;
    serial_no?: string;
    status?: string;
    current_project_id?: number;
    current_warehouse_id?: number;
    current_location?: string;
    properties_json?: string;
    purchased_date?: string;
    ownership_type?: "owned" | "leased_in";
  }
) => http.request<{ success: boolean }>("put", `/api/v1/asset/${id}`, { data });

export const listAssetRentalTerms = (params?: {
  status?: "active" | "overdue" | "returned" | "closed";
  rental_mode?: "lease_in" | "lease_out";
  project_id?: number;
  overdue_only?: 1;
}) =>
  http.request<{ success: boolean; data: AssetRentalTerm[] }>(
    "get",
    "/api/v1/asset/rental/term",
    { params }
  );

export const createAssetRentalTerm = (data: {
  tracked_asset_id: number;
  rental_mode: "lease_in" | "lease_out";
  project_id?: number;
  contract_id?: number;
  finance_mode?: "contract" | "on_account";
  start_date: string;
  due_date: string;
  note?: string;
}) =>
  http.request<{
    success: boolean;
    data: { id: number; rental_no: string; status: string };
  }>("post", "/api/v1/asset/rental/term", { data });

export const returnAssetRentalTerm = (
  id: number,
  data?: { returned_date?: string; note?: string }
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/asset/rental/term/${id}/return`,
    { data }
  );

export const scanOverdueRentalTerms = () =>
  http.request<{ success: boolean; data: { updated: number } }>(
    "post",
    "/api/v1/asset/rental/term/scan-overdue"
  );

export const addAssetDocument = (
  id: number,
  data: {
    doc_type: string;
    file_key: string;
    file_name?: string;
    remark?: string;
  }
) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/asset/${id}/document`,
    { data }
  );

export const listAssetDocuments = (id: number) =>
  http.request<{ success: boolean; data: unknown[] }>(
    "get",
    `/api/v1/asset/${id}/document`
  );

export const deleteAssetDocument = (id: number, docId: number) =>
  http.request<{ success: boolean }>(
    "delete",
    `/api/v1/asset/${id}/document/${docId}`
  );

export const addAssetEvent = (
  id: number,
  data: {
    event_type: string;
    event_time?: string;
    project_id?: number;
    warehouse_id?: number;
    detail?: string;
  }
) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/asset/${id}/event`,
    { data }
  );

export const listAssetEvents = (id: number) =>
  http.request<{ success: boolean; data: unknown[] }>(
    "get",
    `/api/v1/asset/${id}/event`
  );

export const getAssetOverview = () =>
  http.request<{ success: boolean; data: Record<string, unknown> }>(
    "get",
    "/api/v1/asset/dashboard/overview"
  );

export const getAssetProjectView = (projectId: number) =>
  http.request<{ success: boolean; data: Record<string, unknown> }>(
    "get",
    `/api/v1/asset/dashboard/project/${projectId}`
  );

export const getDispatchBoard = (params?: {
  warehouse_id?: number;
  asset_type_id?: number;
  project_id?: number;
  dispatch_state?: DispatchBoardState;
}) =>
  http.request<{ success: boolean; data: DispatchBoardResponse }>(
    "get",
    "/api/v1/asset/dashboard/dispatch-board",
    { params }
  );
