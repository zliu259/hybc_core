import { emitTrackedAssetEvents, getConfigurationParticipants } from "./asset-event";
import { generateSerial } from "./serial";
import type { TrackedAsset } from "../types/asset";
import type { Env } from "../types/env";
import type {
  CreateWarehouseAssetWorkOrderRequest,
  WarehouseAssetWorkOrder,
  WarehouseAssetWorkOrderStatus,
  WarehouseAssetWorkOrderType,
  WarehouseTaskEvidenceInput,
  WarehouseTaskPriority,
  WarehouseTaskSource
} from "../types/work-order";

const nowIso = () => new Date().toISOString();

const openBlockingStatuses: WarehouseAssetWorkOrderStatus[] = [
  "draft",
  "pending_assignment",
  "assigned",
  "pending_approval",
  "approved",
  "in_progress",
  "submitted",
  "rejected"
];

const taskStartAllowedStatuses: WarehouseAssetWorkOrderStatus[] = [
  "draft",
  "pending_assignment",
  "assigned",
  "approved"
];

export const normalizeReturnedAssetStatus = (status: string): string => {
  return status === "quarantine" ? "returned_quarantine" : status;
};

export const isWarehouseTaskOpenBlockingStatus = (status: string): boolean => {
  return openBlockingStatuses.includes(status as WarehouseAssetWorkOrderStatus);
};

export const buildReturnInspectionTaskDefaults = (payload: {
  order_no: string;
  asset_code: string;
}): {
  work_order_type: WarehouseAssetWorkOrderType;
  source: WarehouseTaskSource;
  priority: WarehouseTaskPriority;
  blocking_flag: number;
  mobile_enabled: number;
  required_photo_count: number;
  remark: string;
} => {
  return {
    work_order_type: "inspection",
    source: "return_receipt",
    priority: "urgent",
    blocking_flag: 1,
    mobile_enabled: 1,
    required_photo_count: 3,
    remark: `项目返库设备必须完成签收后检查。出入库单=${payload.order_no}; 设备=${payload.asset_code}; 要求照片>=3张并提交检查简报。`
  };
};

export const resolveWarehouseTaskAffectedAssetIds = async (
  env: Env,
  payload: {
    tracked_asset_id?: number | null;
    tracked_asset_configuration_id?: number | null;
  }
): Promise<number[]> => {
  const ids = new Set<number>();
  if (payload.tracked_asset_id) ids.add(payload.tracked_asset_id);
  if (payload.tracked_asset_configuration_id) {
    const participants = await getConfigurationParticipants(
      env.DB,
      payload.tracked_asset_configuration_id
    );
    for (const participant of participants) ids.add(participant.tracked_asset_id);
  }
  return [...ids];
};

export const setTrackedAssetStatusForWarehouseTask = async (
  env: Env,
  trackedAssetIds: number[],
  type: WarehouseAssetWorkOrderType,
  mode: "start" | "complete" | "cancel" | "reject"
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
    } else if (mode === "reject") {
      nextStatus = type === "scrapping" ? asset.status : "returned_quarantine";
    }

    if (!nextStatus) continue;
    await env.DB.prepare("UPDATE tracked_asset SET status = ?, updated_at = ? WHERE id = ?")
      .bind(nextStatus, nowIso(), trackedAssetId)
      .run();
  }
};

export const emitWarehouseTaskTimelineEvent = async (
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
    | "work_order_assigned"
    | "work_order_submitted"
    | "work_order_started"
    | "work_order_completed"
    | "work_order_rejected"
    | "work_order_cancelled"
    | "work_order_evidence",
  detailSuffix?: string
) => {
  const eventTime = nowIso();
  const assetIds = await resolveWarehouseTaskAffectedAssetIds(env, payload);
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

export const createWarehouseTask = async (
  env: Env,
  payload: CreateWarehouseAssetWorkOrderRequest & {
    applicant_userid: string;
    status?: WarehouseAssetWorkOrderStatus;
  }
): Promise<{ id: number; work_order_no: string }> => {
  const workOrderNo = await generateSerial(
    env.DB,
    "WO",
    "warehouse_asset_work_order",
    "work_order_no"
  );
  const now = nowIso();
  const result = await env.DB.prepare(
    `INSERT INTO warehouse_asset_work_order
      (work_order_no, work_order_type, tracked_asset_id, tracked_asset_configuration_id, stock_order_id,
       project_id, warehouse_id, applicant_userid, assignee_userid, blocking_flag, status, approval_instance_id,
       source, priority, package_id, assigned_by_userid, reviewer_userid, submitted_at, reviewed_at,
       manual_version_id, mobile_enabled, required_photo_count, completion_summary_json,
       scheduled_date, started_at, completed_at, result_summary, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?)`
  )
    .bind(
      workOrderNo,
      payload.work_order_type,
      payload.tracked_asset_id ?? null,
      payload.tracked_asset_configuration_id ?? null,
      payload.stock_order_id ?? null,
      payload.project_id ?? null,
      payload.warehouse_id ?? null,
      payload.applicant_userid,
      payload.assignee_userid ?? null,
      payload.blocking_flag ?? 1,
      payload.status ?? "draft",
      payload.source ?? "manual",
      payload.priority ?? "normal",
      payload.package_id ?? null,
      payload.manual_version_id ?? null,
      payload.mobile_enabled ?? 0,
      payload.required_photo_count ?? 0,
      payload.scheduled_date ?? null,
      payload.remark ?? null,
      now,
      now
    )
    .run();

  await emitWarehouseTaskTimelineEvent(
    env,
    {
      tracked_asset_id: payload.tracked_asset_id ?? null,
      tracked_asset_configuration_id: payload.tracked_asset_configuration_id ?? null,
      work_order_no: workOrderNo,
      work_order_type: payload.work_order_type,
      project_id: payload.project_id ?? null,
      warehouse_id: payload.warehouse_id ?? null
    },
    payload.applicant_userid,
    "work_order_created",
    `status=${payload.status ?? "draft"}; source=${payload.source ?? "manual"}${payload.blocking_flag === 0 ? "; blocking=false" : ""}`
  );

  return { id: result.meta.last_row_id as number, work_order_no: workOrderNo };
};

export const createReturnInspectionTaskForStockOrderItem = async (
  env: Env,
  payload: {
    order_id: number;
    order_no: string;
    project_id: number | null;
    warehouse_id: number | null;
    tracked_asset_id: number;
    applicant_userid: string;
  }
): Promise<{ id: number; work_order_no: string; created: boolean }> => {
  const asset = await env.DB.prepare("SELECT id, asset_code FROM tracked_asset WHERE id = ?")
    .bind(payload.tracked_asset_id)
    .first<{ id: number; asset_code: string }>();
  if (!asset) throw new Error(`tracked asset ${payload.tracked_asset_id} not found`);

  const existing = await env.DB.prepare(
    `SELECT id, work_order_no
     FROM warehouse_asset_work_order
     WHERE tracked_asset_id = ?
       AND stock_order_id = ?
       AND source = 'return_receipt'
       AND status NOT IN ('completed', 'cancelled')
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(payload.tracked_asset_id, payload.order_id)
    .first<{ id: number; work_order_no: string }>();
  if (existing) return { ...existing, created: false };

  const defaults = buildReturnInspectionTaskDefaults({
    order_no: payload.order_no,
    asset_code: asset.asset_code
  });

  const task = await createWarehouseTask(env, {
    ...defaults,
    status: "pending_assignment",
    tracked_asset_id: payload.tracked_asset_id,
    stock_order_id: payload.order_id,
    project_id: payload.project_id ?? undefined,
    warehouse_id: payload.warehouse_id ?? undefined,
    applicant_userid: payload.applicant_userid
  });

  return { ...task, created: true };
};

export const isAssetBlockedByWarehouseTasks = async (
  env: Env,
  trackedAssetId: number
): Promise<{ blocked: boolean; work_order_no: string | null; status: string | null }> => {
  const row = await env.DB.prepare(
    `SELECT work_order_no, status
     FROM warehouse_asset_work_order
     WHERE tracked_asset_id = ?
       AND blocking_flag = 1
       AND status IN (${openBlockingStatuses.map(() => "?").join(", ")})
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(trackedAssetId, ...openBlockingStatuses)
    .first<{ work_order_no: string; status: string }>();

  return {
    blocked: Boolean(row),
    work_order_no: row?.work_order_no ?? null,
    status: row?.status ?? null
  };
};

export const assignWarehouseTask = async (
  env: Env,
  payload: {
    id: number;
    assignee_userid: string;
    assigned_by_userid: string;
    package_id?: number | null;
    scheduled_date?: string | null;
  }
): Promise<void> => {
  const row = await env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
    .bind(payload.id)
    .first<WarehouseAssetWorkOrder>();
  if (!row) throw new Error("work order not found");
  if (["completed", "cancelled"].includes(row.status)) {
    throw new Error("completed or cancelled work order cannot assign");
  }

  await env.DB.prepare(
    `UPDATE warehouse_asset_work_order SET
       assignee_userid = ?,
       assigned_by_userid = ?,
       package_id = COALESCE(?, package_id),
       scheduled_date = COALESCE(?, scheduled_date),
       status = 'assigned',
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      payload.assignee_userid,
      payload.assigned_by_userid,
      payload.package_id ?? null,
      payload.scheduled_date ?? null,
      nowIso(),
      payload.id
    )
    .run();

  await emitWarehouseTaskTimelineEvent(
    env,
    row,
    payload.assigned_by_userid,
    "work_order_assigned",
    `status=assigned; assignee=${payload.assignee_userid}`
  );
};

export const startWarehouseTask = async (
  env: Env,
  id: number,
  operatorUserid: string
): Promise<void> => {
  const row = await env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
    .bind(id)
    .first<WarehouseAssetWorkOrder>();
  if (!row) throw new Error("work order not found");
  if (!taskStartAllowedStatuses.includes(row.status)) {
    throw new Error("only draft, pending_assignment, assigned or approved work order can start");
  }

  const affectedAssetIds = await resolveWarehouseTaskAffectedAssetIds(env, row);
  await setTrackedAssetStatusForWarehouseTask(env, affectedAssetIds, row.work_order_type, "start");
  await env.DB.prepare(
    "UPDATE warehouse_asset_work_order SET status = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), nowIso(), id)
    .run();

  await emitWarehouseTaskTimelineEvent(
    env,
    row,
    operatorUserid,
    "work_order_started",
    "status=in_progress"
  );
};

export const submitWarehouseTask = async (
  env: Env,
  payload: {
    id: number;
    operator_userid: string;
    result_summary?: string | null;
    completion_summary_json?: string | null;
    evidence?: WarehouseTaskEvidenceInput[];
  }
): Promise<void> => {
  const row = await env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
    .bind(payload.id)
    .first<WarehouseAssetWorkOrder>();
  if (!row) throw new Error("work order not found");
  if (!["assigned", "in_progress", "rejected"].includes(row.status)) {
    throw new Error("only assigned, in_progress or rejected work order can submit");
  }

  const evidence = payload.evidence ?? [];
  const photoCount = evidence.filter((item) => item.evidence_type === "photo").length;
  if (row.required_photo_count > 0 && photoCount < row.required_photo_count) {
    throw new Error(`at least ${row.required_photo_count} photos are required`);
  }

  const now = nowIso();
  for (const item of evidence) {
    await env.DB.prepare(
      `INSERT INTO warehouse_task_evidence
        (work_order_id, step_id, tracked_asset_id, evidence_type, file_key, file_name, summary,
         operator_userid, captured_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        item.step_id ?? null,
        item.tracked_asset_id ?? row.tracked_asset_id ?? null,
        item.evidence_type,
        item.file_key ?? null,
        item.file_name ?? null,
        item.summary ?? null,
        payload.operator_userid,
        item.captured_at ?? now,
        now
      )
      .run();
  }

  await env.DB.prepare(
    `UPDATE warehouse_asset_work_order SET
       status = 'submitted',
       submitted_at = ?,
       result_summary = COALESCE(?, result_summary),
       completion_summary_json = COALESCE(?, completion_summary_json),
       updated_at = ?
     WHERE id = ?`
  )
    .bind(now, payload.result_summary ?? null, payload.completion_summary_json ?? null, now, row.id)
    .run();

  await emitWarehouseTaskTimelineEvent(
    env,
    row,
    payload.operator_userid,
    "work_order_submitted",
    `status=submitted; evidence_count=${evidence.length}`
  );
};

export const reviewWarehouseTask = async (
  env: Env,
  payload: {
    id: number;
    reviewer_userid: string;
    action: "approve" | "reject";
    result_summary?: string | null;
  }
): Promise<void> => {
  const row = await env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
    .bind(payload.id)
    .first<WarehouseAssetWorkOrder>();
  if (!row) throw new Error("work order not found");
  if (row.status !== "submitted" && row.status !== "in_progress") {
    throw new Error("only submitted or in_progress work order can review");
  }

  const now = nowIso();
  const nextStatus = payload.action === "approve" ? "completed" : "rejected";
  await env.DB.prepare(
    `UPDATE warehouse_asset_work_order SET
       status = ?,
       reviewer_userid = ?,
       reviewed_at = ?,
       completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
       result_summary = COALESCE(?, result_summary),
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextStatus,
      payload.reviewer_userid,
      now,
      nextStatus,
      now,
      payload.result_summary ?? null,
      now,
      row.id
    )
    .run();

  const affectedAssetIds = await resolveWarehouseTaskAffectedAssetIds(env, row);
  await setTrackedAssetStatusForWarehouseTask(
    env,
    affectedAssetIds,
    row.work_order_type,
    payload.action === "approve" ? "complete" : "reject"
  );

  await emitWarehouseTaskTimelineEvent(
    env,
    row,
    payload.reviewer_userid,
    payload.action === "approve" ? "work_order_completed" : "work_order_rejected",
    `status=${nextStatus}${payload.result_summary ? `; result=${payload.result_summary}` : ""}`
  );
};

export const cancelWarehouseTask = async (
  env: Env,
  id: number,
  operatorUserid: string
): Promise<void> => {
  const row = await env.DB.prepare("SELECT * FROM warehouse_asset_work_order WHERE id = ?")
    .bind(id)
    .first<WarehouseAssetWorkOrder>();
  if (!row) throw new Error("work order not found");
  if (["completed", "cancelled"].includes(row.status)) {
    throw new Error("completed or cancelled work order cannot cancel");
  }

  const affectedAssetIds = await resolveWarehouseTaskAffectedAssetIds(env, row);
  await setTrackedAssetStatusForWarehouseTask(env, affectedAssetIds, row.work_order_type, "cancel");
  await env.DB.prepare(
    "UPDATE warehouse_asset_work_order SET status = 'cancelled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  await emitWarehouseTaskTimelineEvent(
    env,
    row,
    operatorUserid,
    "work_order_cancelled",
    "status=cancelled"
  );
};
