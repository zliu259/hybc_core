import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

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

  let sql = "SELECT * FROM company_vehicle WHERE 1=1";
  const params: Array<string | number> = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (entityId) {
    sql += " AND entity_id = ?";
    params.push(Number(entityId));
  }
  if (keyword) {
    sql += " AND (current_plate_no LIKE ? OR vehicle_uuid LIKE ? OR owner_name LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  sql += " ORDER BY id DESC";

  const rows = await c.env.DB.prepare(sql).bind(...params).all<CompanyVehicle>();
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

fleetRoutes.get("/fuel-cards", async (c) => {
  const status = c.req.query("status");
  let sql = "SELECT * FROM fuel_card WHERE 1=1";
  const params: string[] = [];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY id DESC";
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

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

fleetRoutes.post(
  "/fuel-cards/:id/bind-vehicle",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const fuelCardId = Number(c.req.param("id"));
    const body = (await c.req.json()) as { vehicle_id: number };
    if (typeof body.vehicle_id !== "number") {
      return c.json({ success: false, error: { message: "vehicle_id is required" } }, 400);
    }

    const ts = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO fuel_card_vehicle_binding (fuel_card_id, vehicle_id, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`
    )
      .bind(fuelCardId, body.vehicle_id, ts, ts)
      .run();

    return c.json({ success: true }, 201);
  }
);

fleetRoutes.get("/fuel-applications", async (c) => {
  const auth = c.get("auth");
  const mine = c.req.query("mine") === "true";
  const status = c.req.query("status");

  let sql = `SELECT
    a.*,
    v.vehicle_uuid,
    v.current_plate_no,
    v.ownership_type,
    card.card_no
   FROM fuel_quota_application a
   JOIN company_vehicle v ON v.id = a.vehicle_id
   LEFT JOIN fuel_card card ON card.id = a.fuel_card_id
   WHERE 1=1`;
  const params: string[] = [];

  if (mine) {
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

fleetRoutes.post(
  "/fuel-applications",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      vehicle_id: number;
      requested_amount: number;
      vehicle_mileage_km: number;
      photo_keys_json?: string;
    };

    if (
      typeof body.vehicle_id !== "number" ||
      typeof body.requested_amount !== "number" ||
      typeof body.vehicle_mileage_km !== "number"
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: "vehicle_id, requested_amount, vehicle_mileage_km are required"
          }
        },
        400
      );
    }

    const ts = nowIso();
    const applicationNo = await generateSerial(c.env.DB, "FQ", "fuel_quota_application", "application_no");

    const result = await c.env.DB.prepare(
      `INSERT INTO fuel_quota_application (
        application_no,
        applicant_userid,
        vehicle_id,
        requested_amount,
        vehicle_mileage_km,
        photo_keys_json,
        status,
        requested_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
      .bind(
        applicationNo,
        auth.sub,
        body.vehicle_id,
        body.requested_amount,
        body.vehicle_mileage_km,
        body.photo_keys_json ?? null,
        ts,
        ts,
        ts
      )
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, application_no: applicationNo } },
      201
    );
  }
);

fleetRoutes.post(
  "/fuel-applications/:id/process",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
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

    const ts = nowIso();
    await c.env.DB.prepare(
      `UPDATE fuel_quota_application SET
        status = ?,
        processed_by_userid = ?,
        processed_at = ?,
        office_remark = ?,
        fuel_card_id = ?,
        latest_card_balance = ?,
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.status,
        auth.sub,
        ts,
        body.office_remark ?? null,
        typeof body.fuel_card_id === "number" ? body.fuel_card_id : null,
        typeof body.latest_card_balance === "number" ? body.latest_card_balance : null,
        ts,
        id
      )
      .run();

    if (
      body.status === "processed" &&
      typeof body.fuel_card_id === "number" &&
      typeof body.latest_card_balance === "number"
    ) {
      await c.env.DB.prepare("UPDATE fuel_card SET latest_balance = ?, updated_at = ? WHERE id = ?")
        .bind(body.latest_card_balance, ts, body.fuel_card_id)
        .run();
    }

    return c.json({ success: true });
  }
);
