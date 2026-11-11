/**
 * 设备状态不存储，由位置和未完成的阻塞任务算出。全系统只用这里的 SQL 片段，保证列表、详情、发货判断一致。
 * 规则见设计稿 6.2：从上到下取第一个命中。
 */
export type DeviceState =
  | "scrapped"
  | "on_project"
  | "repairing"
  | "pending_inspection"
  | "blocked"
  | "available";

export const DEVICE_STATES: readonly DeviceState[] = [
  "scrapped",
  "on_project",
  "repairing",
  "pending_inspection",
  "blocked",
  "available"
];

export const DEVICE_STATE_LABELS: Record<DeviceState, string> = {
  scrapped: "已报废",
  on_project: "在项目",
  repairing: "维修中",
  pending_inspection: "待检",
  blocked: "暂不可用",
  available: "可用"
};

export const OPEN_TASK_STATUSES = ["todo", "submitted"] as const;

const openBlocking = (deviceIdSql: string, kind?: "maintenance" | "inspection"): string =>
  `EXISTS (SELECT 1 FROM wh_task t WHERE t.device_id = ${deviceIdSql} AND t.blocking = 1 AND t.status IN ('todo', 'submitted')${
    kind ? ` AND t.kind = '${kind}'` : ""
  })`;

/** 以 d 为设备表别名的 CASE 表达式，结果是 DeviceState。 */
export const DEVICE_STATE_SQL = `CASE
  WHEN d.location = 'scrapped' THEN 'scrapped'
  WHEN d.location = 'project' THEN 'on_project'
  WHEN ${openBlocking("d.id", "maintenance")} THEN 'repairing'
  WHEN ${openBlocking("d.id", "inspection")} THEN 'pending_inspection'
  WHEN ${openBlocking("d.id")} THEN 'blocked'
  ELSE 'available'
END`;

/** 断言用：设备 ? 在库且没有未完成的阻塞任务。绑定一个参数（设备 id）。 */
export const DEVICE_DISPATCHABLE_EXISTS_SQL = `SELECT 1 FROM device d WHERE d.id = ? AND d.location = 'warehouse' AND NOT ${openBlocking("d.id")}`;
