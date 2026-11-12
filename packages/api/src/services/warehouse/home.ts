/**
 * 小程序库房首页一次要用的东西：我的权限、我的待办、我负责的项目、库管的待办数。
 * 手机经中继访问，一次往返比四次快。
 */
import type { AuthTokenPayload } from "../../types/auth";
import type { Env } from "../../types/env";
import { getWarehouseCapabilities, type WarehouseCapabilities } from "./access";
import { getOverviewCounts, type OverviewCounts } from "./overview";
import { SELECT_TASK, type TaskRow } from "./task-query";

export interface HomeProject {
  project_id: number;
  project_name: string;
  devices_on_site: number;
  /** 在场数大于 0 的周转件有几种 */
  materials_on_site: number;
  /** 草稿和待确认的清单数 */
  kits_open: number;
  kits_confirmed: number;
}

export interface WarehouseHome {
  caps: WarehouseCapabilities;
  my_tasks: { todo: number; items: TaskRow[] };
  my_projects: HomeProject[];
  keeper: OverviewCounts | null;
}

const MY_TASK_PREVIEW = 3;
const MY_PROJECT_LIMIT = 50;

const DEVICES_ON_SITE = `(SELECT COUNT(*) FROM device d
    WHERE d.location = 'project' AND d.current_project_id = p.id)`;
const MATERIALS_ON_SITE = `(SELECT COUNT(*) FROM (
    SELECT l.material_id FROM wh_doc_line l
     WHERE l.project_id = p.id AND l.material_id IS NOT NULL
     GROUP BY l.material_id
    HAVING ROUND(SUM(l.project_delta), 3) > 0))`;

const loadMyTasks = async (env: Env, userid: string): Promise<WarehouseHome["my_tasks"]> => {
  const [count, rows] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM wh_task WHERE assignee_userid = ? AND status = 'todo'"
    )
      .bind(userid)
      .first<{ n: number }>(),
    env.DB.prepare(
      `${SELECT_TASK} WHERE t.assignee_userid = ? AND t.status = 'todo'
       ORDER BY t.due_date IS NULL, t.due_date ASC, t.id ASC LIMIT ?`
    )
      .bind(userid, MY_TASK_PREVIEW)
      .all<TaskRow>()
  ]);
  return { todo: Number(count?.n ?? 0), items: rows.results ?? [] };
};

/** 我负责的项目：没归档的，加上已归档但还有东西在场的（工程结束了东西还没清回来）。 */
const loadMyProjects = async (env: Env, userid: string): Promise<HomeProject[]> => {
  const rows = await env.DB.prepare(
    `SELECT * FROM (
       SELECT p.id AS project_id, p.project_name, p.status,
              ${DEVICES_ON_SITE} AS devices_on_site,
              ${MATERIALS_ON_SITE} AS materials_on_site,
              (SELECT COUNT(*) FROM project_kit k
                WHERE k.project_id = p.id AND k.status IN ('draft', 'submitted')) AS kits_open,
              (SELECT COUNT(*) FROM project_kit k
                WHERE k.project_id = p.id AND k.status = 'confirmed') AS kits_confirmed
         FROM project p
        WHERE p.manager_userid = ?
     )
     WHERE status <> 'archived' OR devices_on_site > 0 OR materials_on_site > 0
     ORDER BY project_name ASC, project_id ASC
     LIMIT ?`
  )
    .bind(userid, MY_PROJECT_LIMIT)
    .all<HomeProject & { status: string }>();
  return (rows.results ?? []).map((row) => ({
    project_id: Number(row.project_id),
    project_name: row.project_name,
    devices_on_site: Number(row.devices_on_site),
    materials_on_site: Number(row.materials_on_site),
    kits_open: Number(row.kits_open),
    kits_confirmed: Number(row.kits_confirmed)
  }));
};

export const getWarehouseHome = async (
  env: Env,
  auth: AuthTokenPayload
): Promise<WarehouseHome> => {
  const [caps, myTasks, myProjects] = await Promise.all([
    getWarehouseCapabilities(env, auth),
    loadMyTasks(env, auth.sub),
    loadMyProjects(env, auth.sub)
  ]);
  return {
    caps,
    my_tasks: myTasks,
    my_projects: myProjects,
    keeper: caps.is_keeper ? await getOverviewCounts(env) : null
  };
};
