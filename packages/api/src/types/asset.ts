export interface AssetType {
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
}

export interface TrackedAsset {
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
}

export interface AssetRentalTerm {
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
}

export interface TrackedAssetDocument {
  id: number;
  tracked_asset_id: number;
  doc_type: string;
  file_key: string;
  file_name: string | null;
  remark: string | null;
  status: string;
  created_at: string;
}

export interface TrackedAssetEvent {
  id: number;
  tracked_asset_id: number;
  event_type: string;
  event_time: string;
  operator_userid: string;
  project_id: number | null;
  warehouse_id: number | null;
  detail: string | null;
  created_at: string;
}

export interface CreateAssetTypeRequest {
  type_code: string;
  type_name: string;
  tracked_flag?: number;
  unit?: string;
  property_schema?: string;
  min_stock?: number;
}

export interface UpdateAssetTypeRequest {
  type_name?: string;
  tracked_flag?: number;
  unit?: string;
  property_schema?: string;
  min_stock?: number;
  status?: string;
}

export interface CreateTrackedAssetRequest {
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
}

export interface UpdateTrackedAssetRequest {
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

export interface CreateAssetRentalTermRequest {
  tracked_asset_id: number;
  rental_mode: "lease_in" | "lease_out";
  project_id?: number;
  contract_id?: number;
  finance_mode?: "contract" | "on_account";
  start_date: string;
  due_date: string;
  note?: string;
}

export interface ReturnAssetRentalTermRequest {
  returned_date?: string;
  note?: string;
}
