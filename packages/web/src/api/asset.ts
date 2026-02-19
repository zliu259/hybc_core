import { http } from "@/utils/http";

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
  created_at: string;
  updated_at: string;
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
    };
  }>("get", `/api/v1/asset/${id}`);

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
  }
) => http.request<{ success: boolean }>("put", `/api/v1/asset/${id}`, { data });

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
