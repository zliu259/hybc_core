import { http } from "@/utils/http";

export type VehicleMaintenanceRecord = {
  id: number;
  record_no: string;
  vehicle_id: number;
  maintenance_type: string;
  content: string;
  mileage_km: number;
  service_provider: string | null;
  cost: number | null;
  serviced_at: string;
  attachments_json: string | null;
  remark: string | null;
  status: "active" | "voided";
  created_by_userid: string;
  voided_by_userid: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  current_plate_no?: string | null;
  vehicle_model?: string | null;
};

export type MaintenanceAttachment = {
  file_key: string;
  file_name: string;
  file_size?: number;
};

export type MaintenancePagination = {
  page: number;
  pageSize: number;
  total: number;
};

export type MaintenanceTypeOption = {
  dict_label: string;
  dict_value: string;
};

export type MaintenanceCreatePayload = {
  vehicle_id: number;
  maintenance_type: string;
  content: string;
  mileage_km: number;
  service_provider?: string | null;
  cost?: number | null;
  serviced_at?: string;
  attachments_json?: string | null;
  remark?: string | null;
};

export const listMaintenanceRecords = (params?: {
  vehicle_id?: number;
  maintenance_type?: string;
  status?: string;
  mine?: boolean;
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: VehicleMaintenanceRecord[];
    pagination: MaintenancePagination;
  }>("get", "/api/v1/fleet/maintenance", { params });
};

export const getMaintenanceRecord = (id: number) => {
  return http.request<{ success: boolean; data: VehicleMaintenanceRecord }>(
    "get",
    `/api/v1/fleet/maintenance/${id}`
  );
};

export const createMaintenanceRecord = (data: MaintenanceCreatePayload) => {
  return http.request<{ success: boolean; data: { id: number; record_no: string } }>(
    "post",
    "/api/v1/fleet/maintenance",
    { data }
  );
};

export const updateMaintenanceRecord = (id: number, data: MaintenanceCreatePayload) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/fleet/maintenance/${id}`,
    { data }
  );
};

export const voidMaintenanceRecord = (id: number, data?: { reason?: string }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/maintenance/${id}/void`,
    { data: data ?? {} }
  );
};

export const listMaintenanceTypes = () => {
  return http.request<{ success: boolean; data: MaintenanceTypeOption[] }>(
    "get",
    "/api/v1/dict",
    { params: { dict_type: "vehicle_maintenance_type" } }
  );
};
