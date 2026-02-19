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
}
