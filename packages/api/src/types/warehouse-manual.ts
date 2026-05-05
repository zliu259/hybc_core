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
