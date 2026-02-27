import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type {
  AssetRentalTerm,
  AssetType,
  CreateAssetRentalTermRequest,
  CreateAssetTypeRequest,
  CreateTrackedAssetRequest,
  ReturnAssetRentalTermRequest,
  TrackedAsset,
  TrackedAssetDocument,
  TrackedAssetEvent,
  UpdateAssetTypeRequest,
  UpdateTrackedAssetRequest
} from "../types/asset";

const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

const ensureJsonText = (value?: string): string | null => {
  if (!value || !value.trim()) return null;
  JSON.parse(value);
  return value;
};

const generateAssetCode = async (db: D1Database, typeCode: string): Promise<string> => {
  const prefix = `HY-${typeCode.toUpperCase()}-`;
  const row = await db
    .prepare("SELECT IFNULL(COUNT(*), 0) as cnt FROM tracked_asset WHERE asset_code LIKE ?")
    .bind(`${prefix}%`)
    .first<{ cnt: number }>();
  const seq = (row?.cnt ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

export const assetRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

assetRoutes.use("*", authMiddleware);

assetRoutes.get(
  "/type",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const keyword = c.req.query("keyword");
    const trackedFlag = c.req.query("tracked_flag");
    let sql = "SELECT * FROM asset_type WHERE status != 'deleted'";
    const params: (string | number)[] = [];

    if (trackedFlag) {
      sql += " AND tracked_flag = ?";
      params.push(Number(trackedFlag));
    }
    if (keyword) {
      sql += " AND (type_code LIKE ? OR type_name LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql).bind(...params).all<AssetType>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.post(
  "/type",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const body = (await c.req.json()) as CreateAssetTypeRequest;
    if (!body.type_code?.trim() || !body.type_name?.trim()) {
      return c.json({ success: false, error: { message: "type_code and type_name are required" } }, 400);
    }

    let propertySchema: string | null = null;
    try {
      propertySchema = ensureJsonText(body.property_schema);
    } catch {
      return c.json({ success: false, error: { message: "property_schema must be valid JSON" } }, 400);
    }

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO asset_type
        (type_code, type_name, tracked_flag, unit, property_schema, min_stock, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(
        body.type_code.trim().toUpperCase(),
        body.type_name.trim(),
        body.tracked_flag ? 1 : 0,
        body.unit?.trim() || "件",
        propertySchema,
        body.min_stock ?? null,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

assetRoutes.put(
  "/type/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateAssetTypeRequest;

    let propertySchema: string | null = null;
    try {
      propertySchema = body.property_schema === undefined ? null : ensureJsonText(body.property_schema);
    } catch {
      return c.json({ success: false, error: { message: "property_schema must be valid JSON" } }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE asset_type SET
         type_name = COALESCE(?, type_name),
         tracked_flag = COALESCE(?, tracked_flag),
         unit = COALESCE(?, unit),
         property_schema = CASE WHEN ? IS NULL THEN property_schema ELSE ? END,
         min_stock = COALESCE(?, min_stock),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.type_name ?? null,
        body.tracked_flag === undefined ? null : body.tracked_flag ? 1 : 0,
        body.unit ?? null,
        body.property_schema === undefined ? null : propertySchema,
        propertySchema,
        body.min_stock ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

assetRoutes.delete(
  "/type/:id",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare("UPDATE asset_type SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(nowIso(), id)
      .run();
    return c.json({ success: true });
  }
);

assetRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const assetTypeId = c.req.query("asset_type_id");
    const status = c.req.query("status");
    const projectId = c.req.query("project_id");
    const warehouseId = c.req.query("warehouse_id");
    const ownershipType = c.req.query("ownership_type");
    const keyword = c.req.query("keyword");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM tracked_asset WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM tracked_asset WHERE 1=1";
    const params: (string | number)[] = [];

    if (assetTypeId) {
      sql += " AND asset_type_id = ?";
      countSql += " AND asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    if (status) {
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(status);
    }
    if (projectId) {
      sql += " AND current_project_id = ?";
      countSql += " AND current_project_id = ?";
      params.push(Number(projectId));
    }
    if (warehouseId) {
      sql += " AND current_warehouse_id = ?";
      countSql += " AND current_warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (ownershipType) {
      sql += " AND ownership_type = ?";
      countSql += " AND ownership_type = ?";
      params.push(ownershipType);
    }
    if (keyword) {
      sql += " AND (asset_code LIKE ? OR asset_name LIKE ? OR IFNULL(serial_no, '') LIKE ?)";
      countSql += " AND (asset_code LIKE ? OR asset_name LIKE ? OR IFNULL(serial_no, '') LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<TrackedAsset>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

assetRoutes.get(
  "/dashboard/overview",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const byType = await c.env.DB.prepare(
      `SELECT at.type_code, at.type_name, COUNT(*) as cnt
       FROM tracked_asset ta
       JOIN asset_type at ON at.id = ta.asset_type_id
       GROUP BY at.id
       ORDER BY cnt DESC`
    ).all();

    const byStatus = await c.env.DB.prepare(
      "SELECT status, COUNT(*) as cnt FROM tracked_asset GROUP BY status"
    ).all();

    const byLocation = await c.env.DB.prepare(
      "SELECT IFNULL(current_location, '-') as location, COUNT(*) as cnt FROM tracked_asset GROUP BY current_location"
    ).all();

    return c.json({
      success: true,
      data: {
        by_type: byType.results ?? [],
        by_status: byStatus.results ?? [],
        by_location: byLocation.results ?? []
      }
    });
  }
);

assetRoutes.get(
  "/dashboard/project/:projectId",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const projectId = Number(c.req.param("projectId"));

    const assets = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset WHERE current_project_id = ? ORDER BY id DESC"
    )
      .bind(projectId)
      .all<TrackedAsset>();

    const activeRentalTerms = await c.env.DB.prepare(
      `SELECT tracked_asset_id, rental_mode, due_date, status,
              CASE
                WHEN returned_date IS NOT NULL THEN 0
                WHEN date(due_date) < date(?) THEN CAST(julianday(date(?)) - julianday(date(due_date)) AS INTEGER)
                ELSE 0
              END AS overdue_days
       FROM asset_rental_term
       WHERE project_id = ? AND status IN ('active', 'overdue') AND returned_date IS NULL`
    )
      .bind(todayIso(), todayIso(), projectId)
      .all<{
        tracked_asset_id: number;
        rental_mode: string;
        due_date: string;
        status: string;
        overdue_days: number;
      }>();
    const rentalMap = new Map(
      (activeRentalTerms.results ?? []).map((item) => [item.tracked_asset_id, item])
    );

    const consumptions = await c.env.DB.prepare(
      `SELECT ic.asset_type_id, at.type_name, IFNULL(SUM(ic.quantity), 0) as total_qty
       FROM inventory_consumption ic
       JOIN asset_type at ON at.id = ic.asset_type_id
       WHERE ic.project_id = ?
       GROUP BY ic.asset_type_id
       ORDER BY total_qty DESC`
    )
      .bind(projectId)
      .all();

    return c.json({
      success: true,
      data: {
        tracked_assets: (assets.results ?? []).map((item) => {
          const rental = rentalMap.get(item.id);
          return {
            ...item,
            rental_mode: rental?.rental_mode ?? null,
            rental_due_date: rental?.due_date ?? null,
            rental_status: rental?.status ?? null,
            rental_overdue_days: rental?.overdue_days ?? 0
          };
        }),
        consumptions: consumptions.results ?? [],
        rental_alert: {
          active_count: (activeRentalTerms.results ?? []).length,
          overdue_count: (activeRentalTerms.results ?? []).filter((item) => item.overdue_days > 0).length
        }
      }
    });
  }
);

assetRoutes.get(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const asset = await c.env.DB.prepare("SELECT * FROM tracked_asset WHERE id = ?")
      .bind(id)
      .first<TrackedAsset>();

    if (!asset) {
      return c.json({ success: false, error: { message: "Asset not found" } }, 404);
    }

    const docs = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_document WHERE tracked_asset_id = ? AND status = 'active' ORDER BY id DESC"
    )
      .bind(id)
      .all<TrackedAssetDocument>();

    const events = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_event WHERE tracked_asset_id = ? ORDER BY event_time DESC"
    )
      .bind(id)
      .all<TrackedAssetEvent>();

    return c.json({ success: true, data: { ...asset, documents: docs.results ?? [], events: events.results ?? [] } });
  }
);

assetRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateTrackedAssetRequest;
    if (!body.asset_type_id || !body.asset_name?.trim()) {
      return c.json({ success: false, error: { message: "asset_type_id and asset_name are required" } }, 400);
    }

    const type = await c.env.DB.prepare("SELECT * FROM asset_type WHERE id = ? AND status != 'deleted'")
      .bind(body.asset_type_id)
      .first<AssetType>();
    if (!type) {
      return c.json({ success: false, error: { message: "Asset type not found" } }, 404);
    }
    if (type.tracked_flag !== 1) {
      return c.json({ success: false, error: { message: "Only tracked asset type can create tracked asset" } }, 400);
    }

    let propertiesJson: string | null = null;
    try {
      propertiesJson = ensureJsonText(body.properties_json);
    } catch {
      return c.json({ success: false, error: { message: "properties_json must be valid JSON" } }, 400);
    }

    const assetCode = await generateAssetCode(c.env.DB, type.type_code);
    const now = nowIso();
    const ownershipType = body.ownership_type ?? "owned";
    if (ownershipType !== "owned" && ownershipType !== "leased_in") {
      return c.json({ success: false, error: { message: "ownership_type must be owned or leased_in" } }, 400);
    }
    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset
        (asset_code, asset_type_id, asset_name, brand, model, serial_no, status,
         current_project_id, current_warehouse_id, current_location, properties_json,
         purchased_date, ownership_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        assetCode,
        body.asset_type_id,
        body.asset_name.trim(),
        body.brand ?? null,
        body.model ?? null,
        body.serial_no ?? null,
        body.current_project_id ?? null,
        body.current_warehouse_id ?? null,
        body.current_location ?? null,
        propertiesJson,
        body.purchased_date ?? null,
        ownershipType,
        now,
        now
      )
      .run();

    const assetId = result.meta.last_row_id as number;
    await c.env.DB.prepare(
      `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, 'create', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        assetId,
        now,
        auth.sub,
        body.current_project_id ?? null,
        body.current_warehouse_id ?? null,
        "资产建档",
        now
      )
      .run();

    return c.json({ success: true, data: { id: assetId, asset_code: assetCode } }, 201);
  }
);

assetRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as UpdateTrackedAssetRequest;

    if (
      body.ownership_type !== undefined &&
      body.ownership_type !== "owned" &&
      body.ownership_type !== "leased_in"
    ) {
      return c.json({ success: false, error: { message: "ownership_type must be owned or leased_in" } }, 400);
    }

    let propertiesJson: string | null = null;
    try {
      propertiesJson = body.properties_json === undefined ? null : ensureJsonText(body.properties_json);
    } catch {
      return c.json({ success: false, error: { message: "properties_json must be valid JSON" } }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE tracked_asset SET
         asset_name = COALESCE(?, asset_name),
         brand = COALESCE(?, brand),
         model = COALESCE(?, model),
         serial_no = COALESCE(?, serial_no),
         status = COALESCE(?, status),
         current_project_id = COALESCE(?, current_project_id),
         current_warehouse_id = COALESCE(?, current_warehouse_id),
         current_location = COALESCE(?, current_location),
         properties_json = CASE WHEN ? IS NULL THEN properties_json ELSE ? END,
         purchased_date = COALESCE(?, purchased_date),
         ownership_type = COALESCE(?, ownership_type),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.asset_name ?? null,
        body.brand ?? null,
        body.model ?? null,
        body.serial_no ?? null,
        body.status ?? null,
        body.current_project_id ?? null,
        body.current_warehouse_id ?? null,
        body.current_location ?? null,
        body.properties_json === undefined ? null : propertiesJson,
        propertiesJson,
        body.purchased_date ?? null,
        body.ownership_type ?? null,
        nowIso(),
        id
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, 'update', ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        nowIso(),
        auth.sub,
        body.current_project_id ?? null,
        body.current_warehouse_id ?? null,
        "资产更新",
        nowIso()
      )
      .run();

    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/:id/document",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as {
      doc_type: string;
      file_key: string;
      file_name?: string;
      remark?: string;
    };

    if (!body.doc_type?.trim() || !body.file_key?.trim()) {
      return c.json({ success: false, error: { message: "doc_type and file_key are required" } }, 400);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset_document
        (tracked_asset_id, doc_type, file_key, file_name, remark, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(id, body.doc_type, body.file_key, body.file_name ?? null, body.remark ?? null, nowIso())
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

assetRoutes.get(
  "/:id/document",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_document WHERE tracked_asset_id = ? AND status = 'active' ORDER BY id DESC"
    )
      .bind(id)
      .all<TrackedAssetDocument>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.delete(
  "/:id/document/:docId",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const docId = Number(c.req.param("docId"));
    await c.env.DB.prepare("UPDATE tracked_asset_document SET status = 'deleted' WHERE id = ?")
      .bind(docId)
      .run();
    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/:id/event",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      event_type: string;
      event_time?: string;
      project_id?: number;
      warehouse_id?: number;
      detail?: string;
    };

    if (!body.event_type?.trim()) {
      return c.json({ success: false, error: { message: "event_type is required" } }, 400);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.event_type,
        body.event_time ?? nowIso(),
        auth.sub,
        body.project_id ?? null,
        body.warehouse_id ?? null,
        body.detail ?? null,
        nowIso()
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

assetRoutes.get(
  "/:id/event",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await c.env.DB.prepare(
      "SELECT * FROM tracked_asset_event WHERE tracked_asset_id = ? ORDER BY event_time DESC"
    )
      .bind(id)
      .all<TrackedAssetEvent>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

assetRoutes.get(
  "/rental/term",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const rentalMode = c.req.query("rental_mode");
    const projectId = c.req.query("project_id");
    const overdueOnly = c.req.query("overdue_only") === "1";

    let sql =
      "SELECT t.*, ta.asset_code, ta.asset_name, ta.ownership_type, p.project_name FROM asset_rental_term t JOIN tracked_asset ta ON ta.id = t.tracked_asset_id LEFT JOIN project p ON p.id = t.project_id WHERE 1=1";
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND t.status = ?";
      params.push(status);
    }
    if (rentalMode) {
      sql += " AND t.rental_mode = ?";
      params.push(rentalMode);
    }
    if (projectId) {
      sql += " AND t.project_id = ?";
      params.push(Number(projectId));
    }
    if (overdueOnly) {
      sql += " AND t.status IN ('active', 'overdue') AND t.returned_date IS NULL AND date(t.due_date) < date(?)";
      params.push(todayIso());
    }
    sql += " ORDER BY t.id DESC";

    const rows = await c.env.DB.prepare(sql).bind(...params).all<AssetRentalTerm>();
    const data = (rows.results ?? []).map((item) => {
      const overdueDays =
        item.returned_date || !item.due_date
          ? 0
          : Math.max(
              0,
              Math.floor(
                (Date.parse(todayIso()) - Date.parse(item.due_date.slice(0, 10))) /
                  (24 * 60 * 60 * 1000)
              )
            );
      return {
        ...item,
        overdue_days: overdueDays
      };
    });

    return c.json({ success: true, data });
  }
);

assetRoutes.post(
  "/rental/term",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateAssetRentalTermRequest;

    if (!body.tracked_asset_id || !body.start_date || !body.due_date) {
      return c.json(
        { success: false, error: { message: "tracked_asset_id, start_date and due_date are required" } },
        400
      );
    }
    if (!["lease_in", "lease_out"].includes(body.rental_mode)) {
      return c.json({ success: false, error: { message: "rental_mode must be lease_in or lease_out" } }, 400);
    }

    const activeTerm = await c.env.DB.prepare(
      "SELECT id FROM asset_rental_term WHERE tracked_asset_id = ? AND status IN ('active', 'overdue') AND returned_date IS NULL LIMIT 1"
    )
      .bind(body.tracked_asset_id)
      .first<{ id: number }>();
    if (activeTerm) {
      return c.json(
        { success: false, error: { message: "asset already has active rental term" } },
        400
      );
    }

    const rentalNo = await generateSerial(c.env.DB, "RL", "asset_rental_term", "rental_no");
    const now = nowIso();
    const status = Date.parse(body.due_date) < Date.parse(todayIso()) ? "overdue" : "active";

    const result = await c.env.DB.prepare(
      `INSERT INTO asset_rental_term
        (rental_no, tracked_asset_id, rental_mode, project_id, contract_id, finance_mode,
         start_date, due_date, returned_date, status, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    )
      .bind(
        rentalNo,
        body.tracked_asset_id,
        body.rental_mode,
        body.project_id ?? null,
        body.contract_id ?? null,
        body.finance_mode ?? "contract",
        body.start_date,
        body.due_date,
        status,
        body.note ?? null,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, rental_no: rentalNo, status } },
      201
    );
  }
);

assetRoutes.post(
  "/rental/term/:id/return",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as ReturnAssetRentalTermRequest;
    const returnedDate = body.returned_date ?? todayIso();

    const term = await c.env.DB.prepare("SELECT * FROM asset_rental_term WHERE id = ?")
      .bind(id)
      .first<AssetRentalTerm>();
    if (!term) {
      return c.json({ success: false, error: { message: "rental term not found" } }, 404);
    }
    if (term.returned_date) {
      return c.json({ success: false, error: { message: "rental term already returned" } }, 400);
    }

    await c.env.DB.prepare(
      "UPDATE asset_rental_term SET returned_date = ?, status = 'returned', note = COALESCE(?, note), updated_at = ? WHERE id = ?"
    )
      .bind(returnedDate, body.note ?? null, nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

assetRoutes.post(
  "/rental/term/scan-overdue",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const now = nowIso();
    const due = todayIso();
    const result = await c.env.DB.prepare(
      "UPDATE asset_rental_term SET status = 'overdue', updated_at = ? WHERE status = 'active' AND returned_date IS NULL AND date(due_date) < date(?)"
    )
      .bind(now, due)
      .run();

    return c.json({ success: true, data: { updated: result.meta.changes ?? 0 } });
  }
);
