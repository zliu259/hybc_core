/**
 * 项目物资页（现有"设备出入库登记表"的自动版）和清单执行情况。
 * 全部从库房单汇总：用带符号的列相加，冲销单自动抵消。
 */
import type { Env } from "../../types/env";
import type { MaterialKind } from "../../types/wh";
import { listDevices, type DeviceRow } from "./device";
import { DEVICE_STATE_SQL } from "./device-state";
import { WarehouseError } from "./errors";
import { allocateShipped, type AllocKey, type AllocLine } from "./kit-allocation";
import {
  getProjectKitHeader,
  listProjectKits,
  loadKitLines,
  type ProjectKitLineView,
  type ProjectKitRow
} from "./kit-query";
import { queryIn } from "./query-in";

export interface LedgerMaterialRow {
  material_id: number;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  /** 物资分节（顶进设备、辅助设备……），页面按它分组。 */
  category: string;
  kind: MaterialKind;
  planned: number;
  shipped: number;
  transferred_out: number;
  returned: number;
  lost: number;
  /** 只有周转件有在场数；消耗类发出即用掉，为 null。 */
  on_site: number | null;
  first_out_at: string | null;
  last_back_at: string | null;
  unit_price: number | null;
  loss_amount: number | null;
}

export interface LedgerDeviceRow {
  device_category_id: number;
  category_name: string;
  planned: number;
  shipped: number;
  on_site: number;
}

export interface ProjectLedger {
  project_id: number;
  project_name: string;
  settled: boolean;
  devices_on_site: number;
  turnover_kinds_on_site: number;
  materials: LedgerMaterialRow[];
  device_categories: LedgerDeviceRow[];
  devices: DeviceRow[];
  kits: ProjectKitRow[];
}

export interface KitFulfilmentLine extends ProjectKitLineView {
  shipped: number;
  pending: number;
  /** 物资是在库数，设备是这个类别现在"可用"的台数，备忘行为 null。 */
  in_stock: number | null;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const EPSILON = 1e-9;

/** 没被冲销、本身也不是冲销单。 */
const LIVE_DOC = `d.reverses_doc_id IS NULL AND NOT EXISTS (SELECT 1 FROM wh_doc r WHERE r.reverses_doc_id = d.id)`;

interface MaterialMovement {
  material_id: number;
  shipped: number;
  transferred_out: number;
  returned: number;
  lost: number;
  on_site: number;
  first_out_at: string | null;
  last_back_at: string | null;
}

const loadMaterialMovements = async (env: Env, projectId: number): Promise<MaterialMovement[]> =>
  (
    await env.DB.prepare(
      `SELECT l.material_id,
              ROUND(SUM(CASE WHEN d.doc_type = 'out' THEN -l.stock_delta
                             WHEN d.doc_type = 'transfer' AND d.to_project_id = ?1 THEN l.project_delta
                             ELSE 0 END), 3) AS shipped,
              ROUND(SUM(CASE WHEN d.doc_type = 'transfer' AND d.project_id = ?1 AND d.to_project_id <> ?1
                             THEN -l.project_delta ELSE 0 END), 3) AS transferred_out,
              ROUND(SUM(CASE WHEN d.doc_type = 'back' AND l.outcome = 'returned' THEN l.stock_delta ELSE 0 END), 3) AS returned,
              ROUND(SUM(CASE WHEN d.doc_type = 'back' AND l.outcome = 'lost' THEN -l.project_delta ELSE 0 END), 3) AS lost,
              ROUND(SUM(l.project_delta), 3) AS on_site,
              MIN(CASE WHEN d.doc_type = 'out' AND ${LIVE_DOC} THEN d.occurred_at END) AS first_out_at,
              MAX(CASE WHEN d.doc_type = 'back' AND ${LIVE_DOC} THEN d.occurred_at END) AS last_back_at
         FROM wh_doc_line l JOIN wh_doc d ON d.id = l.doc_id
        WHERE l.project_id = ?1 AND l.material_id IS NOT NULL
        GROUP BY l.material_id`
    )
      .bind(projectId)
      .all<MaterialMovement>()
  ).results ?? [];

/** 设备已发：发往这个项目和转入这个项目的设备行，原单 +1、冲销单 -1，按类别汇总。 */
const loadDeviceShipped = async (env: Env, projectId: number): Promise<Map<number, number>> => {
  const rows =
    (
      await env.DB.prepare(
        `SELECT dv.category_id AS category_id,
                SUM(CASE WHEN d.reverses_doc_id IS NULL THEN 1 ELSE -1 END) AS shipped
           FROM wh_doc_line l
           JOIN wh_doc d ON d.id = l.doc_id
           JOIN device dv ON dv.id = l.device_id
          WHERE l.device_id IS NOT NULL AND l.project_id = ?1
            AND (d.doc_type = 'out' OR (d.doc_type = 'transfer' AND d.to_project_id = ?1))
          GROUP BY dv.category_id`
      )
        .bind(projectId)
        .all<{ category_id: number; shipped: number }>()
    ).results ?? [];
  return new Map(rows.map((row) => [Number(row.category_id), Number(row.shipped)]));
};

/** 项目已发数（清单分摊用）：物资 `m:<id>`，设备类别 `c:<id>`。 */
export const loadProjectShipped = async (
  env: Env,
  projectId: number
): Promise<Map<AllocKey, number>> => {
  const [materials, devices] = await Promise.all([
    loadMaterialMovements(env, projectId),
    loadDeviceShipped(env, projectId)
  ]);
  return new Map<AllocKey, number>([
    ...materials.map((row): [AllocKey, number] => [`m:${row.material_id}`, Number(row.shipped)]),
    ...[...devices].map(([categoryId, shipped]): [AllocKey, number] => [`c:${categoryId}`, shipped])
  ]);
};

/**
 * 已确认、已关闭清单里"库房发"且计划数大于 0 的行，按确认先后排好。
 * 作废的清单（没确认就关掉，confirmed_at 为空）不算。
 */
const loadAllocatableLines = async (
  env: Env,
  projectId: number
): Promise<
  {
    id: number;
    line_kind: "device" | "material";
    material_id: number | null;
    device_category_id: number | null;
    planned_qty: number;
  }[]
> =>
  (
    await env.DB.prepare(
      `SELECT l.id, l.line_kind, l.material_id, l.device_category_id, l.planned_qty
         FROM project_kit_line l JOIN project_kit k ON k.id = l.kit_id
        WHERE k.project_id = ? AND k.status IN ('confirmed', 'closed') AND k.confirmed_at IS NOT NULL
          AND l.source = 'warehouse' AND l.planned_qty > 0 AND l.line_kind IN ('material', 'device')
        ORDER BY k.confirmed_at ASC, k.id ASC, l.sort_order ASC, l.id ASC`
    )
      .bind(projectId)
      .all<{
        id: number;
        line_kind: "device" | "material";
        material_id: number | null;
        device_category_id: number | null;
        planned_qty: number;
      }>()
  ).results ?? [];

const lineKey = (line: {
  line_kind: string;
  material_id: number | null;
  device_category_id: number | null;
}): AllocKey | null =>
  line.line_kind === "material" && line.material_id
    ? `m:${line.material_id}`
    : line.line_kind === "device" && line.device_category_id
      ? `c:${line.device_category_id}`
      : null;

const sumPlanned = (
  lines: Awaited<ReturnType<typeof loadAllocatableLines>>,
  pick: (line: (typeof lines)[number]) => number | null
): Map<number, number> => {
  const totals = new Map<number, number>();
  for (const line of lines) {
    const id = pick(line);
    if (id) totals.set(id, round3((totals.get(id) ?? 0) + Number(line.planned_qty)));
  }
  return totals;
};

export const getProjectLedger = async (env: Env, projectId: number): Promise<ProjectLedger> => {
  const project = await env.DB.prepare("SELECT id, project_name FROM project WHERE id = ?")
    .bind(projectId)
    .first<{ id: number; project_name: string }>();
  if (!project) throw new WarehouseError(404, "项目不存在");

  const [movements, deviceShipped, planLines, devices, kits] = await Promise.all([
    loadMaterialMovements(env, projectId),
    loadDeviceShipped(env, projectId),
    loadAllocatableLines(env, projectId),
    listDevices(env, { project_id: String(projectId), pageSize: "200" }),
    listProjectKits(env, { project_id: String(projectId), pageSize: "200" })
  ]);
  const plannedMaterials = sumPlanned(planLines, (line) =>
    line.line_kind === "material" ? line.material_id : null
  );
  const plannedCategories = sumPlanned(planLines, (line) =>
    line.line_kind === "device" ? line.device_category_id : null
  );

  const movementById = new Map(movements.map((row) => [Number(row.material_id), row]));
  const materialIds = [...new Set([...plannedMaterials.keys(), ...movementById.keys()])];
  const info = await queryIn<{
    id: number;
    material_code: string;
    name: string;
    spec: string;
    unit: string;
    category: string;
    kind: MaterialKind;
    unit_price: number | null;
  }>(
    env.DB,
    (inList) =>
      `SELECT id, material_code, name, spec, unit, category, kind, unit_price FROM material WHERE id IN (${inList})`,
    materialIds
  );
  const materials = info
    .map((material): LedgerMaterialRow => {
      const move = movementById.get(Number(material.id));
      const lost = Number(move?.lost ?? 0);
      const turnover = material.kind === "turnover";
      return {
        material_id: Number(material.id),
        material_code: material.material_code,
        name: material.name,
        spec: material.spec ?? "",
        unit: material.unit,
        category: material.category,
        kind: material.kind,
        planned: plannedMaterials.get(Number(material.id)) ?? 0,
        shipped: Number(move?.shipped ?? 0),
        transferred_out: Number(move?.transferred_out ?? 0),
        returned: Number(move?.returned ?? 0),
        lost,
        on_site: turnover ? Number(move?.on_site ?? 0) : null,
        first_out_at: move?.first_out_at ?? null,
        last_back_at: move?.last_back_at ?? null,
        unit_price: material.unit_price ?? null,
        loss_amount:
          material.unit_price === null || material.unit_price === undefined
            ? null
            : Math.round(lost * Number(material.unit_price) * 100) / 100
      };
    })
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category, "zh-Hans-CN") ||
        a.material_code.localeCompare(b.material_code)
    );

  const onSiteByCategory = new Map<number, number>();
  for (const device of devices.items) {
    const id = Number(device.category_id);
    onSiteByCategory.set(id, (onSiteByCategory.get(id) ?? 0) + 1);
  }
  const categoryIds = [
    ...new Set([...plannedCategories.keys(), ...deviceShipped.keys(), ...onSiteByCategory.keys()])
  ];
  const categoryNames = new Map(
    (
      await queryIn<{ id: number; name: string }>(
        env.DB,
        (inList) => `SELECT id, name FROM device_category WHERE id IN (${inList})`,
        categoryIds
      )
    ).map((row) => [Number(row.id), row.name])
  );
  const deviceCategories = categoryIds
    .map((id) => ({
      device_category_id: id,
      category_name: categoryNames.get(id) ?? "",
      planned: plannedCategories.get(id) ?? 0,
      shipped: deviceShipped.get(id) ?? 0,
      on_site: onSiteByCategory.get(id) ?? 0
    }))
    .sort((a, b) => a.category_name.localeCompare(b.category_name, "zh-Hans-CN"));

  const devicesOnSite = devices.items.length;
  const turnoverKindsOnSite = materials.filter(
    (row) => row.on_site !== null && row.on_site > EPSILON
  ).length;
  return {
    project_id: Number(project.id),
    project_name: project.project_name,
    settled: devicesOnSite === 0 && turnoverKindsOnSite === 0,
    devices_on_site: devicesOnSite,
    turnover_kinds_on_site: turnoverKindsOnSite,
    materials,
    device_categories: deviceCategories,
    devices: devices.items,
    kits: kits.items
  };
};

/** 物资在库数、设备类别"可用"台数，清单执行情况里给"在库"一列用。 */
const loadInStock = async (
  env: Env,
  lines: readonly ProjectKitLineView[]
): Promise<Map<AllocKey, number>> => {
  const materialIds = [
    ...new Set(lines.flatMap((line) => (line.material_id ? [line.material_id] : [])))
  ];
  const categoryIds = [
    ...new Set(lines.flatMap((line) => (line.device_category_id ? [line.device_category_id] : [])))
  ];
  const [materials, categories] = await Promise.all([
    queryIn<{ id: number; quantity: number }>(
      env.DB,
      (inList) => `SELECT id, quantity FROM material WHERE id IN (${inList})`,
      materialIds
    ),
    queryIn<{ category_id: number; n: number }>(
      env.DB,
      (inList) =>
        `SELECT d.category_id, COUNT(*) AS n FROM device d
          WHERE d.category_id IN (${inList}) AND ${DEVICE_STATE_SQL} = 'available'
          GROUP BY d.category_id`,
      categoryIds
    )
  ]);
  return new Map<AllocKey, number>([
    ...materials.map((row): [AllocKey, number] => [`m:${row.id}`, Number(row.quantity)]),
    ...categories.map((row): [AllocKey, number] => [`c:${row.category_id}`, Number(row.n)])
  ]);
};

export const getKitFulfilment = async (env: Env, kitId: number): Promise<KitFulfilmentLine[]> => {
  const kit = await getProjectKitHeader(env, kitId);
  if (!kit) throw new WarehouseError(404, "清单不存在");
  const lines = await loadKitLines(env, kitId);
  // 确认过的清单才参与分摊；作废的（没确认就关掉）既不分已发，也不再显示待发
  const counted =
    (kit.status === "confirmed" || kit.status === "closed") && kit.confirmed_at !== null;
  const discarded = kit.status === "closed" && kit.confirmed_at === null;
  let allocation = new Map<number, number>();
  if (counted) {
    const [planLines, shipped] = await Promise.all([
      loadAllocatableLines(env, kit.project_id),
      loadProjectShipped(env, kit.project_id)
    ]);
    const allocLines = planLines.flatMap((line): AllocLine[] => {
      const key = lineKey(line);
      return key ? [{ line_id: Number(line.id), key, planned: Number(line.planned_qty) }] : [];
    });
    allocation = allocateShipped(allocLines, shipped);
  }
  const inStock = await loadInStock(env, lines);
  return lines.map((line) => {
    const key = lineKey(line);
    const planned = Number(line.planned_qty);
    const tracked = key !== null && line.source === "warehouse" && planned > 0;
    const shipped = tracked && counted ? (allocation.get(Number(line.id)) ?? 0) : 0;
    return {
      ...line,
      shipped,
      pending: tracked && !discarded ? round3(planned - shipped) : 0,
      in_stock: key ? (inStock.get(key) ?? 0) : null
    };
  });
};
