/** 库房任务的查询。 */
import type { Env } from "../../types/env";
import type { WhTask, WhTaskPhoto } from "../../types/wh";
import type { Paged } from "./device";
import { requireEnum, requireId } from "./validation";

export type TaskRow = WhTask & {
  device_code: string | null;
  device_name: string | null;
  photo_count: number;
};

const SELECT_TASK = `SELECT t.*, d.device_code, d.name AS device_name,
    (SELECT COUNT(*) FROM wh_task_photo ph WHERE ph.task_id = t.id AND ph.deleted_at IS NULL) AS photo_count
  FROM wh_task t
  LEFT JOIN device d ON d.id = t.device_id`;

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listTasks = async (
  env: Env,
  query: Record<string, string | undefined>,
  userid: string
): Promise<Paged<TaskRow>> => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if ((query.scope ?? "all") === "mine") {
    where.push("t.assignee_userid = ?");
    params.push(userid);
  }
  if (query.status) {
    where.push("t.status = ?");
    params.push(
      requireEnum(query.status, "任务状态", ["todo", "submitted", "done", "cancelled"] as const)
    );
  }
  if (query.kind) {
    where.push("t.kind = ?");
    params.push(
      requireEnum(query.kind, "任务类型", [
        "inspection",
        "maintenance",
        "servicing",
        "other"
      ] as const)
    );
  }
  if (query.device_id) {
    where.push("t.device_id = ?");
    params.push(requireId(query.device_id, "设备"));
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `${SELECT_TASK}${whereSql}
       ORDER BY (t.status IN ('todo', 'submitted')) DESC, t.due_date IS NULL, t.due_date ASC, t.id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<TaskRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM wh_task t${whereSql}`)
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return { items: rows.results ?? [], total: Number(count?.n ?? 0), page, pageSize };
};

export const getTask = async (
  env: Env,
  id: number
): Promise<(TaskRow & { photos: WhTaskPhoto[] }) | null> => {
  const row = await env.DB.prepare(`${SELECT_TASK} WHERE t.id = ?`).bind(id).first<TaskRow>();
  if (!row) return null;
  const photos = await env.DB.prepare(
    "SELECT * FROM wh_task_photo WHERE task_id = ? AND deleted_at IS NULL ORDER BY id ASC"
  )
    .bind(id)
    .all<WhTaskPhoto>();
  return { ...row, photos: photos.results ?? [] };
};
