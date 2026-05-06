import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type {
  CreateWarehouseManualRequest,
  CreateWarehouseManualVersionRequest,
  WarehouseManual,
  WarehouseManualBinding,
  WarehouseManualType,
  WarehouseManualVersion,
  UpsertWarehouseManualBindingRequest
} from "../types/warehouse-manual";

const nowIso = () => new Date().toISOString();

const manualTypes = new Set([
  "operation",
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "safety"
]);

const ensureManualType = (value?: string): WarehouseManualType => {
  const next = value || "operation";
  if (!manualTypes.has(next)) {
    throw new Error(
      "manual_type must be operation/inspection/maintenance/servicing/modification/safety"
    );
  }
  return next as WarehouseManualType;
};

export const warehouseManualRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

warehouseManualRoutes.use("*", authMiddleware);

warehouseManualRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const manualType = c.req.query("manual_type");
    const assetTypeId = c.req.query("asset_type_id");
    let sql = `
      SELECT wm.*,
             latest.version_no AS latest_version_no,
             active.id AS active_version_id
      FROM warehouse_manual wm
      LEFT JOIN warehouse_manual_version latest
        ON latest.id = (
          SELECT id FROM warehouse_manual_version
          WHERE manual_id = wm.id
          ORDER BY version_no DESC
          LIMIT 1
        )
      LEFT JOIN warehouse_manual_version active
        ON active.id = (
          SELECT id FROM warehouse_manual_version
          WHERE manual_id = wm.id AND status = 'published'
          ORDER BY version_no DESC
          LIMIT 1
        )
      WHERE 1=1`;
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND wm.status = ?";
      params.push(status);
    }
    if (manualType) {
      sql += " AND wm.manual_type = ?";
      params.push(manualType);
    }
    if (assetTypeId) {
      sql += " AND wm.asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    sql += " ORDER BY wm.id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<WarehouseManual>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseManualRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateWarehouseManualRequest;
    if (!body.manual_title?.trim()) {
      return c.json({ success: false, error: { message: "manual_title is required" } }, 400);
    }

    let manualType: WarehouseManualType;
    try {
      manualType = ensureManualType(body.manual_type);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    const manualCode = await generateSerial(c.env.DB, "MAN", "warehouse_manual", "manual_code");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_manual
        (manual_code, manual_title, manual_type, asset_type_id, status, owner_userid, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
      .bind(
        manualCode,
        body.manual_title.trim(),
        manualType,
        body.asset_type_id ?? null,
        body.owner_userid ?? auth.sub,
        now,
        now
      )
      .run();

    const manualId = result.meta.last_row_id as number;
    await c.env.DB.prepare(
      `INSERT INTO warehouse_manual_version
        (manual_id, version_no, content_json, ai_draft_task_id, ai_draft_status, status,
         published_by_userid, published_at, created_by_userid, created_at, updated_at)
       VALUES (?, 1, ?, NULL, 'none', 'draft', NULL, NULL, ?, ?, ?)`
    )
      .bind(manualId, body.content_json ?? "{}", auth.sub, now, now)
      .run();

    return c.json({ success: true, data: { id: manualId, manual_code: manualCode } }, 201);
  }
);

warehouseManualRoutes.get(
  "/binding",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const manualId = c.req.query("manual_id");
    const assetTypeId = c.req.query("asset_type_id");
    const assetModel = c.req.query("asset_model");
    const workOrderType = c.req.query("work_order_type");
    const status = c.req.query("status");
    let sql = `
      SELECT wmb.*,
             wm.manual_title,
             wm.manual_type,
             active.id AS active_version_id,
             active.version_no AS active_version_no
      FROM warehouse_manual_binding wmb
      JOIN warehouse_manual wm ON wm.id = wmb.manual_id
      LEFT JOIN warehouse_manual_version active
        ON active.id = (
          SELECT id FROM warehouse_manual_version
          WHERE manual_id = wm.id AND status = 'published'
          ORDER BY version_no DESC
          LIMIT 1
        )
      WHERE 1=1`;
    const params: Array<string | number> = [];
    if (manualId) {
      sql += " AND wmb.manual_id = ?";
      params.push(Number(manualId));
    }
    if (assetTypeId) {
      sql += " AND wmb.asset_type_id = ?";
      params.push(Number(assetTypeId));
    }
    if (assetModel) {
      sql += " AND lower(wmb.asset_model) = lower(?)";
      params.push(assetModel.trim());
    }
    if (workOrderType) {
      sql += " AND wmb.work_order_type = ?";
      params.push(workOrderType);
    }
    if (status) {
      sql += " AND wmb.status = ?";
      params.push(status);
    }
    sql += " ORDER BY wmb.id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<WarehouseManualBinding>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseManualRoutes.post(
  "/binding",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const body = (await c.req.json()) as UpsertWarehouseManualBindingRequest;
    if (!body.manual_id) {
      return c.json({ success: false, error: { message: "manual_id is required" } }, 400);
    }
    const manual = await c.env.DB.prepare("SELECT id FROM warehouse_manual WHERE id = ?")
      .bind(body.manual_id)
      .first<{ id: number }>();
    if (!manual) {
      return c.json({ success: false, error: { message: "manual not found" } }, 404);
    }

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_manual_binding
        (manual_id, asset_type_id, asset_model, work_order_type, configuration_role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.manual_id,
        body.asset_type_id ?? null,
        body.asset_model?.trim() || null,
        body.work_order_type ?? null,
        body.configuration_role ?? null,
        body.status ?? "active",
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

warehouseManualRoutes.put(
  "/binding/:bindingId",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const bindingId = Number(c.req.param("bindingId"));
    const body = (await c.req.json()) as Partial<UpsertWarehouseManualBindingRequest>;
    const existing = await c.env.DB.prepare("SELECT id FROM warehouse_manual_binding WHERE id = ?")
      .bind(bindingId)
      .first<{ id: number }>();
    if (!existing) {
      return c.json({ success: false, error: { message: "manual binding not found" } }, 404);
    }

    await c.env.DB.prepare(
      `UPDATE warehouse_manual_binding SET
         manual_id = COALESCE(?, manual_id),
         asset_type_id = CASE WHEN ? IS NULL THEN asset_type_id ELSE ? END,
         asset_model = CASE WHEN ? IS NULL THEN asset_model ELSE ? END,
         work_order_type = CASE WHEN ? IS NULL THEN work_order_type ELSE ? END,
         configuration_role = CASE WHEN ? IS NULL THEN configuration_role ELSE ? END,
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.manual_id ?? null,
        body.asset_type_id === undefined ? null : 1,
        body.asset_type_id ?? null,
        body.asset_model === undefined ? null : 1,
        body.asset_model?.trim() || null,
        body.work_order_type === undefined ? null : 1,
        body.work_order_type ?? null,
        body.configuration_role === undefined ? null : 1,
        body.configuration_role ?? null,
        body.status ?? null,
        nowIso(),
        bindingId
      )
      .run();

    return c.json({ success: true });
  }
);

warehouseManualRoutes.get(
  "/:id/version",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await c.env.DB.prepare(
      "SELECT * FROM warehouse_manual_version WHERE manual_id = ? ORDER BY version_no DESC"
    )
      .bind(id)
      .all<WarehouseManualVersion>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseManualRoutes.post(
  "/:id/version",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateWarehouseManualVersionRequest;
    if (!body.content_json?.trim()) {
      return c.json({ success: false, error: { message: "content_json is required" } }, 400);
    }

    const manual = await c.env.DB.prepare("SELECT id FROM warehouse_manual WHERE id = ?")
      .bind(id)
      .first<{ id: number }>();
    if (!manual) {
      return c.json({ success: false, error: { message: "manual not found" } }, 404);
    }

    const latest = await c.env.DB.prepare(
      "SELECT MAX(version_no) AS version_no FROM warehouse_manual_version WHERE manual_id = ?"
    )
      .bind(id)
      .first<{ version_no: number | null }>();
    const nextVersion = Number(latest?.version_no ?? 0) + 1;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_manual_version
        (manual_id, version_no, content_json, ai_draft_task_id, ai_draft_status, status,
         published_by_userid, published_at, created_by_userid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?, ?)`
    )
      .bind(
        id,
        nextVersion,
        body.content_json,
        body.ai_draft_task_id ?? null,
        body.ai_draft_status ?? "none",
        auth.sub,
        now,
        now
      )
      .run();

    await c.env.DB.prepare("UPDATE warehouse_manual SET updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, version_no: nextVersion } },
      201
    );
  }
);

warehouseManualRoutes.post(
  "/:id/version/:versionId/publish",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const versionId = Number(c.req.param("versionId"));
    const auth = c.get("auth");
    const version = await c.env.DB.prepare(
      "SELECT id FROM warehouse_manual_version WHERE id = ? AND manual_id = ?"
    )
      .bind(versionId, id)
      .first<{ id: number }>();
    if (!version) {
      return c.json({ success: false, error: { message: "manual version not found" } }, 404);
    }

    const now = nowIso();
    await c.env.DB.prepare(
      "UPDATE warehouse_manual_version SET status = 'archived', updated_at = ? WHERE manual_id = ? AND status = 'published'"
    )
      .bind(now, id)
      .run();
    await c.env.DB.prepare(
      `UPDATE warehouse_manual_version SET
         status = 'published',
         published_by_userid = ?,
         published_at = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(auth.sub, now, now, versionId)
      .run();
    await c.env.DB.prepare(
      "UPDATE warehouse_manual SET status = 'active', updated_at = ? WHERE id = ?"
    )
      .bind(now, id)
      .run();

    return c.json({ success: true });
  }
);
