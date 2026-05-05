import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";
import {
  assignWarehouseTask,
  cancelWarehouseTask,
  createWarehouseTask,
  emitWarehouseTaskTimelineEvent,
  reviewWarehouseTask,
  startWarehouseTask,
  submitWarehouseTask
} from "../services/warehouse-task";
import type { Env } from "../types/env";
import type { AuthTokenPayload } from "../types/auth";
import type {
  CompleteWarehouseAssetWorkOrderRequest,
  CreateWarehouseAssetWorkOrderRequest,
  SubmitWarehouseAssetWorkOrderApprovalRequest,
  UpdateWarehouseAssetWorkOrderRequest,
  WarehouseAssetWorkOrder,
  WarehouseAssetWorkOrderType,
  WarehouseTaskEvidence
} from "../types/work-order";

const nowIso = () => new Date().toISOString();

const WORK_ORDER_TYPES = new Set([
  "inspection",
  "maintenance",
  "servicing",
  "modification",
  "scrapping"
]);
const ensureWorkOrderType = (value: string): WarehouseAssetWorkOrderType => {
  if (!WORK_ORDER_TYPES.has(value)) {
    throw new Error(
      "work_order_type must be inspection/maintenance/servicing/modification/scrapping"
    );
  }
  return value as WarehouseAssetWorkOrderType;
};

const validateRelations = async (
  env: Env,
  payload: {
    tracked_asset_id?: number | null;
    tracked_asset_configuration_id?: number | null;
    stock_order_id?: number | null;
    project_id?: number | null;
    warehouse_id?: number | null;
  }
) => {
  if (
    !payload.tracked_asset_id &&
    !payload.tracked_asset_configuration_id &&
    !payload.stock_order_id
  ) {
    throw new Error(
      "tracked_asset_id or tracked_asset_configuration_id or stock_order_id is required"
    );
  }
  if (payload.tracked_asset_id) {
    const asset = await env.DB.prepare("SELECT id FROM tracked_asset WHERE id = ?")
      .bind(payload.tracked_asset_id)
      .first<{ id: number }>();
    if (!asset) throw new Error("tracked_asset_id not found");
  }
  if (payload.tracked_asset_configuration_id) {
    const configuration = await env.DB.prepare(
      "SELECT id FROM tracked_asset_configuration WHERE id = ?"
    )
      .bind(payload.tracked_asset_configuration_id)
      .first<{ id: number }>();
    if (!configuration) throw new Error("tracked_asset_configuration_id not found");
  }
  if (payload.stock_order_id) {
    const stockOrder = await env.DB.prepare("SELECT id FROM stock_order WHERE id = ?")
      .bind(payload.stock_order_id)
      .first<{ id: number }>();
    if (!stockOrder) throw new Error("stock_order_id not found");
  }
  if (payload.project_id) {
    const project = await env.DB.prepare("SELECT id FROM project WHERE id = ?")
      .bind(payload.project_id)
      .first<{ id: number }>();
    if (!project) throw new Error("project_id not found");
  }
  if (payload.warehouse_id) {
    const warehouse = await env.DB.prepare("SELECT id FROM warehouse WHERE id = ?")
      .bind(payload.warehouse_id)
      .first<{ id: number }>();
    if (!warehouse) throw new Error("warehouse_id not found");
  }
};

const ensureWarehouseTaskOwnerAuthority = async (
  env: Env,
  auth: AuthTokenPayload,
  workOrderId: number
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> => {
  if (auth.roles.includes("super_admin")) return { ok: true };

  const row = await env.DB.prepare(
    "SELECT id, warehouse_id FROM warehouse_asset_work_order WHERE id = ?"
  )
    .bind(workOrderId)
    .first<{ id: number; warehouse_id: number | null }>();
  if (!row) {
    return { ok: false, status: 404, message: "work order not found" };
  }
  if (!row.warehouse_id) {
    return {
      ok: false,
      status: 403,
      message: "only super_admin can dispatch work order without warehouse_id"
    };
  }

  const warehouse = await env.DB.prepare(
    "SELECT manager_userid FROM warehouse WHERE id = ? AND status != 'deleted'"
  )
    .bind(row.warehouse_id)
    .first<{ manager_userid: string | null }>();
  if (!warehouse || warehouse.manager_userid !== auth.sub) {
    return {
      ok: false,
      status: 403,
      message: "only warehouse manager or super_admin can dispatch this task"
    };
  }

  return { ok: true };
};

export const warehouseAssetWorkOrderRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

warehouseAssetWorkOrderRoutes.use("*", authMiddleware);

warehouseAssetWorkOrderRoutes.get(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const status = c.req.query("status");
    const workOrderType = c.req.query("work_order_type");
    const trackedAssetId = c.req.query("tracked_asset_id");
    const projectId = c.req.query("project_id");
    const warehouseId = c.req.query("warehouse_id");
    const blockingFlag = c.req.query("blocking_flag");
    const source = c.req.query("source");
    const assigneeUserid = c.req.query("assignee_userid");

    let sql = "SELECT * FROM warehouse_asset_work_order WHERE 1=1";
    const params: Array<string | number> = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (workOrderType) {
      sql += " AND work_order_type = ?";
      params.push(workOrderType);
    }
    if (trackedAssetId) {
      sql += " AND tracked_asset_id = ?";
      params.push(Number(trackedAssetId));
    }
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (warehouseId) {
      sql += " AND warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (blockingFlag) {
      sql += " AND blocking_flag = ?";
      params.push(Number(blockingFlag));
    }
    if (source) {
      sql += " AND source = ?";
      params.push(source);
    }
    if (assigneeUserid) {
      sql += " AND assignee_userid = ?";
      params.push(assigneeUserid);
    }

    sql += " ORDER BY id DESC";
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<WarehouseAssetWorkOrder>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) {
      return c.json({ success: false, error: { message: "work order not found" } }, 404);
    }
    return c.json({ success: true, data: row });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/:id/evidence",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT id FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<{ id: number }>();
    if (!row) {
      return c.json({ success: false, error: { message: "work order not found" } }, 404);
    }

    const evidence = await c.env.DB.prepare(
      `SELECT *
       FROM warehouse_task_evidence
       WHERE work_order_id = ?
       ORDER BY captured_at DESC, id DESC`
    )
      .bind(id)
      .all<WarehouseTaskEvidence>();

    return c.json({ success: true, data: evidence.results ?? [] });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateWarehouseAssetWorkOrderRequest;

    let workOrderType: WarehouseAssetWorkOrderType;
    try {
      workOrderType = ensureWorkOrderType(body.work_order_type);
      await validateRelations(c.env, body);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    const result = await createWarehouseTask(c.env, {
      ...body,
      work_order_type: workOrderType,
      applicant_userid: auth.sub
    });

    return c.json({ success: true, data: result }, 201);
  }
);

warehouseAssetWorkOrderRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as UpdateWarehouseAssetWorkOrderRequest;
    await c.env.DB.prepare(
      `UPDATE warehouse_asset_work_order SET
       assignee_userid = CASE WHEN ? IS NULL THEN assignee_userid ELSE ? END,
       blocking_flag = COALESCE(?, blocking_flag),
       priority = COALESCE(?, priority),
       package_id = CASE WHEN ? IS NULL THEN package_id ELSE ? END,
       manual_version_id = CASE WHEN ? IS NULL THEN manual_version_id ELSE ? END,
       mobile_enabled = COALESCE(?, mobile_enabled),
       required_photo_count = COALESCE(?, required_photo_count),
       scheduled_date = CASE WHEN ? IS NULL THEN scheduled_date ELSE ? END,
       result_summary = CASE WHEN ? IS NULL THEN result_summary ELSE ? END,
       remark = CASE WHEN ? IS NULL THEN remark ELSE ? END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.assignee_userid === undefined ? null : body.assignee_userid,
        body.assignee_userid ?? null,
        body.blocking_flag ?? null,
        body.priority ?? null,
        body.package_id === undefined ? null : body.package_id,
        body.package_id ?? null,
        body.manual_version_id === undefined ? null : body.manual_version_id,
        body.manual_version_id ?? null,
        body.mobile_enabled ?? null,
        body.required_photo_count ?? null,
        body.scheduled_date === undefined ? null : body.scheduled_date,
        body.scheduled_date ?? null,
        body.result_summary === undefined ? null : body.result_summary,
        body.result_summary ?? null,
        body.remark === undefined ? null : body.remark,
        body.remark ?? null,
        nowIso(),
        id
      )
      .run();
    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/assign",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      assignee_userid?: string;
      package_id?: number | null;
      scheduled_date?: string | null;
      manual_version_id?: number | null;
    };
    if (!body.assignee_userid?.trim()) {
      return c.json({ success: false, error: { message: "assignee_userid is required" } }, 400);
    }

    const authority = await ensureWarehouseTaskOwnerAuthority(c.env, auth, id);
    if (!authority.ok) {
      return c.json({ success: false, error: { message: authority.message } }, authority.status);
    }

    try {
      await assignWarehouseTask(c.env, {
        id,
        assignee_userid: body.assignee_userid.trim(),
        assigned_by_userid: auth.sub,
        package_id: body.package_id,
        scheduled_date: body.scheduled_date,
        manual_version_id: body.manual_version_id
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/submit",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as {
      result_summary?: string | null;
      completion_summary_json?: string | null;
      evidence?: {
        step_id?: number | null;
        tracked_asset_id?: number | null;
        evidence_type: "photo" | "video" | "voice" | "brief" | "document";
        file_key?: string | null;
        file_name?: string | null;
        summary?: string | null;
        captured_at?: string | null;
      }[];
    };

    try {
      await submitWarehouseTask(c.env, {
        id,
        operator_userid: auth.sub,
        result_summary: body.result_summary,
        completion_summary_json: body.completion_summary_json,
        evidence: body.evidence
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/review",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      action?: "approve" | "reject";
      result_summary?: string | null;
    };
    if (body.action !== "approve" && body.action !== "reject") {
      return c.json(
        { success: false, error: { message: "action must be approve or reject" } },
        400
      );
    }

    const authority = await ensureWarehouseTaskOwnerAuthority(c.env, auth, id);
    if (!authority.ok) {
      return c.json({ success: false, error: { message: authority.message } }, authority.status);
    }

    try {
      await reviewWarehouseTask(c.env, {
        id,
        reviewer_userid: auth.sub,
        action: body.action,
        result_summary: body.result_summary
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }

    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req
      .json()
      .catch(() => ({}))) as SubmitWarehouseAssetWorkOrderApprovalRequest;
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (row.status !== "draft") {
      return c.json(
        { success: false, error: { message: "only draft work order can submit approval" } },
        400
      );
    }

    const instance = await submitForApproval(
      c.env,
      {
        biz_type: "warehouse_asset_work_order",
        biz_id: id,
        biz_summary: body.biz_summary?.trim() || `${row.work_order_no} | ${row.work_order_type}`,
        context: {
          biz_type: "warehouse_asset_work_order",
          biz_id: id,
          project_id: row.project_id ?? undefined
        }
      },
      auth.sub,
      createAiGateHandler()
    );

    await c.env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, nowIso(), id)
      .run();

    await emitWarehouseTaskTimelineEvent(
      c.env,
      row,
      auth.sub,
      "work_order_submitted",
      `status=pending_approval; approval_instance_id=${instance.id}`
    );

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/start",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    try {
      await startWarehouseTask(c.env, id, auth.sub);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }
    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/complete",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as CompleteWarehouseAssetWorkOrderRequest;
    const authority = await ensureWarehouseTaskOwnerAuthority(c.env, auth, id);
    if (!authority.ok) {
      return c.json({ success: false, error: { message: authority.message } }, authority.status);
    }

    try {
      await reviewWarehouseTask(c.env, {
        id,
        reviewer_userid: auth.sub,
        action: "approve",
        result_summary: body.result_summary
      });
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }
    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/cancel",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const authority = await ensureWarehouseTaskOwnerAuthority(c.env, auth, id);
    if (!authority.ok) {
      return c.json({ success: false, error: { message: authority.message } }, authority.status);
    }

    try {
      await cancelWarehouseTask(c.env, id, auth.sub);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }
    return c.json({ success: true });
  }
);
