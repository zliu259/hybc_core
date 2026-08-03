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
  bind_userids?: string;
  bind_user_count?: number;
};

export type FuelCardBalanceLog = {
  id: number;
  fuel_card_id: number;
  operation_type:
    | "card_created"
    | "application_processed"
    | "manual_adjustment";
  previous_balance: number;
  new_balance: number;
  change_amount: number;
  related_application_id: number | null;
  operator_userid: string | null;
  remark: string | null;
  created_at: string;
};

export type FuelQuotaApplication = {
  id: number;
  application_no: string;
  applicant_userid: string;
  vehicle_id: number;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  status: "pending" | "needs_info" | "processed" | "rejected" | "cancelled";
  risk_level: "normal" | "warning" | "high";
  risk_summary: string | null;
  needs_info_reason: string | null;
  resubmitted_at: string | null;
  supplement_count: number;
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
  card_latest_balance: number | null;
};

export type FleetFuelRulePolicy = {
  id: number;
  policy_name: string;
  policy_type:
    | "amount_limit"
    | "monthly_frequency"
    | "mileage_delta"
    | "card_balance"
    | "photo_required";
  config_json: string;
  severity: "info" | "warning" | "high";
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FuelQuotaRuleHit = {
  id: number;
  application_id: number;
  policy_id: number;
  policy_name: string | null;
  policy_type: FleetFuelRulePolicy["policy_type"];
  severity: "info" | "warning" | "high";
  hit_message: string;
  suggested_action: "review" | "verify_balance" | "request_info";
  created_at: string;
};

export type FleetPagination = {
  page: number;
  pageSize: number;
  total: number;
};

export type FleetWecomNotification = {
  id: number;
  application_id: number | null;
  notification_type:
    | "submitted"
    | "timeout"
    | "processed"
    | "needs_info"
    | "balance_warning";
  target_userids_json: string | null;
  target_group_key: string | null;
  message_summary: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  error_message: string | null;
  retry_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FleetAuditLog = {
  id: number;
  actor_userid: string | null;
  actor_roles_json: string | null;
  action: string;
  target_type: string;
  target_id: string;
  status: string;
  detail_json: string | null;
  created_at: string;
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
  return http.request<{
    success: boolean;
    data: { id: number; vehicle_uuid: string };
  }>("post", "/api/v1/fleet/vehicles", { data });
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
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/fleet/vehicles/${id}`,
    { data }
  );
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
  return http.request<{ success: boolean; data: FuelCard[] }>(
    "get",
    "/api/v1/fleet/fuel-cards",
    {
      params
    }
  );
};

export const listFuelCardBalanceLogs = (
  fuelCardId: number,
  params?: { page?: number; pageSize?: number }
) => {
  return http.request<{
    success: boolean;
    data: FuelCardBalanceLog[];
    pagination: { page: number; pageSize: number; total: number };
  }>("get", `/api/v1/fleet/fuel-cards/${fuelCardId}/balance-logs`, {
    params
  });
};

export const listMyFuelCards = () => {
  return http.request<{ success: boolean; data: FuelCard[] }>(
    "get",
    "/api/v1/fleet/fuel-cards",
    {
      params: { mine: true, status: "active" }
    }
  );
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

export const bindFuelCardUser = (
  fuelCardId: number,
  data: { bind_userid: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-cards/${fuelCardId}/bind-user`,
    { data }
  );
};

export const listFuelQuotaApplications = (params?: {
  mine?: boolean;
  status?: string;
  page?: number;
  pageSize?: number;
}) => {
  // pagination 仅在传 page/pageSize 时由后端返回
  return http.request<{
    success: boolean;
    data: FuelQuotaApplication[];
    pagination?: FleetPagination;
  }>("get", "/api/v1/fleet/fuel-applications", { params });
};

export const getFuelQuotaPendingSummary = () => {
  return http.request<{
    success: boolean;
    data: {
      pending_count: number;
      processed_count: number;
      rejected_count: number;
    };
  }>("get", "/api/v1/fleet/fuel-applications/pending-summary");
};

export const createFuelQuotaApplication = (data: {
  vehicle_id: number;
  fuel_card_id: number;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; application_no: string };
  }>("post", "/api/v1/fleet/fuel-applications", { data });
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

export const requestFuelQuotaApplicationInfo = (
  id: number,
  data: { reason: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/request-info`,
    { data }
  );
};

export const resubmitFuelQuotaApplication = (
  id: number,
  data: {
    requested_amount?: number;
    vehicle_mileage_km?: number;
    photo_keys_json?: string | null;
  }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/resubmit`,
    { data }
  );
};

export const listFuelQuotaRuleHits = (applicationId: number) => {
  return http.request<{ success: boolean; data: FuelQuotaRuleHit[] }>(
    "get",
    `/api/v1/fleet/fuel-applications/${applicationId}/rule-hits`
  );
};

export const listFleetFuelRulePolicies = () => {
  return http.request<{ success: boolean; data: FleetFuelRulePolicy[] }>(
    "get",
    "/api/v1/fleet/rule-policies"
  );
};

export const createFleetFuelRulePolicy = (
  data: Pick<
    FleetFuelRulePolicy,
    "policy_name" | "policy_type" | "config_json" | "severity"
  > & { enabled?: number }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/fleet/rule-policies",
    { data }
  );
};

export const updateFleetFuelRulePolicy = (
  id: number,
  data: Partial<
    Pick<
      FleetFuelRulePolicy,
      "policy_name" | "config_json" | "severity" | "enabled"
    >
  >
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/fleet/rule-policies/${id}`,
    { data }
  );
};

export const toggleFleetFuelRulePolicy = (
  id: number,
  data: { enabled: number }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/rule-policies/${id}/toggle`,
    { data }
  );
};

export const listFleetWecomNotifications = (params?: {
  status?: string;
  notification_type?: FleetWecomNotification["notification_type"];
  application_id?: number;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: FleetWecomNotification[];
    pagination: FleetPagination;
  }>("get", "/api/v1/fleet/notifications", { params });
};

export const retryFleetWecomNotification = (id: number) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/notifications/${id}/retry`
  );
};

export const listFleetAuditLogs = (params?: {
  action?: string;
  actor_userid?: string;
  target_type?:
    | "fuel_quota_application"
    | "fuel_card"
    | "fleet_fuel_rule_policy";
  target_id?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: FleetAuditLog[];
    pagination: FleetPagination;
  }>("get", "/api/v1/fleet/audit", { params });
};

export const voidFuelQuotaApplication = (
  id: number,
  data?: { reason?: string }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/fleet/fuel-applications/${id}/void`,
    { data: data ?? {} }
  );
};
