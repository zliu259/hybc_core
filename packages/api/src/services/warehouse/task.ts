/**
 * 库房任务：一条状态线 todo → submitted → done，可退回补充、可取消。
 * 状态变更都带 version，在批处理里断言版本和状态，并发时整批回滚。
 */
import type { AuthTokenPayload } from "../../types/auth";
import type { Env } from "../../types/env";
import type { WhTask, WhTaskKind, WhTaskSource } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { generateSerials } from "../serial";
import type { WarehouseCapabilities } from "./access";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, releaseGuards } from "./guard";
import { getWarehouseSettings } from "./settings";
import { getTask, listTasks, type TaskRow } from "./task-query";
import {
  optionalDate,
  optionalId,
  optionalNumber,
  optionalText,
  requireEnum,
  requireText
} from "./validation";

export { getTask, listTasks, type TaskRow };

export const TASK_SYSTEMS = ["hydraulic", "electric", "drive", "other"] as const;
const TASK_KINDS: readonly WhTaskKind[] = ["inspection", "maintenance", "servicing", "other"];
const MAX_PHOTOS = 30;
const nowIso = () => new Date().toISOString();

export interface TaskDraft {
  kind: WhTaskKind;
  source: WhTaskSource;
  title: string;
  description: string | null;
  device_id: number | null;
  blocking: 0 | 1;
  required_photo_count: number;
  due_date: string | null;
  assignee_userid: string | null;
  parent_task_id: number | null;
  /** 单据在同一个批处理里刚插入时，用它的 client_request_id 取 id。 */
  origin_doc_client_request_id: string | null;
}

/** 给别的批处理用（返库单、检查不合格转维修）。 */
export const buildTaskInsert = (
  db: D1Database,
  draft: TaskDraft,
  taskNo: string,
  operatorUserid: string,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO wh_task
        (task_no, kind, source, device_id, title, description, blocking, required_photo_count, due_date,
         assignee_userid, created_by_userid, status, parent_task_id, origin_doc_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?,
         (SELECT id FROM wh_doc WHERE client_request_id = ?), ?, ?)`
    )
    .bind(
      taskNo,
      draft.kind,
      draft.source,
      draft.device_id,
      draft.title,
      draft.description,
      draft.blocking,
      draft.required_photo_count,
      draft.due_date,
      draft.assignee_userid,
      operatorUserid,
      draft.parent_task_id,
      draft.origin_doc_client_request_id,
      now,
      now
    );

const loadTask = async (env: Env, id: number): Promise<WhTask> => {
  const task = await env.DB.prepare("SELECT * FROM wh_task WHERE id = ?").bind(id).first<WhTask>();
  if (!task) throw new WarehouseError(404, "任务不存在");
  return task;
};

const requireVersion = (value: unknown): number => {
  const version = optionalNumber(value, "版本号", { min: 0, max: 1_000_000_000, integer: true });
  if (version === null) throw badRequest("缺少版本号，请刷新后重试");
  return version;
};

const guardTask = (db: D1Database, id: number, version: number, statuses: readonly string[]) =>
  assertInBatch(
    db,
    `SELECT 1 FROM wh_task WHERE id = ? AND version = ? AND status IN (${statuses.map(() => "?").join(", ")})`,
    [id, version, ...statuses]
  );

const deviceEvent = (
  db: D1Database,
  deviceId: number,
  eventType: string,
  taskId: number,
  summary: string,
  operatorUserid: string,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO device_event (device_id, event_type, ref_type, ref_id, summary, operator_userid, occurred_at, created_at)
       VALUES (?, ?, 'wh_task', ?, ?, ?, ?, ?)`
    )
    .bind(deviceId, eventType, taskId, summary, operatorUserid, now, now);

const isTaskNoConflict = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: wh_task.task_no");

export const createTask = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<{ id: number; task_no: string }> => {
  const kind = requireEnum(input.kind, "任务类型", TASK_KINDS);
  const deviceId = optionalId(input.device_id, "设备");
  if (deviceId !== null) {
    const device = await env.DB.prepare("SELECT id FROM device WHERE id = ?")
      .bind(deviceId)
      .first();
    if (!device) throw badRequest("设备不存在");
  }
  const blockingInput = input.blocking;
  const draft: TaskDraft = {
    kind,
    source: "manual",
    title: requireText(input.title, "任务标题", 80),
    description: optionalText(input.description, "任务说明", 500),
    device_id: deviceId,
    blocking:
      blockingInput === undefined || blockingInput === null
        ? kind === "inspection" || kind === "maintenance"
          ? 1
          : 0
        : blockingInput === true || blockingInput === 1
          ? 1
          : 0,
    required_photo_count:
      optionalNumber(input.required_photo_count, "照片要求", { min: 0, max: 9, integer: true }) ??
      0,
    due_date: optionalDate(input.due_date, "期限"),
    assignee_userid: optionalText(input.assignee_userid, "执行人", 64),
    parent_task_id: null,
    origin_doc_client_request_id: null
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [taskNo] = await generateSerials(env.DB, "KFR", "wh_task", "task_no", 1);
    try {
      await buildTaskInsert(env.DB, draft, taskNo, operatorUserid, nowIso()).run();
      const row = await env.DB.prepare("SELECT id FROM wh_task WHERE task_no = ?")
        .bind(taskNo)
        .first<{ id: number }>();
      return { id: Number(row?.id), task_no: taskNo };
    } catch (error) {
      if (!isTaskNoConflict(error) || attempt === 1) throw error;
    }
  }
  throw new WarehouseError(409, "任务号冲突，请重试");
};

export const assignTask = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<void> => {
  const task = await loadTask(env, id);
  if (task.status !== "todo") throw new WarehouseError(409, "只能给待执行的任务派工");
  const version = requireVersion(input.version);
  const assignee = optionalText(input.assignee_userid, "执行人", 64);
  const now = nowIso();
  await runAtomicBatch(env.DB, [
    guardTask(env.DB, id, version, ["todo"]),
    env.DB.prepare(
      "UPDATE wh_task SET assignee_userid = ?, version = version + 1, updated_at = ? WHERE id = ?"
    ).bind(assignee, now, id),
    releaseGuards(env.DB)
  ]);
  void operatorUserid;
};

const canAct = (task: WhTask, auth: AuthTokenPayload, caps: WarehouseCapabilities): boolean =>
  caps.is_keeper || (task.assignee_userid !== null && task.assignee_userid === auth.sub);

export const addTaskPhoto = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<{ id: number }> => {
  const task = await loadTask(env, id);
  if (!canAct(task, auth, caps)) throw new WarehouseError(403, "只有执行人可以操作");
  if (task.status !== "todo") throw new WarehouseError(409, "任务已提交，不能再加照片");
  const fileKey = requireText(input.file_key, "照片", 300);
  if (!fileKey.startsWith("wh-task/")) throw badRequest("照片文件不对，请重新上传");
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM wh_task_photo WHERE task_id = ? AND deleted_at IS NULL"
  )
    .bind(id)
    .first<{ n: number }>();
  if (Number(count?.n ?? 0) >= MAX_PHOTOS) throw badRequest(`照片最多 ${MAX_PHOTOS} 张`);
  const result = await env.DB.prepare(
    "INSERT INTO wh_task_photo (task_id, file_key, uploaded_by_userid, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(id, fileKey, auth.sub, nowIso())
    .run();
  return { id: Number(result.meta.last_row_id) };
};

export const removeTaskPhoto = async (
  env: Env,
  id: number,
  photoId: number,
  auth: AuthTokenPayload
): Promise<void> => {
  const task = await loadTask(env, id);
  const photo = await env.DB.prepare(
    "SELECT uploaded_by_userid FROM wh_task_photo WHERE id = ? AND task_id = ? AND deleted_at IS NULL"
  )
    .bind(photoId, id)
    .first<{ uploaded_by_userid: string }>();
  if (!photo) throw new WarehouseError(404, "照片不存在");
  if (photo.uploaded_by_userid !== auth.sub)
    throw new WarehouseError(403, "只能删除自己上传的照片");
  if (task.status !== "todo") throw new WarehouseError(409, "任务已提交，不能删照片");
  await env.DB.prepare(
    "UPDATE wh_task_photo SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(nowIso(), photoId)
    .run();
};

/** 任务变成 done 时要一起写的语句：设备时间线；检查不合格时建维修任务。 */
const completionStatements = async (
  env: Env,
  task: WhTask,
  result: "pass" | "fail" | null,
  operatorUserid: string,
  now: string
): Promise<{ statements: D1PreparedStatement[]; followupTaskNo: string | null }> => {
  if (task.device_id === null) return { statements: [], followupTaskNo: null };
  const failed = task.kind === "inspection" && result === "fail";
  const summary =
    task.kind === "inspection"
      ? failed
        ? "检查不合格，已转维修"
        : "检查合格"
      : `${task.title}已完成`;
  const statements = [
    deviceEvent(env.DB, task.device_id, "task_done", task.id, summary, operatorUserid, now)
  ];
  if (!failed) return { statements, followupTaskNo: null };

  const [settings, device, serials] = await Promise.all([
    getWarehouseSettings(env),
    env.DB.prepare("SELECT name FROM device WHERE id = ?")
      .bind(task.device_id)
      .first<{ name: string }>(),
    generateSerials(env.DB, "KFR", "wh_task", "task_no", 1)
  ]);
  const draft: TaskDraft = {
    kind: "maintenance",
    source: "followup",
    title: `维修：${device?.name ?? ""}`,
    description: task.result_note,
    device_id: task.device_id,
    blocking: 1,
    required_photo_count: settings.return_inspection_photo_count,
    due_date: null,
    assignee_userid: null,
    parent_task_id: task.id,
    origin_doc_client_request_id: null
  };
  statements.push(buildTaskInsert(env.DB, draft, serials[0], operatorUserid, now));
  return { statements, followupTaskNo: serials[0] };
};

const followupId = async (env: Env, taskNo: string | null): Promise<number | null> => {
  if (!taskNo) return null;
  const row = await env.DB.prepare("SELECT id FROM wh_task WHERE task_no = ?")
    .bind(taskNo)
    .first<{ id: number }>();
  return row ? Number(row.id) : null;
};

export const submitTask = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<{ status: "submitted" | "done"; followup_task_id: number | null }> => {
  const task = await loadTask(env, id);
  if (!canAct(task, auth, caps)) throw new WarehouseError(403, "只有执行人可以操作");
  if (task.status !== "todo") throw new WarehouseError(409, "任务不是待执行状态");
  const version = requireVersion(input.version);
  const photos = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM wh_task_photo WHERE task_id = ? AND deleted_at IS NULL"
  )
    .bind(id)
    .first<{ n: number }>();
  const missing = task.required_photo_count - Number(photos?.n ?? 0);
  if (missing > 0) throw badRequest(`还差 ${missing} 张照片`);
  const result =
    task.kind === "inspection"
      ? requireEnum(input.result, "检查结果", ["pass", "fail"] as const)
      : null;
  let systemsJson: string | null = null;
  if (task.kind === "maintenance") {
    const systems = Array.isArray(input.systems) ? input.systems : [];
    const valid = systems.filter((item): item is (typeof TASK_SYSTEMS)[number] =>
      (TASK_SYSTEMS as readonly unknown[]).includes(item)
    );
    if (valid.length === 0 || valid.length !== systems.length)
      throw badRequest("请选择维修涉及的系统");
    systemsJson = JSON.stringify([...new Set(valid)]);
  }
  const resultNote = requireText(input.result_note, "简报", 800);
  const done = caps.is_keeper;
  const now = nowIso();
  const completion = done
    ? await completionStatements(env, { ...task, result_note: resultNote }, result, auth.sub, now)
    : { statements: [], followupTaskNo: null };
  await runAtomicBatch(env.DB, [
    guardTask(env.DB, id, version, ["todo"]),
    env.DB.prepare(
      `UPDATE wh_task SET status = ?, result = ?, result_note = ?, systems_json = ?, submitted_at = ?,
         done_at = ?, done_by_userid = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(
      done ? "done" : "submitted",
      result,
      resultNote,
      systemsJson,
      now,
      done ? now : null,
      done ? auth.sub : null,
      now,
      id
    ),
    ...completion.statements,
    releaseGuards(env.DB)
  ]);
  return {
    status: done ? "done" : "submitted",
    followup_task_id: await followupId(env, completion.followupTaskNo)
  };
};

export const confirmTask = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<{ followup_task_id: number | null }> => {
  const task = await loadTask(env, id);
  if (task.status !== "submitted") throw new WarehouseError(409, "任务不是待确认状态");
  const version = requireVersion(input.version);
  const now = nowIso();
  const completion = await completionStatements(env, task, task.result, operatorUserid, now);
  await runAtomicBatch(env.DB, [
    guardTask(env.DB, id, version, ["submitted"]),
    env.DB.prepare(
      `UPDATE wh_task SET status = 'done', done_at = ?, done_by_userid = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(now, operatorUserid, now, id),
    ...completion.statements,
    releaseGuards(env.DB)
  ]);
  return { followup_task_id: await followupId(env, completion.followupTaskNo) };
};

export const sendBackTask = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<void> => {
  const task = await loadTask(env, id);
  if (task.status !== "submitted") throw new WarehouseError(409, "任务不是待确认状态");
  const version = requireVersion(input.version);
  const reviewNote = requireText(input.review_note, "退回要求", 300);
  const now = nowIso();
  await runAtomicBatch(env.DB, [
    guardTask(env.DB, id, version, ["submitted"]),
    env.DB.prepare(
      `UPDATE wh_task SET status = 'todo', review_note = ?, supplement_round = supplement_round + 1,
         version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(reviewNote, now, id),
    releaseGuards(env.DB)
  ]);
  void operatorUserid;
};

export const cancelTask = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<void> => {
  const task = await loadTask(env, id);
  if (task.status !== "todo" && task.status !== "submitted")
    throw new WarehouseError(409, "任务已结束，不能取消");
  const version = requireVersion(input.version);
  const reason = requireText(input.reason, "取消原因", 300);
  const now = nowIso();
  await runAtomicBatch(env.DB, [
    guardTask(env.DB, id, version, ["todo", "submitted"]),
    env.DB.prepare(
      `UPDATE wh_task SET status = 'cancelled', cancel_reason = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(reason, now, id),
    ...(task.device_id === null
      ? []
      : [
          deviceEvent(
            env.DB,
            task.device_id,
            "task_cancelled",
            id,
            `任务取消：${reason}`,
            operatorUserid,
            now
          )
        ]),
    releaseGuards(env.DB)
  ]);
};
