export const warehouseManualTypes = [
  "operation",
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "safety"
] as const;

export type WarehouseManualType = (typeof warehouseManualTypes)[number];

export interface WarehouseManual {
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
}

export interface WarehouseManualVersion {
  id: number;
  manual_id: number;
  version_no: number;
  content_json: string;
  ai_draft_task_id: number | null;
  ai_draft_status: "none" | "queued" | "running" | "completed" | "failed";
  status: "draft" | "published" | "archived";
  published_by_userid: string | null;
  published_at: string | null;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
}

export interface WarehouseManualBinding {
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
}

export interface CreateWarehouseManualRequest {
  manual_title: string;
  manual_type?: WarehouseManualType;
  asset_type_id?: number | null;
  owner_userid?: string | null;
  content_json?: string;
}

export interface CreateWarehouseManualVersionRequest {
  content_json: string;
  ai_draft_task_id?: number | null;
  ai_draft_status?: "none" | "queued" | "running" | "completed" | "failed";
}

export interface UpsertWarehouseManualBindingRequest {
  manual_id: number;
  asset_type_id?: number | null;
  asset_model?: string | null;
  work_order_type?: string | null;
  configuration_role?: string | null;
  status?: "active" | "disabled";
}
