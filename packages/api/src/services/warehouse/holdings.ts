/**
 * 项目在场：在该项目上的设备，以及项目名下的周转件数量。
 * 周转件在场数 = 该项目该物资所有单据行 project_delta 之和（发出加，退回、报损减，转场一减一加）。
 */
import type { Env } from "../../types/env";
import { listDevices, type DeviceRow } from "./device";
import { queryIn } from "./query-in";

export interface MaterialHolding {
  material_id: number;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  holding: number;
}

/** 断言用：项目 ? 名下物资 ? 的在场数不少于 ?。绑定三个参数。 */
export const HOLDING_AT_LEAST_EXISTS_SQL =
  "SELECT 1 WHERE (SELECT ROUND(COALESCE(SUM(project_delta), 0), 3) FROM wh_doc_line WHERE project_id = ? AND material_id = ?) >= ?";

export const loadHoldings = async (
  env: Env,
  projectId: number,
  materialIds: readonly number[]
): Promise<Map<number, number>> => {
  if (materialIds.length === 0) return new Map();
  const rows = await queryIn<{ material_id: number; holding: number }>(
    env.DB,
    (inList) =>
      `SELECT material_id, ROUND(COALESCE(SUM(project_delta), 0), 3) AS holding
         FROM wh_doc_line
        WHERE project_id = ? AND material_id IN (${inList})
        GROUP BY material_id`,
    materialIds,
    [projectId]
  );
  return new Map(rows.map((row) => [Number(row.material_id), Number(row.holding)]));
};

export const getProjectHoldings = async (
  env: Env,
  projectId: number
): Promise<{ devices: DeviceRow[]; materials: MaterialHolding[] }> => {
  const [devices, materials] = await Promise.all([
    listDevices(env, { project_id: String(projectId), pageSize: "200" }),
    env.DB.prepare(
      `SELECT m.id AS material_id, m.material_code, m.name, m.spec, m.unit,
              ROUND(SUM(l.project_delta), 3) AS holding
         FROM wh_doc_line l
         JOIN material m ON m.id = l.material_id
        WHERE l.project_id = ?
        GROUP BY m.id
       HAVING holding > 0
        ORDER BY m.id ASC`
    )
      .bind(projectId)
      .all<MaterialHolding>()
  ]);
  return {
    devices: devices.items,
    materials: (materials.results ?? []).map((row) => ({ ...row, holding: Number(row.holding) }))
  };
};
