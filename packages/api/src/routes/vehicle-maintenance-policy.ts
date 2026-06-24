import type { UserRole } from "../types/auth";

export const MAINTENANCE_MANAGER_ROLES: UserRole[] = [
  "super_admin",
  "manager",
  "finance",
  "site_manager"
];

export const canManageMaintenance = (roles: UserRole[]): boolean =>
  roles.some((role) => MAINTENANCE_MANAGER_ROLES.includes(role));

export type MaintenanceListScopeInput = {
  roles: UserRole[];
  authSub: string;
  requestedMine?: boolean;
};

export const resolveMaintenanceListScope = (
  input: MaintenanceListScopeInput
): { restrictToUserid: string | null } => {
  // 非管理层（operator）强制只看本人；管理层默认看全部，除非显式 mine=true
  if (!canManageMaintenance(input.roles)) {
    return { restrictToUserid: input.authSub };
  }
  if (input.requestedMine) {
    return { restrictToUserid: input.authSub };
  }
  return { restrictToUserid: null };
};

export type MaintenanceCreateRawInput = {
  vehicle_id?: unknown;
  maintenance_type?: unknown;
  content?: unknown;
  mileage_km?: unknown;
  service_provider?: unknown;
  cost?: unknown;
  serviced_at?: unknown;
  attachments_json?: unknown;
  remark?: unknown;
};

export type MaintenanceCreateValue = {
  vehicleId: number;
  maintenanceType: string;
  content: string;
  mileageKm: number;
  serviceProvider: string | null;
  cost: number | null;
  servicedAt: string;
  attachmentsJson: string | null;
  remark: string | null;
};

export type MaintenanceValidation =
  | { ok: true; value: MaintenanceCreateValue }
  | { ok: false; status: 400; message: string };

const isJsonArray = (raw: string): boolean => {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
};

export const validateMaintenanceCreateInput = (
  input: MaintenanceCreateRawInput,
  allowedTypes: string[],
  fallbackServicedAt: string
): MaintenanceValidation => {
  const vehicleId = Number(input.vehicle_id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
    return { ok: false, status: 400, message: "vehicle_id is required" };
  }

  const maintenanceType =
    typeof input.maintenance_type === "string" ? input.maintenance_type.trim() : "";
  if (!maintenanceType || !allowedTypes.includes(maintenanceType)) {
    return { ok: false, status: 400, message: "maintenance_type is invalid" };
  }

  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return { ok: false, status: 400, message: "content is required" };
  }

  const mileageKm = Number(input.mileage_km);
  if (!Number.isFinite(mileageKm) || mileageKm < 0) {
    return {
      ok: false,
      status: 400,
      message: "mileage_km must be a non-negative number"
    };
  }

  let cost: number | null = null;
  if (input.cost !== undefined && input.cost !== null && input.cost !== "") {
    const parsedCost = Number(input.cost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      return {
        ok: false,
        status: 400,
        message: "cost must be a non-negative number"
      };
    }
    cost = parsedCost;
  }

  let attachmentsJson: string | null = null;
  if (typeof input.attachments_json === "string" && input.attachments_json.trim()) {
    if (!isJsonArray(input.attachments_json)) {
      return {
        ok: false,
        status: 400,
        message: "attachments_json must be a JSON array"
      };
    }
    attachmentsJson = input.attachments_json;
  }

  const servicedAt =
    typeof input.serviced_at === "string" && input.serviced_at.trim()
      ? input.serviced_at.trim()
      : fallbackServicedAt;

  const serviceProvider =
    typeof input.service_provider === "string" && input.service_provider.trim()
      ? input.service_provider.trim()
      : null;

  const remark =
    typeof input.remark === "string" && input.remark.trim() ? input.remark.trim() : null;

  return {
    ok: true,
    value: {
      vehicleId,
      maintenanceType,
      content,
      mileageKm,
      serviceProvider,
      cost,
      servicedAt,
      attachmentsJson,
      remark
    }
  };
};
