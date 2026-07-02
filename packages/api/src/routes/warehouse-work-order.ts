import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { submitForApproval } from "../services/approval/engine";
import { resubmit as resubmitOp } from "../services/approval/operations";
import { getExistingApprovalSubmissionDecision } from "../services/approval/status";
import { generateSerial } from "../services/serial";
import { buildSignedObjectUrl, signObjectAccess } from "../services/upload-signature";
import { canAccessWarehouseTaskEvidence } from "../services/warehouse-evidence-access";
import {
  buildWarehouseDispatchRecommendationPayload,
  buildWarehouseTaskSummaryPayload
} from "../services/warehouse-ai";
import {
  assignWarehouseTask,
  buildWarehouseMobileTaskConfig,
  buildWarehouseTaskPackageStatusSummary,
  buildWarehouseTaskWorkloadSummary,
  canAttachTaskToPackage,
  canSubmitWarehouseTaskFromMobile,
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
  CreateWarehouseTaskPackageRequest,
  CreateWarehouseAssetWorkOrderRequest,
  SubmitWarehouseAssetWorkOrderApprovalRequest,
  UpdateWarehouseAssetWorkOrderRequest,
  WarehouseAssetWorkOrder,
  WarehouseAssetWorkOrderType,
  WarehouseTaskEvidence,
  WarehouseTaskPackage
} from "../types/work-order";

const nowIso = () => new Date().toISOString();

const getUploadBaseUrl = (env: Env, requestUrl: string): string => {
  return env.WECOM_PUSH_API_BASE_URL?.trim() || new URL(requestUrl).origin;
};

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

const parseJsonObject = (value: string | null): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

const loadMobileTaskDetail = async (env: Env, id: number) => {
  const task = await env.DB.prepare(
    `SELECT wao.*,
            wm.manual_title,
            wmv.version_no AS manual_version_no,
            wmv.content_json AS manual_content_json
     FROM warehouse_asset_work_order wao
     LEFT JOIN warehouse_manual_version wmv ON wmv.id = wao.manual_version_id
     LEFT JOIN warehouse_manual wm ON wm.id = wmv.manual_id
     WHERE wao.id = ?`
  )
    .bind(id)
    .first<
      WarehouseAssetWorkOrder & {
        manual_title: string | null;
        manual_version_no: number | null;
        manual_content_json: string | null;
      }
    >();
  if (!task) return null;

  const steps = await env.DB.prepare(
    "SELECT * FROM warehouse_task_step WHERE work_order_id = ? ORDER BY step_no ASC, id ASC"
  )
    .bind(id)
    .all();
  const evidence = await env.DB.prepare(
    `SELECT *
     FROM warehouse_task_evidence
     WHERE work_order_id = ?
     ORDER BY captured_at DESC, id DESC`
  )
    .bind(id)
    .all<WarehouseTaskEvidence>();

  return {
    ...task,
    manual_content: parseJsonObject(task.manual_content_json),
    steps: steps.results ?? [],
    evidence: evidence.results ?? []
  };
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
    const assetTypeId = c.req.query("asset_type_id");
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
    if (assetTypeId) {
      sql += " AND tracked_asset_id IN (SELECT id FROM tracked_asset WHERE asset_type_id = ?)";
      params.push(Number(assetTypeId));
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
  "/workload",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const warehouseId = c.req.query("warehouse_id");
    const projectId = c.req.query("project_id");
    const source = c.req.query("source");
    const assigneeUserid = c.req.query("assignee_userid");

    let sql =
      "SELECT assignee_userid, status, priority FROM warehouse_asset_work_order WHERE status NOT IN ('completed', 'cancelled')";
    const params: Array<string | number> = [];
    if (warehouseId) {
      sql += " AND warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
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
      .all<{ assignee_userid: string | null; status: string; priority: string }>();

    return c.json({
      success: true,
      data: buildWarehouseTaskWorkloadSummary(rows.results ?? [])
    });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/ai/dispatch-recommendation",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      task_ids?: number[];
      warehouse_id?: number;
      project_id?: number;
      source?: WarehouseAssetWorkOrder["source"];
      assignee_userid?: string;
      limit?: number;
    };
    const taskIds = (body.task_ids ?? [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0);
    const filters = {
      ...(taskIds.length > 0 ? { task_ids: taskIds } : {}),
      ...(body.warehouse_id ? { warehouse_id: Number(body.warehouse_id) } : {}),
      ...(body.project_id ? { project_id: Number(body.project_id) } : {}),
      ...(body.source ? { source: body.source } : {}),
      ...(body.assignee_userid?.trim() ? { assignee_userid: body.assignee_userid.trim() } : {})
    };
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 100);
    let sql = `
      SELECT id, work_order_no, work_order_type, priority, status, warehouse_id, project_id,
             assignee_userid, package_id, scheduled_date, blocking_flag, required_photo_count, remark
      FROM warehouse_asset_work_order
      WHERE status NOT IN ('completed', 'cancelled')`;
    const params: Array<string | number> = [];
    if (taskIds.length > 0) {
      sql += ` AND id IN (${taskIds.map(() => "?").join(", ")})`;
      params.push(...taskIds);
    }
    if (body.warehouse_id) {
      sql += " AND warehouse_id = ?";
      params.push(Number(body.warehouse_id));
    }
    if (body.project_id) {
      sql += " AND project_id = ?";
      params.push(Number(body.project_id));
    }
    if (body.source) {
      sql += " AND source = ?";
      params.push(body.source);
    }
    if (body.assignee_userid?.trim()) {
      sql += " AND assignee_userid = ?";
      params.push(body.assignee_userid.trim());
    }
    sql +=
      " ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, id DESC LIMIT ?";
    params.push(limit);

    const taskRows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<WarehouseAssetWorkOrder>();
    const tasks = taskRows.results ?? [];
    if (tasks.length === 0) {
      return c.json(
        { success: false, error: { message: "no open tasks for recommendation" } },
        400
      );
    }

    const workload = buildWarehouseTaskWorkloadSummary(
      tasks.map((task) => ({
        assignee_userid: task.assignee_userid,
        status: task.status,
        priority: task.priority
      }))
    );
    const task = await createTask(c.env, {
      task_type: "warehouse_task_dispatch_recommendation",
      biz_type: "warehouse_task_dispatch",
      biz_id: 0,
      priority: 5,
      payload: buildWarehouseDispatchRecommendationPayload({
        filters,
        tasks,
        workload_summary: workload
      }),
      timeout_seconds: 600
    });

    return c.json({
      success: true,
      data: { task_id: task.id, ai_status: "pending", no_auto_dispatch: true }
    });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/:id/ai/summary-draft",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const taskRow = await c.env.DB.prepare(
      `SELECT id, work_order_no, work_order_type, priority, status,
              result_summary, completion_summary_json, remark,
              assignee_userid
       FROM warehouse_asset_work_order
       WHERE id = ?`
    )
      .bind(id)
      .first<
        Pick<
          WarehouseAssetWorkOrder,
          | "id"
          | "work_order_no"
          | "work_order_type"
          | "priority"
          | "status"
          | "result_summary"
          | "completion_summary_json"
          | "remark"
          | "assignee_userid"
        >
      >();
    if (!taskRow) {
      return c.json({ success: false, error: { message: "work order not found" } }, 404);
    }
    if (
      !auth.roles.includes("super_admin") &&
      !auth.roles.includes("manager") &&
      !auth.roles.includes("site_manager") &&
      taskRow.assignee_userid !== auth.sub
    ) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    const evidenceRows = await c.env.DB.prepare(
      `SELECT evidence_type, file_name, summary
       FROM warehouse_task_evidence
       WHERE work_order_id = ?
       ORDER BY captured_at DESC, id DESC
       LIMIT 20`
    )
      .bind(id)
      .all<{ evidence_type: string; file_name: string | null; summary: string | null }>();

    const task = await createTask(c.env, {
      task_type: "warehouse_task_summary",
      biz_type: "warehouse_asset_work_order",
      biz_id: id,
      priority: 5,
      payload: buildWarehouseTaskSummaryPayload({
        task: {
          id: taskRow.id,
          work_order_no: taskRow.work_order_no,
          work_order_type: taskRow.work_order_type,
          priority: taskRow.priority,
          status: taskRow.status,
          result_summary: taskRow.result_summary,
          completion_summary_json: taskRow.completion_summary_json,
          remark: taskRow.remark
        },
        evidence: evidenceRows.results ?? []
      }),
      timeout_seconds: 300
    });

    return c.json({
      success: true,
      data: { task_id: task.id, ai_status: "pending", human_edit_required: true }
    });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/package",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const status = c.req.query("status");
    const assigneeUserid = c.req.query("assignee_userid");
    const warehouseId = c.req.query("warehouse_id");
    const projectId = c.req.query("project_id");
    let sql = "SELECT * FROM warehouse_task_package WHERE 1=1";
    const params: Array<string | number> = [];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (assigneeUserid) {
      sql += " AND assignee_userid = ?";
      params.push(assigneeUserid);
    }
    if (warehouseId) {
      sql += " AND warehouse_id = ?";
      params.push(Number(warehouseId));
    }
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<WarehouseTaskPackage>();
    const packages = rows.results ?? [];
    if (packages.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const taskRows = await c.env.DB.prepare(
      `SELECT package_id, status, scheduled_date
       FROM warehouse_asset_work_order
       WHERE package_id IN (${packages.map(() => "?").join(", ")})`
    )
      .bind(...packages.map((item) => item.id))
      .all<{ package_id: number; status: string; scheduled_date: string | null }>();

    const taskMap = new Map<number, Array<{ status: string; scheduled_date: string | null }>>();
    for (const task of taskRows.results ?? []) {
      const list = taskMap.get(task.package_id) ?? [];
      list.push({ status: task.status, scheduled_date: task.scheduled_date });
      taskMap.set(task.package_id, list);
    }

    const now = nowIso();
    const data = [];
    for (const taskPackage of packages) {
      const summary = buildWarehouseTaskPackageStatusSummary({
        due_date: taskPackage.due_date,
        tasks: taskMap.get(taskPackage.id) ?? [],
        now
      });
      if (summary.status !== taskPackage.status) {
        await c.env.DB.prepare(
          "UPDATE warehouse_task_package SET status = ?, updated_at = ? WHERE id = ?"
        )
          .bind(summary.status, now, taskPackage.id)
          .run();
      }
      data.push({
        ...taskPackage,
        status: summary.status,
        task_count: summary.task_count,
        completed_count: summary.completed_count,
        open_count: summary.open_count,
        overdue_count: summary.overdue_count,
        exception_count: summary.exception_count
      });
    }

    return c.json({ success: true, data });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/package",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateWarehouseTaskPackageRequest;
    if (!body.package_title?.trim()) {
      return c.json({ success: false, error: { message: "package_title is required" } }, 400);
    }

    const packageNo = await generateSerial(c.env.DB, "TP", "warehouse_task_package", "package_no");
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_task_package
        (package_no, package_title, package_type, warehouse_id, project_id, priority, status,
         assignee_userid, assigned_by_userid, planned_start_date, due_date, source,
         source_biz_type, source_biz_id, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        packageNo,
        body.package_title.trim(),
        body.package_type?.trim() || "daily",
        body.warehouse_id ?? null,
        body.project_id ?? null,
        body.priority ?? "normal",
        body.assignee_userid ?? null,
        auth.sub,
        body.planned_start_date ?? null,
        body.due_date ?? null,
        body.source ?? "manual",
        body.source_biz_type ?? null,
        body.source_biz_id ?? null,
        body.remark ?? null,
        now,
        now
      )
      .run();

    return c.json(
      { success: true, data: { id: result.meta.last_row_id, package_no: packageNo } },
      201
    );
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/package/:id/assign-tasks",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const packageId = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as {
      task_ids?: number[];
      assignee_userid?: string | null;
      scheduled_date?: string | null;
      manual_version_id?: number | null;
    };
    const taskIds = [...new Set(body.task_ids ?? [])].filter((id) => Number.isInteger(id));
    if (taskIds.length === 0) {
      return c.json({ success: false, error: { message: "task_ids is required" } }, 400);
    }

    const taskPackage = await c.env.DB.prepare("SELECT * FROM warehouse_task_package WHERE id = ?")
      .bind(packageId)
      .first<WarehouseTaskPackage>();
    if (!taskPackage) {
      return c.json({ success: false, error: { message: "task package not found" } }, 404);
    }

    const explicitAssignee = body.assignee_userid?.trim() || null;
    const effectiveAssignee = explicitAssignee || taskPackage.assignee_userid;
    const scheduledDate = body.scheduled_date ?? taskPackage.due_date;
    const now = nowIso();
    let updated = 0;

    for (const taskId of taskIds) {
      const authority = await ensureWarehouseTaskOwnerAuthority(c.env, auth, taskId);
      if (!authority.ok) {
        return c.json({ success: false, error: { message: authority.message } }, authority.status);
      }

      const task = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
        .bind(taskId)
        .first<WarehouseAssetWorkOrder>();
      if (!task) {
        return c.json({ success: false, error: { message: "work order not found" } }, 404);
      }
      if (!canAttachTaskToPackage(task)) {
        return c.json(
          {
            success: false,
            error: { message: "completed or cancelled work order cannot attach to package" }
          },
          400
        );
      }

      await c.env.DB.prepare(
        `UPDATE warehouse_asset_work_order SET
           package_id = ?,
           assignee_userid = CASE WHEN ? IS NULL THEN assignee_userid ELSE ? END,
           assigned_by_userid = CASE WHEN ? IS NULL THEN assigned_by_userid ELSE ? END,
           scheduled_date = COALESCE(?, scheduled_date),
           manual_version_id = COALESCE(?, manual_version_id),
           status = CASE
             WHEN ? IS NOT NULL AND status IN ('draft', 'pending_assignment', 'rejected') THEN 'assigned'
             ELSE status
           END,
           updated_at = ?
         WHERE id = ?`
      )
        .bind(
          packageId,
          effectiveAssignee,
          effectiveAssignee,
          effectiveAssignee,
          auth.sub,
          scheduledDate,
          body.manual_version_id ?? null,
          effectiveAssignee,
          now,
          taskId
        )
        .run();

      await emitWarehouseTaskTimelineEvent(
        c.env,
        task,
        auth.sub,
        "work_order_assigned",
        `package_id=${packageId}${effectiveAssignee ? `; assignee=${effectiveAssignee}` : ""}`
      );
      updated += 1;
    }

    await c.env.DB.prepare(
      `UPDATE warehouse_task_package SET
         assignee_userid = COALESCE(?, assignee_userid),
         assigned_by_userid = ?,
         status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(effectiveAssignee, auth.sub, now, packageId)
      .run();

    return c.json({ success: true, data: { updated } });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/mobile/config",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    return c.json({ success: true, data: buildWarehouseMobileTaskConfig() });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/mobile/package",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const rows = await c.env.DB.prepare(
      `SELECT *
       FROM warehouse_task_package
       WHERE assignee_userid = ?
         AND status IN ('open', 'in_progress', 'exception')
       ORDER BY due_date IS NULL, due_date ASC, id DESC`
    )
      .bind(auth.sub)
      .all<WarehouseTaskPackage>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/mobile/my-tasks",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const config = buildWarehouseMobileTaskConfig();
    const rows = await c.env.DB.prepare(
      `SELECT *
       FROM warehouse_asset_work_order
       WHERE mobile_enabled = 1
         AND assignee_userid = ?
         AND status IN (${config.visible_statuses.map(() => "?").join(", ")})
       ORDER BY
         CASE priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 3
           ELSE 4
         END,
         scheduled_date IS NULL,
         scheduled_date ASC,
         id DESC`
    )
      .bind(auth.sub, ...config.visible_statuses)
      .all<WarehouseAssetWorkOrder>();
    return c.json({ success: true, data: rows.results ?? [] });
  }
);

warehouseAssetWorkOrderRoutes.get(
  "/mobile/task/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const detail = await loadMobileTaskDetail(c.env, id);
    if (!detail) {
      return c.json({ success: false, error: { message: "work order not found" } }, 404);
    }
    if (!auth.roles.includes("super_admin") && detail.assignee_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    return c.json({ success: true, data: detail });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/mobile/task/:id/start",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const task = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!task) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (!canSubmitWarehouseTaskFromMobile(task, auth.sub, auth.roles)) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }
    if (task.status === "in_progress") {
      return c.json({ success: true });
    }
    if (task.status !== "assigned") {
      return c.json(
        { success: false, error: { message: "only assigned task can start from mobile" } },
        400
      );
    }

    try {
      await startWarehouseTask(c.env, id, auth.sub);
    } catch (error) {
      return c.json({ success: false, error: { message: (error as Error).message } }, 400);
    }
    return c.json({ success: true });
  }
);

warehouseAssetWorkOrderRoutes.post(
  "/mobile/task/:id/submit",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const task = await c.env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
      .bind(id)
      .first<WarehouseAssetWorkOrder>();
    if (!task) return c.json({ success: false, error: { message: "work order not found" } }, 404);
    if (!canSubmitWarehouseTaskFromMobile(task, auth.sub, auth.roles)) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

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

warehouseAssetWorkOrderRoutes.get(
  "/evidence/:evidenceId/access",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const evidenceId = Number(c.req.param("evidenceId"));
    if (!Number.isInteger(evidenceId)) {
      return c.json({ success: false, error: { message: "invalid evidence id" } }, 400);
    }

    const auth = c.get("auth");
    const evidence = await c.env.DB.prepare(
      `SELECT wte.*,
              wao.work_order_no,
              wao.assignee_userid,
              w.manager_userid AS warehouse_manager_userid
       FROM warehouse_task_evidence wte
       JOIN warehouse_asset_work_order wao ON wao.id = wte.work_order_id
       LEFT JOIN warehouse w ON w.id = wao.warehouse_id AND w.status != 'deleted'
       WHERE wte.id = ?`
    )
      .bind(evidenceId)
      .first<
        WarehouseTaskEvidence & {
          work_order_no: string;
          assignee_userid: string | null;
          warehouse_manager_userid: string | null;
        }
      >();

    if (!evidence) {
      return c.json({ success: false, error: { message: "evidence not found" } }, 404);
    }
    if (!evidence.file_key) {
      return c.json({ success: false, error: { message: "evidence has no file" } }, 400);
    }
    if (
      !canAccessWarehouseTaskEvidence(auth, {
        assignee_userid: evidence.assignee_userid,
        operator_userid: evidence.operator_userid,
        warehouse_manager_userid: evidence.warehouse_manager_userid
      })
    ) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    const expiresAt = Date.now() + 5 * 60 * 1000;
    const signature = await signObjectAccess(
      c.env.UPLOAD_SIGNING_SECRET,
      evidence.file_key,
      expiresAt
    );

    return c.json({
      success: true,
      data: {
        evidence_id: evidence.id,
        work_order_id: evidence.work_order_id,
        work_order_no: evidence.work_order_no,
        file_key: evidence.file_key,
        file_name: evidence.file_name,
        evidence_type: evidence.evidence_type,
        expires_at: new Date(expiresAt).toISOString(),
        url: buildSignedObjectUrl(
          evidence.file_key,
          expiresAt,
          signature,
          getUploadBaseUrl(c.env, c.req.url)
        )
      }
    });
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

    if (row.approval_instance_id) {
      const existing = await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
        .bind(row.approval_instance_id)
        .first<{ status: string }>();
      const decision = existing
        ? getExistingApprovalSubmissionDecision(existing.status)
        : "new";

      if (decision === "active") {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }

      if (decision === "resubmit") {
        await resubmitOp(c.env, row.approval_instance_id, auth.sub, body.biz_summary);
        await c.env.DB.prepare(
          "UPDATE warehouse_asset_work_order SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
        )
          .bind(row.approval_instance_id, nowIso(), id)
          .run();
        await emitWarehouseTaskTimelineEvent(
          c.env,
          row,
          auth.sub,
          "work_order_submitted",
          `status=pending_approval; approval_instance_id=${row.approval_instance_id}`
        );
        return c.json({
          success: true,
          data: {
            approval_instance_id: row.approval_instance_id,
            instance_no: "",
            resubmitted: true
          }
        });
      }
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
