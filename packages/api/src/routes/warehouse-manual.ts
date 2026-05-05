import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type {
  CreateWarehouseManualRequest,
  CreateWarehouseManualVersionRequest,
  WarehouseManual,
  WarehouseManualType,
  WarehouseManualVersion
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
