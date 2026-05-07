import { http } from "@/utils/http";

export type WarehouseManualType =
  | "operation"
  | "inspection"
  | "maintenance"
  | "servicing"
  | "modification"
  | "safety";

export type WarehouseManual = {
  id: number;
  manual_code: string;
  manual_title: string;
  manual_type: WarehouseManualType;
  asset_type_id: number | null;
  status: "draft" | "active" | "archived";
  owner_userid: string | null;
  created_at: string;
  updated_at: string;
  latest_version_no?: number | null;
  active_version_id?: number | null;
};

export type WarehouseManualVersion = {
  id: number;
  manual_id: number;
  version_no: number;
  content_json: string;
  ai_draft_task_id: number | null;
  ai_draft_status: "none" | "queued" | "running" | "completed" | "failed";
  status: "draft" | "reviewing" | "published" | "archived";
  published_by_userid: string | null;
  published_at: string | null;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
};

export type WarehouseManualBinding = {
  id: number;
  manual_id: number;
  asset_type_id: number | null;
  asset_model: string | null;
  work_order_type: string | null;
  configuration_role: string | null;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  manual_title?: string;
  manual_type?: WarehouseManualType;
  active_version_id?: number | null;
  active_version_no?: number | null;
};

export const listWarehouseManuals = (params?: {
  status?: WarehouseManual["status"];
  manual_type?: WarehouseManualType;
  asset_type_id?: number;
}) =>
  http.request<{ success: boolean; data: WarehouseManual[] }>(
    "get",
    "/api/v1/warehouse/manual",
    { params }
  );

export const createWarehouseManual = (data: {
  manual_title: string;
  manual_type?: WarehouseManualType;
  asset_type_id?: number | null;
  owner_userid?: string | null;
  content_json?: string;
}) =>
  http.request<{ success: boolean; data: { id: number; manual_code: string } }>(
    "post",
    "/api/v1/warehouse/manual",
    { data }
  );

export const listWarehouseManualBindings = (params?: {
  manual_id?: number;
  asset_type_id?: number;
  asset_model?: string;
  work_order_type?: string;
  status?: WarehouseManualBinding["status"];
}) =>
  http.request<{ success: boolean; data: WarehouseManualBinding[] }>(
    "get",
    "/api/v1/warehouse/manual/binding",
    { params }
  );

export const createWarehouseManualBinding = (data: {
  manual_id: number;
  asset_type_id?: number | null;
  asset_model?: string | null;
  work_order_type?: string | null;
  configuration_role?: string | null;
  status?: WarehouseManualBinding["status"];
}) =>
  http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/warehouse/manual/binding",
    { data }
  );

export const updateWarehouseManualBinding = (
  id: number,
  data: {
    manual_id?: number;
    asset_type_id?: number | null;
    asset_model?: string | null;
    work_order_type?: string | null;
    configuration_role?: string | null;
    status?: WarehouseManualBinding["status"];
  }
) =>
  http.request<{ success: boolean }>(
    "put",
    `/api/v1/warehouse/manual/binding/${id}`,
    { data }
  );

export const listWarehouseManualVersions = (id: number) =>
  http.request<{ success: boolean; data: WarehouseManualVersion[] }>(
    "get",
    `/api/v1/warehouse/manual/${id}/version`
  );

export const createWarehouseManualVersion = (
  id: number,
  data: { content_json: string }
) =>
  http.request<{ success: boolean; data: { id: number; version_no: number } }>(
    "post",
    `/api/v1/warehouse/manual/${id}/version`,
    { data }
  );

export const createWarehouseManualAiDraft = (
  id: number,
  data?: { source_limit?: number }
) =>
  http.request<{
    success: boolean;
    data: {
      id: number;
      version_no: number;
      ai_draft_task_id: number;
      ai_draft_status: WarehouseManualVersion["ai_draft_status"];
    };
  }>("post", `/api/v1/warehouse/manual/${id}/version/ai-draft`, { data });

export const publishWarehouseManualVersion = (id: number, versionId: number) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/manual/${id}/version/${versionId}/publish`
  );

export const submitWarehouseManualVersionReview = (
  id: number,
  versionId: number
) =>
  http.request<{ success: boolean }>(
    "post",
    `/api/v1/warehouse/manual/${id}/version/${versionId}/submit-review`
  );
