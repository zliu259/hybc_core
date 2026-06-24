import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { appendApiAuditLog } from "../services/fleet-governance";
import { generateSerial } from "../services/serial";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";
import {
  canManageMaintenance,
  resolveMaintenanceListScope,
  validateMaintenanceCreateInput
} from "./vehicle-maintenance-policy";

const nowIso = () => new Date().toISOString();
const maxPageSize = 100;
const managerRoles: UserRole[] = ["super_admin", "manager", "finance", "site_manager"];

type MaintenanceRow = {
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
  status: string;
  created_by_userid: string;
  voided_by_userid: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  current_plate_no?: string | null;
  vehicle_model?: string | null;
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const loadAllowedMaintenanceTypes = async (env: Env): Promise<string[]> => {
  const rows = await env.DB.prepare(
    "SELECT dict_value FROM sys_dict WHERE dict_type = 'vehicle_maintenance_type' AND status = 'active'"
  ).all<{ dict_value: string }>();
  return (rows.results ?? []).map((row) => row.dict_value);
};

export const vehicleMaintenanceRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

vehicleMaintenanceRoutes.use("*", authMiddleware);

// GET 列表（分页 + 筛选 + 角色范围）
vehicleMaintenanceRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const scope = resolveMaintenanceListScope({
    roles: auth.roles,
    authSub: auth.sub,
    requestedMine: c.req.query("mine") === "true"
  });

  const page = parsePositiveInteger(c.req.query("page")) ?? 1;
  const pageSize = Math.min(parsePositiveInteger(c.req.query("pageSize")) ?? 20, maxPageSize);
  const offset = (page - 1) * pageSize;

  const filters: string[] = [];
  const params: Array<string | number> = [];

  if (scope.restrictToUserid) {
    filters.push("m.created_by_userid = ?");
    params.push(scope.restrictToUserid);
  }

  const vehicleId = c.req.query("vehicle_id");
  if (vehicleId) {
    filters.push("m.vehicle_id = ?");
    params.push(Number(vehicleId));
  }

  const maintenanceType = c.req.query("maintenance_type");
  if (maintenanceType) {
    filters.push("m.maintenance_type = ?");
    params.push(maintenanceType);
  }

  const status = c.req.query("status");
  if (status) {
    filters.push("m.status = ?");
    params.push(status);
  }

  const dateFrom = c.req.query("date_from");
  if (dateFrom) {
    filters.push("m.serviced_at >= ?");
    params.push(dateFrom);
  }

  const dateTo = c.req.query("date_to");
  if (dateTo) {
    filters.push("m.serviced_at <= ?");
    params.push(dateTo);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM vehicle_maintenance_record m ${whereClause}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT m.*, v.current_plate_no, v.vehicle_model
       FROM vehicle_maintenance_record m
       LEFT JOIN company_vehicle v ON v.id = m.vehicle_id
       ${whereClause}
       ORDER BY m.serviced_at DESC, m.id DESC
       LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<MaintenanceRow>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countRow?.total ?? 0 }
  });
});

// GET 详情
vehicleMaintenanceRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));

  const row = await c.env.DB.prepare(
    `SELECT m.*, v.current_plate_no, v.vehicle_model
       FROM vehicle_maintenance_record m
       LEFT JOIN company_vehicle v ON v.id = m.vehicle_id
       WHERE m.id = ?`
  )
    .bind(id)
    .first<MaintenanceRow>();

  if (!row) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }

  if (!canManageMaintenance(auth.roles) && row.created_by_userid !== auth.sub) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  return c.json({ success: true, data: row });
});

// POST 新增（全员）
vehicleMaintenanceRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowedTypes = await loadAllowedMaintenanceTypes(c.env);

  const validation = validateMaintenanceCreateInput(body, allowedTypes, nowIso());
  if (!validation.ok) {
    return c.json({ success: false, error: { message: validation.message } }, validation.status);
  }
  const value = validation.value;

  const vehicle = await c.env.DB.prepare("SELECT id FROM company_vehicle WHERE id = ?")
    .bind(value.vehicleId)
    .first<{ id: number }>();
  if (!vehicle) {
    return c.json({ success: false, error: { message: "Vehicle not found" } }, 404);
  }

  const recordNo = await generateSerial(
    c.env.DB,
    "BY",
    "vehicle_maintenance_record",
    "record_no"
  );
  const ts = nowIso();

  const result = await c.env.DB.prepare(
    `INSERT INTO vehicle_maintenance_record (
      record_no, vehicle_id, maintenance_type, content, mileage_km,
      service_provider, cost, serviced_at, attachments_json, remark,
      status, created_by_userid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      recordNo,
      value.vehicleId,
      value.maintenanceType,
      value.content,
      value.mileageKm,
      value.serviceProvider,
      value.cost,
      value.servicedAt,
      value.attachmentsJson,
      value.remark,
      auth.sub,
      ts,
      ts
    )
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_create",
    target_type: "vehicle_maintenance_record",
    target_id: String(result.meta.last_row_id),
    detail_json: JSON.stringify({ record_no: recordNo, vehicle_id: value.vehicleId })
  });

  return c.json(
    { success: true, data: { id: result.meta.last_row_id, record_no: recordNo } },
    201
  );
});

// PUT 编辑（管理层）
vehicleMaintenanceRoutes.put("/:id", requireRoles(managerRoles), async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowedTypes = await loadAllowedMaintenanceTypes(c.env);

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM vehicle_maintenance_record WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; status: string }>();
  if (!existing) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }
  if (existing.status === "voided") {
    return c.json({ success: false, error: { message: "Cannot edit a voided record" } }, 400);
  }

  const validation = validateMaintenanceCreateInput(body, allowedTypes, nowIso());
  if (!validation.ok) {
    return c.json({ success: false, error: { message: validation.message } }, validation.status);
  }
  const value = validation.value;

  const vehicle = await c.env.DB.prepare("SELECT id FROM company_vehicle WHERE id = ?")
    .bind(value.vehicleId)
    .first<{ id: number }>();
  if (!vehicle) {
    return c.json({ success: false, error: { message: "Vehicle not found" } }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE vehicle_maintenance_record SET
      vehicle_id = ?, maintenance_type = ?, content = ?, mileage_km = ?,
      service_provider = ?, cost = ?, serviced_at = ?, attachments_json = ?,
      remark = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      value.vehicleId,
      value.maintenanceType,
      value.content,
      value.mileageKm,
      value.serviceProvider,
      value.cost,
      value.servicedAt,
      value.attachmentsJson,
      value.remark,
      nowIso(),
      id
    )
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_update",
    target_type: "vehicle_maintenance_record",
    target_id: String(id),
    detail_json: null
  });

  return c.json({ success: true });
});

// POST 作废（管理层，软删除）
vehicleMaintenanceRoutes.post("/:id/void", requireRoles(managerRoles), async (c) => {
  const auth = c.get("auth");
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM vehicle_maintenance_record WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; status: string }>();
  if (!existing) {
    return c.json({ success: false, error: { message: "Record not found" } }, 404);
  }
  if (existing.status === "voided") {
    return c.json({ success: false, error: { message: "Already voided" } }, 400);
  }

  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE vehicle_maintenance_record SET
      status = 'voided', voided_by_userid = ?, voided_at = ?, void_reason = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(auth.sub, ts, reason, ts, id)
    .run();

  await appendApiAuditLog(c.env, {
    actor_userid: auth.sub,
    actor_roles_json: JSON.stringify(auth.roles),
    action: "vehicle_maintenance_void",
    target_type: "vehicle_maintenance_record",
    target_id: String(id),
    detail_json: JSON.stringify({ reason })
  });

  return c.json({ success: true });
});
