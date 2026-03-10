import { http } from "@/utils/http";

export type FleetVehicle = {
  id: number;
  vehicle_uuid: string;
  entity_id: number | null;
  ownership_type: "company_owned" | "employee_owned";
  owner_name: string | null;
  current_plate_no: string;
  vehicle_model: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FuelCard = {
  id: number;
  card_no: string;
  issued_to_entity_id: number | null;
  latest_balance: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FuelQuotaApplication = {
  id: number;
  application_no: string;
  applicant_userid: string;
  vehicle_id: number;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  status: "pending" | "processed" | "rejected";
  requested_at: string;
  processed_by_userid: string | null;
  processed_at: string | null;
  office_remark: string | null;
  fuel_card_id: number | null;
  latest_card_balance: number | null;
  vehicle_uuid: string;
  current_plate_no: string;
  ownership_type: "company_owned" | "employee_owned";
  card_no: string | null;
};

export const listFleetVehicles = (params?: {
  status?: string;
  entity_id?: number;
  keyword?: string;
}) => {
  return http.request<{ success: boolean; data: FleetVehicle[] }>(
    "get",
    "/api/v1/fleet/vehicles",
    { params }
  );
};

export const createFleetVehicle = (data: {
  entity_id?: number;
  ownership_type?: "company_owned" | "employee_owned";
  owner_name?: string;
  current_plate_no: string;
  vehicle_model?: string;
  status?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number; vehicle_uuid: string } }>(
    "post",
    "/api/v1/fleet/vehicles",
    { data }
  );
};

export const updateFleetVehicle = (
  id: number,
  data: {
    entity_id?: number | null;
    ownership_type?: "company_owned" | "employee_owned";
    owner_name?: string | null;
    current_plate_no?: string;
    vehicle_model?: string | null;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/fleet/vehicles/${id}`, { data });
};

export const createVehicleMileageLog = (
  vehicleId: number,
  data: {
    mileage_km: number;
    remark?: string;
    photo_keys_json?: string;
    recorded_at?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/vehicles/${vehicleId}/mileage`,
    { data }
  );
};

export const listFuelCards = (params?: { status?: string }) => {
  return http.request<{ success: boolean; data: FuelCard[] }>("get", "/api/v1/fleet/fuel-cards", {
    params
  });
};

export const createFuelCard = (data: {
  card_no: string;
  issued_to_entity_id?: number;
  latest_balance?: number;
  status?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/fleet/fuel-cards",
    { data }
  );
};

export const bindFuelCardVehicle = (fuelCardId: number, data: { vehicle_id: number }) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-cards/${fuelCardId}/bind-vehicle`,
    { data }
  );
};

export const listFuelQuotaApplications = (params?: { mine?: boolean; status?: string }) => {
  return http.request<{ success: boolean; data: FuelQuotaApplication[] }>(
    "get",
    "/api/v1/fleet/fuel-applications",
    { params }
  );
};

export const createFuelQuotaApplication = (data: {
  vehicle_id: number;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number; application_no: string } }>(
    "post",
    "/api/v1/fleet/fuel-applications",
    { data }
  );
};

export const processFuelQuotaApplication = (
  id: number,
  data: {
    status: "processed" | "rejected";
    fuel_card_id?: number;
    latest_card_balance?: number;
    office_remark?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/process`,
    { data }
  );
};
