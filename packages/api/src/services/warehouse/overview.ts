/** 库房总览页的数字和最近单据。 */
import type { Env } from "../../types/env";
import { DEVICE_STATE_SQL } from "./device-state";
import { listWhDocs, type WhDocRow } from "./doc-query";

export interface WarehouseOverview {
  tasks_to_confirm: number;
  tasks_unassigned: number;
  tasks_overdue: number;
  devices_pending_inspection: number;
  devices_repairing: number;
  devices_on_project: number;
  low_stock_count: number;
  recent_docs: WhDocRow[];
}

const beijingToday = (): string =>
  new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export const getWarehouseOverview = async (env: Env): Promise<WarehouseOverview> => {
  const [tasks, devices, lowStock, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS to_confirm,
         SUM(CASE WHEN status = 'todo' AND assignee_userid IS NULL THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN status IN ('todo', 'submitted') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
       FROM wh_task`
    )
      .bind(beijingToday())
      .first<{ to_confirm: number | null; unassigned: number | null; overdue: number | null }>(),
    env.DB.prepare(
      `SELECT ${DEVICE_STATE_SQL} AS state, COUNT(*) AS n FROM device d GROUP BY state`
    ).all<{
      state: string;
      n: number;
    }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM material WHERE status = 'active' AND min_stock IS NOT NULL AND quantity <= min_stock"
    ).first<{ n: number }>(),
    listWhDocs(env, { pageSize: "10" })
  ]);
  const byState = new Map((devices.results ?? []).map((row) => [row.state, Number(row.n)]));
  return {
    tasks_to_confirm: Number(tasks?.to_confirm ?? 0),
    tasks_unassigned: Number(tasks?.unassigned ?? 0),
    tasks_overdue: Number(tasks?.overdue ?? 0),
    devices_pending_inspection: byState.get("pending_inspection") ?? 0,
    devices_repairing: byState.get("repairing") ?? 0,
    devices_on_project: byState.get("on_project") ?? 0,
    low_stock_count: Number(lowStock?.n ?? 0),
    recent_docs: recent.items
  };
};
