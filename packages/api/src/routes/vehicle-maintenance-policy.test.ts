import { describe, expect, it } from "vitest";

import {
  canManageMaintenance,
  resolveMaintenanceListScope,
  validateMaintenanceCreateInput
} from "./vehicle-maintenance-policy";

const allowedTypes = ["routine", "repair", "tire", "inspection", "accident", "other"];
const fallbackDate = "2026-06-24T00:00:00.000Z";

const validRaw = {
  vehicle_id: 7,
  maintenance_type: "routine",
  content: "更换机油机滤",
  mileage_km: 45000,
  service_provider: "城东修理厂",
  cost: 480,
  serviced_at: "2026-06-20",
  attachments_json: JSON.stringify([{ file_key: "k1", file_name: "f.pdf", file_size: 10 }])
};

describe("canManageMaintenance", () => {
  it("returns true for manager-tier roles", () => {
    expect(canManageMaintenance(["operator", "manager"])).toBe(true);
    expect(canManageMaintenance(["super_admin"])).toBe(true);
    expect(canManageMaintenance(["finance"])).toBe(true);
    expect(canManageMaintenance(["site_manager"])).toBe(true);
  });

  it("returns false for operator-only", () => {
    expect(canManageMaintenance(["operator"])).toBe(false);
  });
});

describe("resolveMaintenanceListScope", () => {
  it("restricts operators to their own records", () => {
    const scope = resolveMaintenanceListScope({ roles: ["operator"], authSub: "op.1" });
    expect(scope).toEqual({ restrictToUserid: "op.1" });
  });

  it("lets managers see all by default", () => {
    const scope = resolveMaintenanceListScope({ roles: ["manager"], authSub: "mgr.1" });
    expect(scope).toEqual({ restrictToUserid: null });
  });

  it("restricts managers to own when mine=true", () => {
    const scope = resolveMaintenanceListScope({
      roles: ["manager"],
      authSub: "mgr.1",
      requestedMine: true
    });
    expect(scope).toEqual({ restrictToUserid: "mgr.1" });
  });
});

describe("validateMaintenanceCreateInput", () => {
  it("accepts a valid payload and normalizes fields", () => {
    const result = validateMaintenanceCreateInput(validRaw, allowedTypes, fallbackDate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vehicleId).toBe(7);
    expect(result.value.maintenanceType).toBe("routine");
    expect(result.value.cost).toBe(480);
    expect(result.value.servicedAt).toBe("2026-06-20");
    expect(result.value.serviceProvider).toBe("城东修理厂");
  });

  it("uses fallback serviced_at when missing", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, serviced_at: undefined },
      allowedTypes,
      fallbackDate
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.servicedAt).toBe(fallbackDate);
  });

  it("treats blank cost as null", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, cost: "" },
      allowedTypes,
      fallbackDate
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cost).toBeNull();
  });

  it("rejects missing vehicle_id", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, vehicle_id: undefined },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "vehicle_id is required" });
  });

  it("rejects unknown maintenance_type", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, maintenance_type: "spaceship" },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "maintenance_type is invalid" });
  });

  it("rejects empty content", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, content: "   " },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({ ok: false, status: 400, message: "content is required" });
  });

  it("rejects negative mileage", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, mileage_km: -1 },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "mileage_km must be a non-negative number"
    });
  });

  it("rejects negative cost", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, cost: -5 },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "cost must be a non-negative number"
    });
  });

  it("rejects malformed attachments_json", () => {
    const result = validateMaintenanceCreateInput(
      { ...validRaw, attachments_json: "{not-an-array}" },
      allowedTypes,
      fallbackDate
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      message: "attachments_json must be a JSON array"
    });
  });
});
