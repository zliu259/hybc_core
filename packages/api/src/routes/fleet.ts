import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import {
  appendApiAuditLog,
  assertFuelApplicationTransition,
  buildFuelRiskSummary,
  createFleetNotificationRecord,
  evaluateFuelApplicationRules,
  listEnabledFleetFuelRulePolicies,
  replaceFuelQuotaRuleHits,
  type FleetFuelRulePolicyType,
  type FuelApplicationRuleContext,
  type FuelApplicationStatus
} from "../services/fleet-governance";
import {
  bindFuelCardToVehicle,
  isFuelCardBoundToVehicle,
  listFuelCardVehicleBindings,
  unbindFuelCardFromVehicle
} from "../services/fleet-card-binding";
import { deliverPendingFleetNotifications } from "../services/fleet-notification";
import { generateSerial } from "../services/serial";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();
const maxPageSize = 100;

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseBoundedPagination = (
  pageValue: string | undefined,
  pageSizeValue: string | undefined
): { page: number; pageSize: number } | null => {
  const page = pageValue === undefined ? 1 : parsePositiveInteger(pageValue);
  const pageSize = pageSizeValue === undefined ? 20 : parsePositiveInteger(pageSizeValue);

  if (!page || !pageSize || pageSize > maxPageSize) {
    return null;
  }

  return { page, pageSize };
};

const fuelRulePolicyTypes: FleetFuelRulePolicyType[] = [
  "amount_limit",
  "monthly_frequency",
  "mileage_delta",
  "card_balance",
  "photo_required"
];

const fuelRuleSeverities = ["info", "warning", "high"] as const;
const governanceAuditTargetTypes = ["fuel_quota_application", "fuel_card", "fleet_fuel_rule_policy"];

type FuelRuleSeverity = (typeof fuelRuleSeverities)[number];

type FuelRiskEvaluationInput = {
  applicationId: number;
  applicantUserid: string;
  vehicleId: number;
  fuelCardId: number | null;
  requestedAmount: number;
  vehicleMileageKm: number;
  photoKeysJson: string | null;
  requestedAt: string;
};

type FuelApplicationForGovernance = {
  id: number;
  application_no: string;
  applicant_userid: string;
  vehicle_id: number;
  fuel_card_id: number | null;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  status: FuelApplicationStatus;
  requested_at: string;
};

const getActorRolesJson = (roles: UserRole[]): string => JSON.stringify(roles);

const canViewFleetWide = (roles: UserRole[]) =>
  roles.some(role => role === "super_admin" || role === "manager" || role === "finance");

const monthRangeFromIso = (iso: string): { start: string; end: string } => {
  const date = new Date(iso);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
};

const isFuelRulePolicyType = (value: string): value is FleetFuelRulePolicyType =>
  fuelRulePolicyTypes.includes(value as FleetFuelRulePolicyType);

const isFuelRuleSeverity = (value: string): value is FuelRuleSeverity =>
  fuelRuleSeverities.includes(value as FuelRuleSeverity);

const normalizeConfigJson = (value: unknown): string | null => {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return null;
};

const loadFuelRuleContext = async (
  env: Env,
  input: FuelRiskEvaluationInput
): Promise<FuelApplicationRuleContext> => {
  const monthRange = monthRangeFromIso(input.requestedAt);
  const monthlyApplyCount = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM fuel_quota_application
     WHERE applicant_userid = ?
       AND requested_at >= ?
       AND requested_at < ?
       AND status <> 'cancelled'`
  )
    .bind(input.applicantUserid, monthRange.start, monthRange.end)
    .first<{ total: number }>();

  const previousMileage = await env.DB.prepare(
    `SELECT vehicle_mileage_km
     FROM fuel_quota_application
     WHERE vehicle_id = ?
       AND id <> ?
       AND status <> 'cancelled'
     ORDER BY requested_at DESC, id DESC
     LIMIT 1`
  )
    .bind(input.vehicleId, input.applicationId)
    .first<{ vehicle_mileage_km: number }>();

  const fuelCard = input.fuelCardId
    ? await env.DB.prepare("SELECT latest_balance FROM fuel_card WHERE id = ?")
        .bind(input.fuelCardId)
        .first<{ latest_balance: number | null }>()
    : null;

  return {
    requested_amount: input.requestedAmount,
    vehicle_mileage_km: input.vehicleMileageKm,
    photo_keys_json: input.photoKeysJson,
    monthly_apply_count: monthlyApplyCount?.total ?? 0,
    previous_mileage_km: previousMileage?.vehicle_mileage_km ?? null,
    card_latest_balance: fuelCard?.latest_balance ?? null
  };
};

const evaluateAndPersistFuelRisk = async (env: Env, input: FuelRiskEvaluationInput) => {
  const policies = await listEnabledFleetFuelRulePolicies(env);
  const application = await loadFuelRuleContext(env, input);
  const hits = evaluateFuelApplicationRules({ policies, application });
  const summary = buildFuelRiskSummary(hits);

  await replaceFuelQuotaRuleHits(env, input.applicationId, hits);
  await env.DB.prepare(
    `UPDATE fuel_quota_application
     SET risk_level = ?, risk_summary = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(summary.risk_level, summary.risk_summary, nowIso(), input.applicationId)
    .run();

  return { hits, summary };
};

const appendFuelCardBalanceLog = async (
  env: Env,
  payload: {
    fuelCardId: number;
    operationType: "card_created" | "application_processed" | "manual_adjustment";
    previousBalance: number;
    newBalance: number;
    relatedApplicationId?: number;
    operatorUserid?: string;
    remark?: string;
  }
) => {
  const ts = nowIso();
  const previousBalance = Number.isFinite(payload.previousBalance) ? payload.previousBalance : 0;
  const newBalance = Number.isFinite(payload.newBalance) ? payload.newBalance : 0;
  const changeAmount = newBalance - previousBalance;
  await env.DB.prepare(
    `INSERT INTO fuel_card_balance_log (
      fuel_card_id,
      operation_type,
      previous_balance,
      new_balance,
      change_amount,
      related_application_id,
      operator_userid,
      remark,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      payload.fuelCardId,
      payload.operationType,
      previousBalance,
      newBalance,
      changeAmount,
      payload.relatedApplicationId ?? null,
      payload.operatorUserid ?? null,
      payload.remark ?? null,
      ts
    )
    .run();
};

type CompanyVehicle = {
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

export const fleetRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

fleetRoutes.use("*", authMiddleware);

fleetRoutes.get("/vehicles", async (c) => {
  const status = c.req.query("status");
  const entityId = c.req.query("entity_id");
  const keyword = c.req.query("keyword");

  // 附带该车当前挂着的启用油卡（油卡跟车走）
  let sql = `SELECT
    v.*,
    COUNT(card.id) AS fuel_card_count,
    IFNULL(GROUP_CONCAT(card.card_no), '') AS fuel_card_nos
   FROM company_vehicle v
   LEFT JOIN fuel_card_vehicle_binding vb ON vb.vehicle_id = v.id AND vb.status = 'active'
   LEFT JOIN fuel_card card ON card.id = vb.fuel_card_id AND card.status = 'active'
   WHERE 1=1`;
  const params: Array<string | number> = [];

  if (status) {
    sql += " AND v.status = ?";
    params.push(status);
  }
  if (entityId) {
    sql += " AND v.entity_id = ?";
    params.push(Number(entityId));
  }
  if (keyword) {
    sql += " AND (v.current_plate_no LIKE ? OR v.vehicle_uuid LIKE ? OR v.owner_name LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += " GROUP BY v.id ORDER BY v.id DESC";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<CompanyVehicle & { fuel_card_count: number; fuel_card_nos: string }>();
  return c.json({ success: true, data: rows.results ?? [] });
});

fleetRoutes.post(
  "/vehicles",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const body = (await c.req.json()) as {
      entity_id?: number;
      ownership_type?: "company_owned" | "employee_owned";
      owner_name?: string;
      current_plate_no: string;
      vehicle_model?: string;
      status?: string;
    };

    if (!body.current_plate_no) {
      return c.json({ success: false, error: { message: "current_plate_no is required" } }, 400);
    }

    const createdAt = nowIso();
    const vehicleUuid = crypto.randomUUID();
    const result = await c.env.DB.prepare(
      `INSERT INTO company_vehicle (
        vehicle_uuid,
        entity_id,
        ownership_type,
        owner_name,
        current_plate_no,
        vehicle_model,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        vehicleUuid,
        typeof body.entity_id === "number" ? body.entity_id : null,
        body.ownership_type ?? "company_owned",
        body.owner_name ?? null,
        body.current_plate_no,
        body.vehicle_model ?? null,
        body.status ?? "active",
        createdAt,
        createdAt
      )
      .run();

    await c.env.DB.prepare(
      "INSERT INTO company_vehicle_plate_history (vehicle_id, plate_no, effective_from, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(result.meta.last_row_id, body.current_plate_no, createdAt, createdAt)
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, vehicle_uuid: vehicleUuid } },
      201
    );
  }
);

fleetRoutes.put(
  "/vehicles/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      entity_id?: number | null;
      ownership_type?: "company_owned" | "employee_owned";
      owner_name?: string | null;
      current_plate_no?: string;
      vehicle_model?: string | null;
      status?: string;
    };

    const previous = await c.env.DB.prepare("SELECT current_plate_no FROM company_vehicle WHERE id = ?")
      .bind(id)
      .first<{ current_plate_no: string }>();
    if (!previous) {
      return c.json({ success: false, error: { message: "Vehicle not found" } }, 404);
    }

    await c.env.DB.prepare(
      `UPDATE company_vehicle SET
        entity_id = ?,
        ownership_type = COALESCE(?, ownership_type),
        owner_name = ?,
        current_plate_no = COALESCE(?, current_plate_no),
        vehicle_model = ?,
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        typeof body.entity_id === "number" ? body.entity_id : null,
        body.ownership_type ?? null,
        body.owner_name ?? null,
        body.current_plate_no ?? null,
        body.vehicle_model ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    if (body.current_plate_no && body.current_plate_no !== previous.current_plate_no) {
      const updatedAt = nowIso();
      await c.env.DB.prepare(
        "UPDATE company_vehicle_plate_history SET effective_to = ? WHERE vehicle_id = ? AND effective_to IS NULL"
      )
        .bind(updatedAt, id)
        .run();
      await c.env.DB.prepare(
        "INSERT INTO company_vehicle_plate_history (vehicle_id, plate_no, effective_from, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(id, body.current_plate_no, updatedAt, updatedAt)
        .run();
    }

    return c.json({ success: true });
  }
);

fleetRoutes.get("/vehicles/:id/mileage", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT * FROM company_vehicle_mileage_log WHERE vehicle_id = ? ORDER BY recorded_at DESC, id DESC"
  )
    .bind(vehicleId)
    .all();
  return c.json({ success: true, data: rows.results ?? [] });
});

fleetRoutes.post(
  "/vehicles/:id/mileage",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const vehicleId = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      mileage_km: number;
      remark?: string;
      photo_keys_json?: string;
      recorded_at?: string;
    };

    if (typeof body.mileage_km !== "number") {
      return c.json({ success: false, error: { message: "mileage_km is required" } }, 400);
    }

    const ts = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO company_vehicle_mileage_log (
        vehicle_id,
        mileage_km,
        operator_userid,
        remark,
        photo_keys_json,
        recorded_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        vehicleId,
        body.mileage_km,
        auth.sub,
        body.remark ?? null,
        body.photo_keys_json ?? null,
        body.recorded_at ?? ts,
        ts
      )
      .run();

    return c.json({ success: true }, 201);
  }
);

// 油卡跟车走：所有角色都可看全部油卡与余额（申请时按车选卡）。
// 旧版小程序仍会带 mine=true，这里有意忽略它。
fleetRoutes.get("/fuel-cards", async (c) => {
  const status = c.req.query("status");
  const vehicleIdValue = c.req.query("vehicle_id");
  const vehicleId = vehicleIdValue === undefined ? null : parsePositiveInteger(vehicleIdValue);
  if (vehicleIdValue !== undefined && !vehicleId) {
    return c.json({ success: false, error: { message: "vehicle_id must be a positive integer" } }, 400);
  }

  let sql = `SELECT
    card.*,
    vb.vehicle_id,
    v.current_plate_no AS vehicle_plate_no
   FROM fuel_card card
   LEFT JOIN fuel_card_vehicle_binding vb ON vb.fuel_card_id = card.id AND vb.status = 'active'
   LEFT JOIN company_vehicle v ON v.id = vb.vehicle_id
   WHERE 1=1`;
  const params: Array<string | number> = [];

  if (status) {
    sql += " AND card.status = ?";
    params.push(status);
  }
  if (vehicleId) {
    sql += " AND vb.vehicle_id = ?";
    params.push(vehicleId);
  }
  sql += " ORDER BY card.id DESC";
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

fleetRoutes.post(
  "/fuel-cards",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const body = (await c.req.json()) as {
      card_no: string;
      issued_to_entity_id?: number;
      latest_balance?: number;
      status?: string;
    };

    if (!body.card_no) {
      return c.json({ success: false, error: { message: "card_no is required" } }, 400);
    }

    const createdAt = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO fuel_card (card_no, issued_to_entity_id, latest_balance, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.card_no,
        typeof body.issued_to_entity_id === "number" ? body.issued_to_entity_id : null,
        typeof body.latest_balance === "number" ? body.latest_balance : 0,
        body.status ?? "active",
        createdAt,
        createdAt
      )
      .run();

    await appendFuelCardBalanceLog(c.env, {
      fuelCardId: Number(result.meta.last_row_id),
      operationType: "card_created",
      previousBalance: 0,
      newBalance: typeof body.latest_balance === "number" ? body.latest_balance : 0,
      operatorUserid: c.get("auth").sub,
      remark: "新建油卡"
    });

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

fleetRoutes.get(
  "/fuel-cards/:id/balance-logs",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const fuelCardId = Number(c.req.param("id"));
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    if (!Number.isSafeInteger(fuelCardId) || fuelCardId <= 0) {
      return c.json({ success: false, error: { message: "fuel card id must be a positive integer" } }, 400);
    }

    const countRow = await c.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM fuel_card_balance_log WHERE fuel_card_id = ?"
    )
      .bind(fuelCardId)
      .first<{ total: number }>();

    const rows = await c.env.DB.prepare(
      `SELECT
        id,
        fuel_card_id,
        operation_type,
        previous_balance,
        new_balance,
        change_amount,
        related_application_id,
        operator_userid,
        remark,
        created_at
       FROM fuel_card_balance_log
       WHERE fuel_card_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(fuelCardId, pageSize, offset)
      .all();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: countRow?.total ?? 0 }
    });
  }
);

const bindConflictMessage = "油卡绑定已被他人修改，请刷新后重试";

// 绑定油卡到车辆；卡已在别的车上时即为转移。同车重复绑定幂等，不写审计。
fleetRoutes.post(
  "/fuel-cards/:id/bind-vehicle",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const fuelCardId = parsePositiveInteger(c.req.param("id"));
    if (!fuelCardId) {
      return c.json({ success: false, error: { message: "fuel card id must be a positive integer" } }, 400);
    }
    const body = (await c.req.json()) as { vehicle_id?: unknown };
    const vehicleId =
      typeof body.vehicle_id === "number" && Number.isSafeInteger(body.vehicle_id) && body.vehicle_id > 0
        ? body.vehicle_id
        : null;
    if (!vehicleId) {
      return c.json({ success: false, error: { message: "vehicle_id must be a positive integer" } }, 400);
    }

    const result = await bindFuelCardToVehicle(c.env, {
      fuelCardId,
      vehicleId,
      operatorUserid: auth.sub
    });
    if (!result.ok) {
      if (result.reason === "conflict") {
        return c.json({ success: false, error: { message: bindConflictMessage } }, 409);
      }
      const message = result.reason === "card_invalid" ? "所选油卡无效或已停用" : "所选车辆无效或已停用";
      return c.json({ success: false, error: { message } }, 400);
    }

    if (result.outcome !== "unchanged") {
      await appendApiAuditLog(c.env, {
        actor_userid: auth.sub,
        actor_roles_json: getActorRolesJson(auth.roles),
        action: "fuel_card_bind_vehicle",
        target_type: "fuel_card",
        target_id: String(fuelCardId),
        detail_json: JSON.stringify({
          outcome: result.outcome,
          from_vehicle_id: result.previousVehicleId,
          to_vehicle_id: vehicleId
        })
      });
    }

    return c.json({
      success: true,
      data: { outcome: result.outcome, previous_vehicle_id: result.previousVehicleId }
    });
  }
);

fleetRoutes.post(
  "/fuel-cards/:id/unbind-vehicle",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const fuelCardId = parsePositiveInteger(c.req.param("id"));
    if (!fuelCardId) {
      return c.json({ success: false, error: { message: "fuel card id must be a positive integer" } }, 400);
    }

    const result = await unbindFuelCardFromVehicle(c.env, { fuelCardId, operatorUserid: auth.sub });
    if (!result.ok) {
      return result.reason === "conflict"
        ? c.json({ success: false, error: { message: bindConflictMessage } }, 409)
        : c.json({ success: false, error: { message: "该油卡当前未绑定车辆" } }, 400);
    }

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_card_unbind_vehicle",
      target_type: "fuel_card",
      target_id: String(fuelCardId),
      detail_json: JSON.stringify({ from_vehicle_id: result.previousVehicleId })
    });

    return c.json({ success: true, data: { previous_vehicle_id: result.previousVehicleId } });
  }
);

fleetRoutes.get(
  "/fuel-cards/:id/vehicle-bindings",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const fuelCardId = parsePositiveInteger(c.req.param("id"));
    if (!fuelCardId) {
      return c.json({ success: false, error: { message: "fuel card id must be a positive integer" } }, 400);
    }

    const rows = await listFuelCardVehicleBindings(c.env, fuelCardId);
    return c.json({ success: true, data: rows });
  }
);

fleetRoutes.get("/fuel-applications", async (c) => {
  const auth = c.get("auth");
  const mine = c.req.query("mine") === "true";
  const shouldScopeToMine = mine || !canViewFleetWide(auth.roles);
  const status = c.req.query("status");

  let sql = `SELECT
    a.*,
    v.vehicle_uuid,
    v.current_plate_no,
    v.ownership_type,
    card.card_no,
    card.latest_balance as card_latest_balance
   FROM fuel_quota_application a
   JOIN company_vehicle v ON v.id = a.vehicle_id
   LEFT JOIN fuel_card card ON card.id = a.fuel_card_id
   WHERE 1=1`;
  const params: string[] = [];

  if (shouldScopeToMine) {
    sql += " AND a.applicant_userid = ?";
    params.push(auth.sub);
  }
  if (status) {
    sql += " AND a.status = ?";
    params.push(status);
  }
  sql += " ORDER BY a.id DESC";

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

fleetRoutes.get(
  "/fuel-applications/pending-summary",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
       FROM fuel_quota_application`
    ).first<{ pending_count: number; processed_count: number; rejected_count: number }>();

    return c.json({
      success: true,
      data: {
        pending_count: row?.pending_count ?? 0,
        processed_count: row?.processed_count ?? 0,
        rejected_count: row?.rejected_count ?? 0
      }
    });
  }
);

fleetRoutes.post(
  "/fuel-applications",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      vehicle_id: number;
      fuel_card_id: number;
      requested_amount: number;
      vehicle_mileage_km: number;
      photo_keys_json?: string;
    };

    if (
      typeof body.vehicle_id !== "number" ||
      typeof body.fuel_card_id !== "number" ||
      typeof body.requested_amount !== "number" ||
      typeof body.vehicle_mileage_km !== "number"
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: "vehicle_id, fuel_card_id, requested_amount, vehicle_mileage_km are required"
          }
        },
        400
      );
    }

    // 油卡跟车走：任何人可为任何启用车辆申请，但卡必须当前挂在这辆车上
    const vehicle = await c.env.DB.prepare("SELECT id, status FROM company_vehicle WHERE id = ?")
      .bind(body.vehicle_id)
      .first<{ id: number; status: string }>();
    if (!vehicle || vehicle.status !== "active") {
      return c.json({ success: false, error: { message: "所选车辆无效或已停用" } }, 400);
    }

    const fuelCard = await c.env.DB.prepare("SELECT id, status FROM fuel_card WHERE id = ?")
      .bind(body.fuel_card_id)
      .first<{ id: number; status: string }>();
    if (!fuelCard || fuelCard.status !== "active") {
      return c.json({ success: false, error: { message: "所选油卡无效或已停用" } }, 400);
    }

    if (!(await isFuelCardBoundToVehicle(c.env, body.fuel_card_id, body.vehicle_id))) {
      return c.json({ success: false, error: { message: "该油卡不属于所选车辆" } }, 400);
    }

    const ts = nowIso();
    const applicationNo = await generateSerial(c.env.DB, "FQ", "fuel_quota_application", "application_no");

    const result = await c.env.DB.prepare(
      `INSERT INTO fuel_quota_application (
        application_no,
        applicant_userid,
        vehicle_id,
        fuel_card_id,
        requested_amount,
        vehicle_mileage_km,
        photo_keys_json,
        status,
        requested_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
      .bind(
        applicationNo,
        auth.sub,
        body.vehicle_id,
        body.fuel_card_id,
        body.requested_amount,
        body.vehicle_mileage_km,
        body.photo_keys_json ?? null,
        ts,
        ts,
        ts
      )
      .run();

    const applicationId = Number(result.meta.last_row_id);
    const riskEvaluation = await evaluateAndPersistFuelRisk(c.env, {
      applicationId,
      applicantUserid: auth.sub,
      vehicleId: body.vehicle_id,
      fuelCardId: body.fuel_card_id,
      requestedAmount: body.requested_amount,
      vehicleMileageKm: body.vehicle_mileage_km,
      photoKeysJson: body.photo_keys_json ?? null,
      requestedAt: ts
    });

    await createFleetNotificationRecord(c.env, {
      application_id: applicationId,
      notification_type: "submitted",
      target_group_key: "finance_office",
      message_summary: `加油申请 ${applicationNo} 已提交`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_application_submit",
      target_type: "fuel_quota_application",
      target_id: String(applicationId),
      detail_json: JSON.stringify({
        application_no: applicationNo,
        vehicle_id: body.vehicle_id,
        fuel_card_id: body.fuel_card_id,
        requested_amount: body.requested_amount,
        risk_level: riskEvaluation.summary.risk_level
      })
    });

    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "fuel_quota_application_submitted",
        "fleet-route",
        JSON.stringify({
          application_id: applicationId,
          application_no: applicationNo,
          applicant_userid: auth.sub,
          vehicle_id: body.vehicle_id,
          fuel_card_id: body.fuel_card_id,
          requested_amount: body.requested_amount
        }),
        ts
      )
      .run();

    return c.json(
      { success: true, data: { id: applicationId, application_no: applicationNo } },
      201
    );
  }
);

fleetRoutes.get(
  "/fuel-applications/:id/rule-hits",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "application id must be a positive integer" } }, 400);
    }

    const application = await c.env.DB.prepare(
      "SELECT id, applicant_userid FROM fuel_quota_application WHERE id = ?"
    )
      .bind(id)
      .first<{ id: number; applicant_userid: string }>();

    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    const canViewAll = auth.roles.some((role) =>
      ["super_admin", "manager", "finance"].includes(role)
    );
    if (!canViewAll && application.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    const rows = await c.env.DB.prepare(
      `SELECT
        hit.id,
        hit.application_id,
        hit.policy_id,
        policy.policy_name,
        hit.policy_type,
        hit.severity,
        hit.hit_message,
        hit.suggested_action,
        hit.created_at
       FROM fuel_quota_rule_hit hit
       LEFT JOIN fleet_fuel_rule_policy policy ON policy.id = hit.policy_id
       WHERE hit.application_id = ?
       ORDER BY hit.id ASC`
    )
      .bind(id)
      .all();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

fleetRoutes.post(
  "/fuel-applications/:id/request-info",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "application id must be a positive integer" } }, 400);
    }

    const body = (await c.req.json()) as { reason?: string; office_remark?: string };
    const reason = body.reason?.trim();

    if (!reason) {
      return c.json({ success: false, error: { message: "reason is required" } }, 400);
    }

    const application = await c.env.DB.prepare(
      `SELECT
        id,
        application_no,
        applicant_userid,
        vehicle_id,
        fuel_card_id,
        requested_amount,
        vehicle_mileage_km,
        photo_keys_json,
        status,
        requested_at
       FROM fuel_quota_application
       WHERE id = ?`
    )
      .bind(id)
      .first<FuelApplicationForGovernance>();

    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    try {
      assertFuelApplicationTransition(application.status, "needs_info");
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "invalid status transition" }
        },
        400
      );
    }

    const ts = nowIso();
    const updateResult = await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        status = 'needs_info',
        needs_info_reason = ?,
        processed_by_userid = ?,
        processed_at = ?,
        office_remark = ?,
        updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(reason, auth.sub, ts, body.office_remark ?? reason, ts, id, application.status)
      .run();

    if ((updateResult.meta.changes ?? 0) === 0) {
      return c.json(
        { success: false, error: { message: "Application status changed; please reload and retry" } },
        409
      );
    }

    await createFleetNotificationRecord(c.env, {
      application_id: id,
      notification_type: "needs_info",
      target_userids_json: JSON.stringify([application.applicant_userid]),
      message_summary: `加油申请 ${application.application_no} 需要补充资料`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_application_request_info",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({ reason })
    });

    return c.json({ success: true });
  }
);

fleetRoutes.post(
  "/fuel-applications/:id/resubmit",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "application id must be a positive integer" } }, 400);
    }

    const body = (await c.req.json()) as {
      requested_amount?: number;
      vehicle_mileage_km?: number;
      photo_keys_json?: string | null;
    };

    const application = await c.env.DB.prepare(
      `SELECT
        id,
        application_no,
        applicant_userid,
        vehicle_id,
        fuel_card_id,
        requested_amount,
        vehicle_mileage_km,
        photo_keys_json,
        status,
        requested_at
       FROM fuel_quota_application
       WHERE id = ?`
    )
      .bind(id)
      .first<FuelApplicationForGovernance>();

    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    if (application.applicant_userid !== auth.sub && !auth.roles.includes("super_admin")) {
      return c.json({ success: false, error: { message: "Only applicant or super_admin can resubmit" } }, 403);
    }

    try {
      assertFuelApplicationTransition(application.status, "pending");
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "invalid status transition" }
        },
        400
      );
    }

    const requestedAmount =
      typeof body.requested_amount === "number" ? body.requested_amount : application.requested_amount;
    const vehicleMileageKm =
      typeof body.vehicle_mileage_km === "number"
        ? body.vehicle_mileage_km
        : application.vehicle_mileage_km;
    const photoKeysJson =
      Object.prototype.hasOwnProperty.call(body, "photo_keys_json")
        ? (body.photo_keys_json ?? null)
        : application.photo_keys_json;

    const ts = nowIso();
    const updateResult = await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        requested_amount = ?,
        vehicle_mileage_km = ?,
        photo_keys_json = ?,
        status = 'pending',
        needs_info_reason = NULL,
        resubmitted_at = ?,
        supplement_count = supplement_count + 1,
        updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(requestedAmount, vehicleMileageKm, photoKeysJson, ts, ts, id, application.status)
      .run();

    if ((updateResult.meta.changes ?? 0) === 0) {
      return c.json(
        { success: false, error: { message: "Application status changed; please reload and retry" } },
        409
      );
    }

    await evaluateAndPersistFuelRisk(c.env, {
      applicationId: id,
      applicantUserid: application.applicant_userid,
      vehicleId: application.vehicle_id,
      fuelCardId: application.fuel_card_id,
      requestedAmount,
      vehicleMileageKm,
      photoKeysJson,
      requestedAt: application.requested_at
    });

    await createFleetNotificationRecord(c.env, {
      application_id: id,
      notification_type: "submitted",
      target_group_key: "finance_office",
      message_summary: `加油申请 ${application.application_no} 已重新提交`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_application_resubmit",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({
        requested_amount: requestedAmount,
        vehicle_mileage_km: vehicleMileageKm,
        photo_keys_json: photoKeysJson
      })
    });

    return c.json({ success: true });
  }
);

fleetRoutes.post(
  "/fuel-applications/:id/process",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "application id must be a positive integer" } }, 400);
    }

    const body = (await c.req.json()) as {
      status: "processed" | "rejected";
      fuel_card_id?: number;
      latest_card_balance?: number;
      office_remark?: string;
    };

    if (body.status !== "processed" && body.status !== "rejected") {
      return c.json({ success: false, error: { message: "invalid status" } }, 400);
    }

    if (body.status === "processed" && typeof body.latest_card_balance !== "number") {
      return c.json(
        {
          success: false,
          error: { message: "latest_card_balance is required when status is processed" }
        },
        400
      );
    }

    const currentApplication = await c.env.DB.prepare(
      "SELECT id, application_no, applicant_userid, vehicle_id, fuel_card_id, status FROM fuel_quota_application WHERE id = ?"
    )
      .bind(id)
      .first<{
        id: number;
        application_no: string;
        applicant_userid: string;
        vehicle_id: number;
        fuel_card_id: number | null;
        status: FuelApplicationStatus;
      }>();
    if (!currentApplication) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    try {
      assertFuelApplicationTransition(currentApplication.status, body.status);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "invalid status transition" }
        },
        400
      );
    }

    const targetFuelCardId =
      typeof body.fuel_card_id === "number" ? body.fuel_card_id : currentApplication.fuel_card_id;
    let previousBalance: number | null = null;
    if (body.status === "processed" || typeof body.fuel_card_id === "number") {
      if (!targetFuelCardId) {
        return c.json({ success: false, error: { message: "fuel_card_id is required" } }, 400);
      }

      const targetCard = await c.env.DB.prepare("SELECT latest_balance, status FROM fuel_card WHERE id = ?")
        .bind(targetFuelCardId)
        .first<{ latest_balance: number; status: string }>();
      if (!targetCard || targetCard.status !== "active") {
        return c.json({ success: false, error: { message: "fuel_card_id is invalid or inactive" } }, 400);
      }
      previousBalance = typeof targetCard.latest_balance === "number" ? targetCard.latest_balance : 0;
    }

    // 只有换卡时才要求新卡挂在申请单的车上；原样回传原卡（含历史单）不校验绑定
    if (
      typeof body.fuel_card_id === "number" &&
      body.fuel_card_id !== currentApplication.fuel_card_id &&
      !(await isFuelCardBoundToVehicle(c.env, body.fuel_card_id, currentApplication.vehicle_id))
    ) {
      return c.json({ success: false, error: { message: "该油卡不属于该申请的车辆" } }, 400);
    }

    const ts = nowIso();
    const updateResult = await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        status = ?,
        processed_by_userid = ?,
        processed_at = ?,
        office_remark = ?,
        fuel_card_id = COALESCE(?, fuel_card_id),
        latest_card_balance = ?,
        updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(
        body.status,
        auth.sub,
        ts,
        body.office_remark ?? null,
        targetFuelCardId,
        typeof body.latest_card_balance === "number" ? body.latest_card_balance : null,
        ts,
        id,
        currentApplication.status
      )
      .run();

    if ((updateResult.meta.changes ?? 0) === 0) {
      return c.json(
        { success: false, error: { message: "Application status changed; please reload and retry" } },
        409
      );
    }

    if (
      body.status === "processed" &&
      typeof body.latest_card_balance === "number" &&
      targetFuelCardId &&
      previousBalance !== null
    ) {
      await c.env.DB.prepare("UPDATE fuel_card SET latest_balance = ?, updated_at = ? WHERE id = ?")
        .bind(body.latest_card_balance, ts, targetFuelCardId)
        .run();

      await appendFuelCardBalanceLog(c.env, {
        fuelCardId: targetFuelCardId,
        operationType: "application_processed",
        previousBalance,
        newBalance: body.latest_card_balance,
        relatedApplicationId: id,
        operatorUserid: auth.sub,
        remark: body.office_remark ?? "process fuel quota application"
      });
    }

    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "fuel_quota_application_processed",
        "fleet-route",
        JSON.stringify({
          application_id: id,
          status: body.status,
          processed_by_userid: auth.sub,
          fuel_card_id: targetFuelCardId,
          latest_card_balance:
            typeof body.latest_card_balance === "number" ? body.latest_card_balance : null,
          office_remark: body.office_remark ?? null
        }),
        ts
      )
      .run();

    await createFleetNotificationRecord(c.env, {
      application_id: id,
      notification_type: "processed",
      target_userids_json: JSON.stringify([currentApplication.applicant_userid]),
      message_summary:
        body.status === "processed"
          ? `加油申请 ${currentApplication.application_no} 已通过`
          : `加油申请 ${currentApplication.application_no} 已拒绝`
    });

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_application_process",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({
        status: body.status,
        fuel_card_id: targetFuelCardId,
        latest_card_balance:
          typeof body.latest_card_balance === "number" ? body.latest_card_balance : null,
        office_remark: body.office_remark ?? null
      })
    });

    return c.json({ success: true });
  }
);

fleetRoutes.post(
  "/fuel-applications/:id/void",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "application id must be a positive integer" } }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const application = await c.env.DB.prepare(
      "SELECT id, status FROM fuel_quota_application WHERE id = ?"
    )
      .bind(id)
      .first<{ id: number; status: string }>();

    if (!application) {
      return c.json({ success: false, error: { message: "application not found" } }, 404);
    }

    if (application.status === "cancelled") {
      return c.json({ success: false, error: { message: "application is already cancelled" } }, 400);
    }

    if (application.status !== "pending" && application.status !== "needs_info") {
      return c.json(
        {
          success: false,
          error: { message: "Only pending or needs_info applications can be voided" }
        },
        400
      );
    }

    const ts = nowIso();
    const updateResult = await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        status = 'cancelled',
        office_remark = ?,
        processed_by_userid = ?,
        processed_at = ?,
        updated_at = ?
       WHERE id = ? AND status = ?`
    )
      .bind(
        body.reason ?? "超级管理员废除",
        auth.sub,
        ts,
        ts,
        id,
        application.status
      )
      .run();

    if ((updateResult.meta.changes ?? 0) === 0) {
      return c.json(
        { success: false, error: { message: "Application status changed; please reload and retry" } },
        409
      );
    }

    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "fuel_quota_application_voided",
        "fleet-route",
        JSON.stringify({
          application_id: id,
          voided_by_userid: auth.sub,
          reason: body.reason ?? null
        }),
        ts
      )
      .run();

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fuel_application_void",
      target_type: "fuel_quota_application",
      target_id: String(id),
      detail_json: JSON.stringify({ reason: body.reason ?? null })
    });

    return c.json({ success: true });
  }
);

fleetRoutes.get(
  "/rule-policies",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const enabled = c.req.query("enabled");
    const policyType = c.req.query("policy_type");
    let sql = `SELECT
      id,
      policy_name,
      policy_type,
      config_json,
      severity,
      enabled,
      created_by,
      created_at,
      updated_at
     FROM fleet_fuel_rule_policy
     WHERE 1=1`;
    const params: Array<string | number> = [];

    if (enabled === "0" || enabled === "1") {
      sql += " AND enabled = ?";
      params.push(Number(enabled));
    }

    if (policyType) {
      sql += " AND policy_type = ?";
      params.push(policyType);
    }

    sql += " ORDER BY id ASC";
    const rows = await c.env.DB.prepare(sql).bind(...params).all();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

fleetRoutes.post(
  "/rule-policies",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      policy_name?: string;
      policy_type?: string;
      config_json?: unknown;
      severity?: string;
      enabled?: number | boolean;
    };
    const policyName = body.policy_name?.trim();
    const configJson = normalizeConfigJson(body.config_json);

    if (!policyName) {
      return c.json({ success: false, error: { message: "policy_name is required" } }, 400);
    }
    if (!body.policy_type || !isFuelRulePolicyType(body.policy_type)) {
      return c.json({ success: false, error: { message: "policy_type is invalid" } }, 400);
    }
    if (!configJson) {
      return c.json({ success: false, error: { message: "config_json must be valid JSON" } }, 400);
    }
    if (body.severity && !isFuelRuleSeverity(body.severity)) {
      return c.json({ success: false, error: { message: "severity is invalid" } }, 400);
    }

    const enabled = typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : body.enabled === 0 ? 0 : 1;
    const ts = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO fleet_fuel_rule_policy (
        policy_name,
        policy_type,
        config_json,
        severity,
        enabled,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(policyName, body.policy_type, configJson, body.severity ?? "warning", enabled, auth.sub, ts, ts)
      .run();

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fleet_fuel_rule_policy_create",
      target_type: "fleet_fuel_rule_policy",
      target_id: String(Number(result.meta.last_row_id)),
      detail_json: JSON.stringify({
        policy_name: policyName,
        policy_type: body.policy_type,
        severity: body.severity ?? "warning",
        enabled
      })
    });

    return c.json({ success: true, data: { id: Number(result.meta.last_row_id) } }, 201);
  }
);

fleetRoutes.put(
  "/rule-policies/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "rule policy id must be a positive integer" } }, 400);
    }

    const body = (await c.req.json()) as {
      policy_name?: string;
      policy_type?: string;
      config_json?: unknown;
      severity?: string;
      enabled?: number | boolean;
    };

    const existing = await c.env.DB.prepare("SELECT id FROM fleet_fuel_rule_policy WHERE id = ?")
      .bind(id)
      .first<{ id: number }>();
    if (!existing) {
      return c.json({ success: false, error: { message: "rule policy not found" } }, 404);
    }

    const policyName = typeof body.policy_name === "string" ? body.policy_name.trim() : null;
    if (body.policy_name !== undefined && !policyName) {
      return c.json({ success: false, error: { message: "policy_name is required" } }, 400);
    }
    if (body.policy_type !== undefined && !isFuelRulePolicyType(body.policy_type)) {
      return c.json({ success: false, error: { message: "policy_type is invalid" } }, 400);
    }
    if (body.severity !== undefined && !isFuelRuleSeverity(body.severity)) {
      return c.json({ success: false, error: { message: "severity is invalid" } }, 400);
    }

    const configJson = body.config_json === undefined ? null : normalizeConfigJson(body.config_json);
    if (body.config_json !== undefined && !configJson) {
      return c.json({ success: false, error: { message: "config_json must be valid JSON" } }, 400);
    }

    const enabled =
      typeof body.enabled === "boolean"
        ? body.enabled
          ? 1
          : 0
        : typeof body.enabled === "number"
          ? body.enabled === 1
            ? 1
            : 0
          : null;

    const ts = nowIso();
    await c.env.DB.prepare(
      `UPDATE fleet_fuel_rule_policy SET
        policy_name = COALESCE(?, policy_name),
        policy_type = COALESCE(?, policy_type),
        config_json = COALESCE(?, config_json),
        severity = COALESCE(?, severity),
        enabled = COALESCE(?, enabled),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        policyName,
        body.policy_type ?? null,
        configJson,
        body.severity ?? null,
        enabled,
        ts,
        id
      )
      .run();

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fleet_fuel_rule_policy_update",
      target_type: "fleet_fuel_rule_policy",
      target_id: String(id),
      detail_json: JSON.stringify({
        policy_name: policyName,
        policy_type: body.policy_type ?? null,
        config_json: configJson,
        severity: body.severity ?? null,
        enabled
      })
    });

    return c.json({ success: true });
  }
);

fleetRoutes.post(
  "/rule-policies/:id/toggle",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "rule policy id must be a positive integer" } }, 400);
    }

    let body: { enabled?: number | boolean } = {};
    try {
      body = (await c.req.json()) as { enabled?: number | boolean };
    } catch {
      body = {};
    }

    const existing = await c.env.DB.prepare("SELECT id, enabled FROM fleet_fuel_rule_policy WHERE id = ?")
      .bind(id)
      .first<{ id: number; enabled: number }>();
    if (!existing) {
      return c.json({ success: false, error: { message: "rule policy not found" } }, 404);
    }

    const enabled =
      typeof body.enabled === "boolean"
        ? body.enabled
          ? 1
          : 0
        : typeof body.enabled === "number"
          ? body.enabled === 1
            ? 1
            : 0
          : existing.enabled === 1
            ? 0
            : 1;

    const ts = nowIso();
    await c.env.DB.prepare("UPDATE fleet_fuel_rule_policy SET enabled = ?, updated_at = ? WHERE id = ?")
      .bind(enabled, ts, id)
      .run();

    await appendApiAuditLog(c.env, {
      actor_userid: auth.sub,
      actor_roles_json: getActorRolesJson(auth.roles),
      action: "fleet_fuel_rule_policy_toggle",
      target_type: "fleet_fuel_rule_policy",
      target_id: String(id),
      detail_json: JSON.stringify({
        previous_enabled: existing.enabled,
        enabled
      })
    });

    return c.json({ success: true, data: { id, enabled } });
  }
);

fleetRoutes.get(
  "/notifications",
  requireRoles(["super_admin", "finance", "manager"]),
  async (c) => {
    const status = c.req.query("status");
    const notificationType = c.req.query("notification_type");
    const applicationIdValue = c.req.query("application_id");
    const applicationId =
      applicationIdValue === undefined ? null : parsePositiveInteger(applicationIdValue);
    const pagination = parseBoundedPagination(c.req.query("page"), c.req.query("pageSize"));
    if (!pagination) {
      return c.json(
        { success: false, error: { message: `page and pageSize must be positive integers; pageSize max is ${maxPageSize}` } },
        400
      );
    }
    if (applicationIdValue !== undefined && !applicationId) {
      return c.json({ success: false, error: { message: "application_id must be a positive integer" } }, 400);
    }

    const { page, pageSize } = pagination;
    const offset = (page - 1) * pageSize;

    let sql = `SELECT
      id,
      application_id,
      notification_type,
      target_userids_json,
      target_group_key,
      message_summary,
      status,
      error_message,
      retry_count,
      sent_at,
      created_at,
      updated_at
     FROM fleet_wecom_notification
     WHERE 1=1`;
    const params: Array<string | number> = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (notificationType) {
      sql += " AND notification_type = ?";
      params.push(notificationType);
    }
    if (applicationId !== null) {
      sql += " AND application_id = ?";
      params.push(applicationId);
    }

    const countSql = `SELECT COUNT(*) AS total FROM (${sql})`;
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
    const countRow = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: countRow?.total ?? 0 }
    });
  }
);

fleetRoutes.post(
  "/notifications/:id/retry",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const id = parsePositiveInteger(c.req.param("id"));
    if (!id) {
      return c.json({ success: false, error: { message: "notification id must be a positive integer" } }, 400);
    }

    const notification = await c.env.DB.prepare(
      "SELECT id, status FROM fleet_wecom_notification WHERE id = ?"
    )
      .bind(id)
      .first<{ id: number; status: string }>();

    if (!notification) {
      return c.json({ success: false, error: { message: "notification not found" } }, 404);
    }

    if (notification.status !== "failed" && notification.status !== "skipped") {
      return c.json(
        { success: false, error: { message: "Only failed or skipped notifications can be retried" } },
        400
      );
    }

    const result = await c.env.DB.prepare(
      `UPDATE fleet_wecom_notification
       SET status = 'pending',
           error_message = NULL,
           sent_at = NULL,
           updated_at = ?
       WHERE id = ? AND status IN ('failed', 'skipped')`
    )
      .bind(nowIso(), id)
      .run();

    if ((result.meta.changes ?? 0) === 0) {
      return c.json(
        { success: false, error: { message: "Notification status changed; please reload and retry" } },
        409
      );
    }

    const delivery = await deliverPendingFleetNotifications(c.env, { notificationId: id, limit: 1 });
    return c.json({ success: true, data: delivery });
  }
);

fleetRoutes.get(
  "/audit",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const action = c.req.query("action");
    const actorUserid = c.req.query("actor_userid");
    const targetType = c.req.query("target_type");
    const targetId = c.req.query("target_id");
    const pagination = parseBoundedPagination(c.req.query("page"), c.req.query("pageSize"));
    if (!pagination) {
      return c.json(
        { success: false, error: { message: `page and pageSize must be positive integers; pageSize max is ${maxPageSize}` } },
        400
      );
    }

    const { page, pageSize } = pagination;
    const offset = (page - 1) * pageSize;

    let sql = `SELECT
      id,
      actor_userid,
      actor_roles_json,
      action,
      target_type,
      target_id,
      status,
      detail_json,
      created_at
     FROM api_audit_log
     WHERE 1=1`;
    const params: string[] = [];

    if (action) {
      sql += " AND action = ?";
      params.push(action);
    }
    if (actorUserid) {
      sql += " AND actor_userid = ?";
      params.push(actorUserid);
    }
    sql += " AND target_type IN (?, ?, ?)";
    params.push(...governanceAuditTargetTypes);

    if (targetType) {
      if (!governanceAuditTargetTypes.includes(targetType)) {
        return c.json({ success: false, error: { message: "target_type is invalid" } }, 400);
      }
      sql += " AND target_type = ?";
      params.push(targetType);
    }
    if (targetId) {
      sql += " AND target_id = ?";
      params.push(targetId);
    }

    const countSql = `SELECT COUNT(*) AS total FROM (${sql})`;
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
    const countRow = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: countRow?.total ?? 0 }
    });
  }
);
