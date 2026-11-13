/** 设备台账：建档、改主数据、查询。设备位置只能通过库房单改变，这里不碰。 */
import type { Env } from "../../types/env";
import type { Device, DeviceEvent, WhTask } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import {
  DEVICE_STATE_LABELS,
  DEVICE_STATE_SQL,
  DEVICE_STATES,
  type DeviceState
} from "./device-state";
import { nextDeviceCode } from "./device-code";
import { badRequest, WarehouseError } from "./errors";
import {
  optionalDate,
  optionalNumber,
  optionalText,
  requireEnum,
  requireId,
  requireText
} from "./validation";

export type DeviceRow = Device & {
  state: DeviceState;
  state_label: string;
  category_name: string;
  project_name: string | null;
};

export interface DeviceUsageRecord {
  doc_no: string;
  project_name: string;
  returned_at: string;
  usage_meters: number | null;
  soil_type: string | null;
}

export type DeviceDetail = DeviceRow & {
  open_tasks: Pick<WhTask, "id" | "task_no" | "kind" | "status" | "title" | "blocking">[];
  events: DeviceEvent[];
  usage_records: DeviceUsageRecord[];
  usage_meters_total: number;
};

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const nowIso = () => new Date().toISOString();

const TEXT_FIELDS: ReadonlyArray<[keyof Device, string, number]> = [
  ["alias", "现场叫法", 30],
  ["machine_type", "机型", 20],
  ["manufacturer", "厂家", 50],
  ["model", "型号", 50],
  ["serial_no", "出厂编号", 50],
  ["spec", "规格", 80],
  ["storage_note", "库位", 50],
  ["photo_key", "照片", 300],
  ["remark", "备注", 300]
];

const SELECT_ROW = `SELECT d.*, ${DEVICE_STATE_SQL} AS state, c.name AS category_name, p.project_name
  FROM device d
  JOIN device_category c ON c.id = d.category_id
  LEFT JOIN project p ON p.id = d.current_project_id`;

const withLabel = (row: Omit<DeviceRow, "state_label">): DeviceRow => ({
  ...row,
  state_label: DEVICE_STATE_LABELS[row.state]
});

const isCodeConflict = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: device.device_code");

const ensureActiveCategory = async (env: Env, categoryId: number): Promise<void> => {
  const row = await env.DB.prepare("SELECT status FROM device_category WHERE id = ?")
    .bind(categoryId)
    .first<{ status: string }>();
  if (!row || row.status !== "active") throw badRequest("设备类别不存在或已停用");
};

type DeviceColumns = Partial<Record<keyof Device, string | number | null>>;

const parseDeviceFields = async (
  env: Env,
  input: Record<string, unknown>,
  mode: "create" | "update"
): Promise<DeviceColumns> => {
  if ("location" in input || "current_project_id" in input) {
    throw badRequest("不能直接修改设备位置");
  }
  const has = (key: string) => mode === "create" || key in input;
  const columns: DeviceColumns = {};
  if (has("name")) columns.name = requireText(input.name, "设备名称", 80);
  if (has("category_id")) {
    const categoryId = requireId(input.category_id, "设备类别");
    await ensureActiveCategory(env, categoryId);
    columns.category_id = categoryId;
  }
  if ("device_code" in input) {
    const code =
      mode === "create"
        ? optionalText(input.device_code, "设备编号", 30)
        : requireText(input.device_code, "设备编号", 30);
    if (code) columns.device_code = code;
  }
  for (const [key, label, max] of TEXT_FIELDS) {
    if (has(key)) columns[key] = optionalText(input[key], label, max);
  }
  if (has("diameter_mm")) {
    columns.diameter_mm = optionalNumber(input.diameter_mm, "口径", {
      min: 100,
      max: 6000,
      integer: true
    });
  }
  if (has("ownership")) {
    columns.ownership =
      input.ownership === undefined
        ? "owned"
        : requireEnum(input.ownership, "所有权", ["owned", "leased_in"] as const);
  }
  if (has("purchased_date"))
    columns.purchased_date = optionalDate(input.purchased_date, "购入日期");
  return columns;
};

const insertDevice = async (
  env: Env,
  columns: DeviceColumns,
  code: string,
  operatorUserid: string
): Promise<number> => {
  const now = nowIso();
  const row: DeviceColumns = {
    ...columns,
    device_code: code,
    location: "warehouse",
    created_by_userid: operatorUserid,
    created_at: now,
    updated_at: now
  };
  const keys = Object.keys(row) as (keyof Device)[];
  await runAtomicBatch(env.DB, [
    env.DB.prepare(
      `INSERT INTO device (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
    ).bind(...keys.map((key) => row[key] ?? null)),
    env.DB.prepare(
      `INSERT INTO device_event (device_id, event_type, summary, operator_userid, occurred_at, created_at)
       VALUES ((SELECT id FROM device WHERE device_code = ?), 'created', '建档', ?, ?, ?)`
    ).bind(code, operatorUserid, now, now)
  ]);
  const created = await env.DB.prepare("SELECT id FROM device WHERE device_code = ?")
    .bind(code)
    .first<{ id: number }>();
  return Number(created?.id);
};

export const createDevice = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<{ id: number; device_code: string }> => {
  const columns = await parseDeviceFields(env, input, "create");
  const ownCode = typeof columns.device_code === "string" ? columns.device_code : null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = ownCode ?? (await nextDeviceCode(env, Number(columns.category_id)));
    try {
      return { id: await insertDevice(env, columns, code, operatorUserid), device_code: code };
    } catch (error) {
      if (!isCodeConflict(error)) throw error;
      if (ownCode || attempt === 1) throw new WarehouseError(409, "设备编号已存在");
    }
  }
  throw new WarehouseError(409, "设备编号已存在");
};

export const updateDevice = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<void> => {
  const columns = await parseDeviceFields(env, input, "update");
  const exists = await env.DB.prepare("SELECT id FROM device WHERE id = ?").bind(id).first();
  if (!exists) throw new WarehouseError(404, "设备不存在");
  const keys = Object.keys(columns) as (keyof Device)[];
  if (keys.length === 0) return;
  const now = nowIso();
  try {
    await runAtomicBatch(env.DB, [
      env.DB.prepare(
        `UPDATE device SET ${keys.map((key) => `${key} = ?`).join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`
      ).bind(...keys.map((key) => columns[key] ?? null), now, id),
      env.DB.prepare(
        `INSERT INTO device_event (device_id, event_type, summary, operator_userid, occurred_at, created_at)
         VALUES (?, 'updated', '修改档案', ?, ?, ?)`
      ).bind(id, operatorUserid, now, now)
    ]);
  } catch (error) {
    if (isCodeConflict(error)) throw new WarehouseError(409, "设备编号已存在");
    throw error;
  }
};

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listDevices = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<DeviceRow>> => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.state) {
    where.push(`(${DEVICE_STATE_SQL}) = ?`);
    params.push(requireEnum(query.state, "状态", DEVICE_STATES));
  }
  if (query.category_id) {
    where.push("d.category_id = ?");
    params.push(requireId(query.category_id, "设备类别"));
  }
  if (query.project_id) {
    where.push("d.current_project_id = ?");
    params.push(requireId(query.project_id, "项目"));
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("(d.device_code LIKE ? OR d.name LIKE ? OR d.alias LIKE ? OR d.model LIKE ?)");
    params.push(...Array.from({ length: 4 }, () => `%${keyword}%`));
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(`${SELECT_ROW}${whereSql} ORDER BY d.device_code ASC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<Omit<DeviceRow, "state_label">>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM device d${whereSql}`)
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return {
    items: (rows.results ?? []).map(withLabel),
    total: Number(count?.n ?? 0),
    page,
    pageSize
  };
};

export const getDeviceByCode = async (env: Env, code: string): Promise<DeviceRow | null> => {
  const row = await env.DB.prepare(`${SELECT_ROW} WHERE UPPER(d.device_code) = UPPER(?)`)
    .bind(code.trim())
    .first<Omit<DeviceRow, "state_label">>();
  return row ? withLabel(row) : null;
};

export const getDevice = async (env: Env, id: number): Promise<DeviceDetail | null> => {
  const row = await env.DB.prepare(`${SELECT_ROW} WHERE d.id = ?`)
    .bind(id)
    .first<Omit<DeviceRow, "state_label">>();
  if (!row) return null;
  const [tasks, events, usage] = await Promise.all([
    env.DB.prepare(
      `SELECT id, task_no, kind, status, title, blocking FROM wh_task
        WHERE device_id = ? AND status IN ('todo', 'submitted') ORDER BY id ASC`
    )
      .bind(id)
      .all<DeviceDetail["open_tasks"][number]>(),
    env.DB.prepare(
      "SELECT * FROM device_event WHERE device_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 50"
    )
      .bind(id)
      .all<DeviceEvent>(),
    env.DB.prepare(
      `SELECT doc.doc_no, p.project_name, doc.occurred_at AS returned_at, l.usage_meters, l.soil_type
         FROM wh_doc_line l
         JOIN wh_doc doc ON doc.id = l.doc_id
         LEFT JOIN project p ON p.id = doc.project_id
        WHERE l.device_id = ? AND doc.doc_type = 'back' AND doc.reverses_doc_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM wh_doc r WHERE r.reverses_doc_id = doc.id)
        ORDER BY doc.occurred_at ASC, doc.id ASC`
    )
      .bind(id)
      .all<DeviceUsageRecord>()
  ]);
  const usageRecords = (usage.results ?? []).map((record) => ({
    ...record,
    project_name: record.project_name ?? ""
  }));
  return {
    ...withLabel(row),
    open_tasks: tasks.results ?? [],
    events: events.results ?? [],
    usage_records: usageRecords,
    usage_meters_total: usageRecords.reduce(
      (sum, record) => sum + Number(record.usage_meters ?? 0),
      0
    )
  };
};

export const addDeviceNote = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<void> => {
  const summary = requireText(input.summary, "记事内容", 300);
  const exists = await env.DB.prepare("SELECT id FROM device WHERE id = ?").bind(id).first();
  if (!exists) throw new WarehouseError(404, "设备不存在");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO device_event (device_id, event_type, summary, operator_userid, occurred_at, created_at)
     VALUES (?, 'note', ?, ?, ?, ?)`
  )
    .bind(id, summary, operatorUserid, now, now)
    .run();
};
