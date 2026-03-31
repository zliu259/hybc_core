import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler } from "../services/ai-slot";
import {
  emitTrackedAssetEvents,
  getConfigurationParticipants
} from "../services/asset-event";
import { submitForApproval } from "../services/approval/engine";
import { generateSerial } from "../services/serial";
import type { TrackedAsset } from "../types/asset";
import type { Env } from "../types/env";
import type {
  CompleteWarehouseAssetWorkOrderRequest,
  CreateWarehouseAssetWorkOrderRequest,
  SubmitWarehouseAssetWorkOrderApprovalRequest,
  UpdateWarehouseAssetWorkOrderRequest,
  WarehouseAssetWorkOrder,
  WarehouseAssetWorkOrderType
} from "../types/work-order";

const nowIso = () => new Date().toISOString();

const WORK_ORDER_TYPES = new Set(["inspection", "maintenance", "servicing", "modification", "scrapping"]);
const ensureWorkOrderType = (value: string): WarehouseAssetWorkOrderType => {
  if (!WORK_ORDER_TYPES.has(value)) {
    throw new Error("work_order_type must be inspection/maintenance/servicing/modification/scrapping");
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
    throw new Error("tracked_asset_id or tracked_asset_configuration_id or stock_order_id is required");
  }
  if (payload.tracked_asset_id) {
    const asset = await env.DB.prepare("SELECT id FROM tracked_asset WHERE id = ?")
      .bind(payload.tracked_asset_id)
      .first<{ id: number }>();
    if (!asset) throw new Error("tracked_asset_id not found");
  }
  if (payload.tracked_asset_configuration_id) {
    const configuration = await env.DB.prepare("SELECT id FROM tracked_asset_configuration WHERE id = ?")
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

const resolveWorkOrderAffectedAssetIds = async (
  env: Env,
  payload: {
    tracked_asset_id?: number | null;
    tracked_asset_configuration_id?: number | null;
  }
): Promise<number[]> => {
  const ids = new Set<number>();
  if (payload.tracked_asset_id) ids.add(payload.tracked_asset_id);
  if (payload.tracked_asset_configuration_id) {
    const participants = await getConfigurationParticipants(env.DB, payload.tracked_asset_configuration_id);
    for (const participant of participants) ids.add(participant.tracked_asset_id);
  }
  return [...ids];
};

const setTrackedAssetStatusForWorkOrder = async (
  env: Env,
  trackedAssetIds: number[],
  type: WarehouseAssetWorkOrderType,
  mode: "start" | "complete" | "cancel"
) => {
  if (trackedAssetIds.length === 0) return;
  for (const trackedAssetId of trackedAssetIds) {
    const asset = await env.DB.prepare("SELECT * FROM tracked_asset WHERE id = ?")
      .bind(trackedAssetId)
      .first<TrackedAsset>();
    if (!asset) continue;

    let nextStatus: string | null = null;
    if (mode === "start") {
      if (type === "inspection") nextStatus = "inspection";
      else if (type === "maintenance") nextStatus = "maintenance";
      else if (type === "servicing") nextStatus = "servicing";
      else if (type === "modification") nextStatus = "modification";
      else if (type === "scrapping") nextStatus = "scrapped";
    } else if (mode === "complete") {
      nextStatus = type === "scrapping" ? "scrapped" : "idle";
    } else if (mode === "cancel") {
      nextStatus = asset.status === "scrapped" ? "scrapped" : "idle";
    }

    if (!nextStatus) continue;
    await env.DB.prepare(
      "UPDATE tracked_asset SET status = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nextStatus, nowIso(), trackedAssetId)
      .run();
  }
};

const emitWorkOrderTimelineEvent = async (
  env: Env,
  payload: {
    tracked_asset_id?: number | null;
    tracked_asset_configuration_id?: number | null;
    work_order_no: string;
    work_order_type: WarehouseAssetWorkOrderType;
    project_id?: number | null;
    warehouse_id?: number | null;
  },
  operatorUserid: string,
  eventType:
    | "work_order_created"
    | "work_order_submitted"
    | "work_order_started"
    | "work_order_completed"
    | "work_order_cancelled",
  detailSuffix?: string
) => {
  const eventTime = nowIso();
  const assetIds = await resolveWorkOrderAffectedAssetIds(env, payload);
  if (assetIds.length === 0) return;
  await emitTrackedAssetEvents(
    env.DB,
    assetIds.map((trackedAssetId) => ({
      tracked_asset_id: trackedAssetId,
      event_type: eventType,
      event_time: eventTime,
      operator_userid: operatorUserid,
      project_id: payload.project_id ?? null,
      warehouse_id: payload.warehouse_id ?? null,
      detail: `work_order_no=${payload.work_order_no}; type=${payload.work_order_type}${detailSuffix ? `; ${detailSuffix}` : ""}`
    }))
  );
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

    sql += " ORDER BY id DESC";
    const rows = await c.env.DB.prepare(sql).bind(...params).all<WarehouseAssetWorkOrder>();
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

    const workOrderNo = await generateSerial(c.env.DB, "WO", "warehouse_asset_work_order", "work_order_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_asset_work_order
        (work_order_no, work_order_type, tracked_asset_id, tracked_asset_configuration_id, stock_order_id,
         project_id, warehouse_id, applicant_userid, assignee_userid, blocking_flag, status, approval_instance_id,
         scheduled_date, started_at, completed_at, result_summary, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
    )
      .bind(
        workOrderNo,
        workOrderType,
        body.tracked_asset_id ?? null,
        body.tracked_asset_configuration_id ?? null,
        body.stock_order_id ?? null,
        body.project_id ?? null,
        body.warehouse_id ?? null,
        auth.sub,
        body.assignee_userid ?? null,
        body.blocking_flag ?? 1,
        body.scheduled_date ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    await emitWorkOrderTimelineEvent(
      c.env,
      {
        tracked_asset_id: body.tracked_asset_id ?? null,
        tracked_asset_configuration_id: body.tracked_asset_configuration_id ?? null,
        work_order_no: workOrderNo,
        work_order_type: workOrderType,
        project_id: body.project_id ?? null,
        warehouse_id: body.warehouse_id ?? null
      },
      auth.sub,
      "work_order_created",
      `status=draft${body.blocking_flag === 0 ? "; blocking=false" : ""}`
    );

    return c.json({ success: true, data: { id: result.meta.last_row_id, work_order_no: workOrderNo } }, 201);
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
  "/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitWarehouseAssetWorkOrderApprovalRequest;
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (row.status !== "draft") {
      return c.json({ success: false, error: { message: "only draft work order can submit approval" } }, 400);
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

    await emitWorkOrderTimelineEvent(
      c.env,
      row,
      auth.sub,
      "work_order_submitted",
      `status=pending_approval; approval_instance_id=${instance.id}`
    );

    return c.json({ success: true, data: { approval_instance_id: instance.id, instance_no: instance.instance_no } });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/start",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (!["draft", "approved"].includes(row.status)) {
      return c.json({ success: false, error: { message: "only draft or approved work order can start" } }, 400);
    }

    const affectedAssetIds = await resolveWorkOrderAffectedAssetIds(c.env, row);
    await setTrackedAssetStatusForWorkOrder(c.env, affectedAssetIds, row.work_order_type, "start");
    await c.env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), nowIso(), id)
      .run();

    await emitWorkOrderTimelineEvent(c.env, row, auth.sub, "work_order_started", "status=in_progress");
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
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (row.status !== "in_progress") {
      return c.json({ success: false, error: { message: "only in_progress work order can complete" } }, 400);
    }

    const affectedAssetIds = await resolveWorkOrderAffectedAssetIds(c.env, row);
    await setTrackedAssetStatusForWorkOrder(c.env, affectedAssetIds, row.work_order_type, "complete");
    await c.env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'completed', completed_at = ?, result_summary = COALESCE(?, result_summary), updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), body.result_summary ?? null, nowIso(), id)
      .run();

    await emitWorkOrderTimelineEvent(
      c.env,
      row,
      auth.sub,
      "work_order_completed",
      `status=completed${body.result_summary ? `; result=${body.result_summary}` : ""}`
    );
    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/cancel",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const row = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!row) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (["completed", "cancelled"].includes(row.status)) {
      return c.json({ success: false, error: { message: "completed or cancelled work order cannot cancel" } }, 400);
    }

    const affectedAssetIds = await resolveWorkOrderAffectedAssetIds(c.env, row);
    await setTrackedAssetStatusForWorkOrder(c.env, affectedAssetIds, row.work_order_type, "cancel");
    await c.env.DB.prepare(
      "UPDATE warehouse_asset_work_order SET status = 'cancelled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    await emitWorkOrderTimelineEvent(c.env, row, auth.sub, "work_order_cancelled", "status=cancelled");
    return c.json({ success: true });
  }
);
