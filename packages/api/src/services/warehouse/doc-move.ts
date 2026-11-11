/**
 * 发往项目（out）、项目返库（back）、项目间转场（transfer）。
 * 先做普通查询给出具体的中文错误，再把同样的前置条件写成批内断言兜住并发。
 */
import type { Env } from "../../types/env";
import type { Device, Material, WhTaskKind } from "../../types/wh";
import { generateSerials } from "../serial";
import { DEVICE_DISPATCHABLE_EXISTS_SQL } from "./device-state";
import {
  adjustMaterial,
  docDeviceEvent,
  executeDoc,
  insertLine,
  type LineSpec,
  type WhDocResult
} from "./doc-core";
import { loadActiveMaterials, materialLabel, requireProjectId, type ParsedDoc } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch } from "./guard";
import { HOLDING_AT_LEAST_EXISTS_SQL, loadHoldings } from "./holdings";
import { getWarehouseSettings } from "./settings";
import { buildTaskInsert, type TaskDraft } from "./task";
import { queryIn } from "./query-in";

const KIND_LABELS: Record<WhTaskKind, string> = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  other: "其他"
};

const num = (value: number): string => String(Number(value.toFixed(3)));

const projectName = async (env: Env, id: number): Promise<string> => {
  const row = await env.DB.prepare("SELECT project_name FROM project WHERE id = ?")
    .bind(id)
    .first<{ project_name: string }>();
  return row?.project_name ?? "";
};

const loadDevices = async (env: Env, ids: readonly number[]): Promise<Map<number, Device>> => {
  if (ids.length === 0) return new Map();
  const rows = await queryIn<Device>(
    env.DB,
    (inList) => `SELECT * FROM device WHERE id IN (${inList})`,
    ids
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const id of ids) if (!byId.has(id)) throw badRequest("设备不存在");
  return byId;
};

const whereIs = async (env: Env, device: Device): Promise<string> => {
  if (device.location === "scrapped") return "已报废";
  if (device.location === "warehouse" || device.current_project_id === null) return "库房";
  return projectName(env, device.current_project_id);
};

const assertDispatchable = async (env: Env, devices: Device[]): Promise<void> => {
  for (const device of devices) {
    if (device.location !== "warehouse")
      throw new WarehouseError(409, `${device.device_code} 不在库`);
  }
  if (devices.length === 0) return;
  const rows = await queryIn<{ id: number; device_id: number; kind: WhTaskKind }>(
    env.DB,
    (inList) =>
      `SELECT id, device_id, kind FROM wh_task
        WHERE blocking = 1 AND status IN ('todo', 'submitted') AND device_id IN (${inList})`,
    devices.map((device) => device.id)
  );
  // 分段查询后统一排序：先报维修中，再报待检，其他最后
  const rank = (kind: WhTaskKind) => (kind === "maintenance" ? 0 : kind === "inspection" ? 1 : 2);
  const first = [...rows].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || Number(a.id) - Number(b.id)
  )[0];
  if (first) {
    const device = devices.find((item) => item.id === Number(first.device_id));
    throw new WarehouseError(
      409,
      `${device?.device_code ?? ""} 有未完成的${KIND_LABELS[first.kind]}任务，不能发出`
    );
  }
};

const assertAtProject = async (env: Env, devices: Device[], projectId: number): Promise<void> => {
  for (const device of devices) {
    if (device.location !== "project" || device.current_project_id !== projectId) {
      throw new WarehouseError(
        409,
        `${device.device_code} 不在该项目，现在在：${await whereIs(env, device)}`
      );
    }
  }
};

const sumByMaterial = (lines: ParsedDoc["material_lines"]): Map<number, number> => {
  const totals = new Map<number, number>();
  for (const line of lines)
    totals.set(line.material_id, (totals.get(line.material_id) ?? 0) + line.quantity);
  return totals;
};

const assertHoldings = async (
  env: Env,
  projectId: number,
  totals: Map<number, number>,
  materials: Map<number, Material>
): Promise<void> => {
  const holdings = await loadHoldings(env, projectId, [...totals.keys()]);
  for (const [materialId, total] of totals) {
    const holding = holdings.get(materialId) ?? 0;
    if (total > holding + 1e-9) {
      throw badRequest(
        `${materialLabel(materials.get(materialId) as Material)} 在场只有 ${num(holding)}`
      );
    }
  }
};

const beijingDatePlusDays = (iso: string, days: number): string => {
  const date = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const baseLine = (patch: Partial<LineSpec>): LineSpec => ({
  device_id: null,
  material_id: null,
  quantity: 1,
  outcome: "normal",
  stock_delta: 0,
  project_id: null,
  project_delta: 0,
  usage_meters: null,
  soil_type: null,
  note: null,
  ...patch
});

/** 按清单发货：清单要属于这个项目并且已确认。 */
const assertKitShippable = async (env: Env, kitId: number, projectId: number): Promise<void> => {
  const kit = await env.DB.prepare("SELECT project_id, status FROM project_kit WHERE id = ?")
    .bind(kitId)
    .first<{ project_id: number; status: string }>();
  if (!kit) throw badRequest("配套清单不存在");
  if (Number(kit.project_id) !== projectId) throw badRequest("配套清单不属于这个项目");
  if (kit.status === "closed") throw new WarehouseError(409, "配套清单已关闭");
  if (kit.status !== "confirmed") throw new WarehouseError(409, "配套清单还没确认");
};

export const createMoveDoc = async (
  env: Env,
  doc: ParsedDoc,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WhDocResult> => {
  const type = doc.doc_type;
  const fromProject = await requireProjectId(env, input.project_id);
  const toProject =
    type === "transfer" ? await requireProjectId(env, input.to_project_id, "目的项目") : null;
  if (toProject !== null && toProject === fromProject) throw badRequest("来源和目的项目不能相同");
  if (doc.project_kit_id !== null) await assertKitShippable(env, doc.project_kit_id, fromProject);
  const fromName = await projectName(env, fromProject);
  const toName = toProject === null ? "" : await projectName(env, toProject);

  const materials = await loadActiveMaterials(env, doc.material_lines);
  const devices = [
    ...(
      await loadDevices(
        env,
        doc.device_lines.map((line) => line.device_id)
      )
    ).values()
  ];
  const deviceById = new Map(devices.map((device) => [device.id, device]));

  for (const line of doc.material_lines) {
    const material = materials.get(line.material_id) as Material;
    if (type !== "back" && line.outcome !== null) throw badRequest("只有返库单需要选退回或报损");
    if (type === "back" && line.outcome === null)
      throw badRequest(`请选择退回还是报损：${materialLabel(material)}`);
    if (type === "back" && material.kind === "consumable" && line.outcome === "lost") {
      throw badRequest(`耗材不需要报损：${material.name}`);
    }
    if (type === "transfer" && material.kind === "consumable")
      throw badRequest(`耗材不能转场：${material.name}`);
  }

  const totals = sumByMaterial(doc.material_lines);
  if (type === "out") {
    await assertDispatchable(env, devices);
    for (const [materialId, total] of totals) {
      const material = materials.get(materialId) as Material;
      if (total > material.quantity + 1e-9) {
        throw badRequest(`库存不足：${materialLabel(material)}，在库 ${num(material.quantity)}`);
      }
    }
  } else {
    await assertAtProject(env, devices, fromProject);
    const turnoverTotals = new Map(
      [...totals].filter(([materialId]) => materials.get(materialId)?.kind === "turnover")
    );
    await assertHoldings(env, fromProject, turnoverTotals, materials);
  }

  let needInspection: Device[] = [];
  if (type === "back" && devices.length > 0) {
    // 已经有挡住发出的检查在办就不再建；不挡发出的手工检查不能代替返库检查
    const open = await queryIn<{ device_id: number }>(
      env.DB,
      (inList) =>
        `SELECT DISTINCT device_id FROM wh_task
          WHERE kind = 'inspection' AND blocking = 1 AND status IN ('todo', 'submitted') AND device_id IN (${inList})`,
      devices.map((device) => device.id)
    );
    const busy = new Set(open.map((row) => Number(row.device_id)));
    needInspection = devices.filter((device) => !busy.has(device.id));
  }
  const settings = needInspection.length > 0 ? await getWarehouseSettings(env) : null;
  const crid = doc.client_request_id;

  return executeDoc(env, {
    clientRequestId: crid,
    operatorUserid,
    header: { ...doc, project_id: fromProject, to_project_id: toProject, reverses_doc_id: null },
    build: async (now) => {
      const db = env.DB;
      const statements: D1PreparedStatement[] = [];
      if (doc.project_kit_id !== null) {
        // 清单在提交途中被关闭或作废时整单回滚
        statements.push(
          assertInBatch(
            db,
            "SELECT 1 FROM project_kit WHERE id = ? AND project_id = ? AND status = 'confirmed'",
            [doc.project_kit_id, fromProject]
          )
        );
      }
      for (const device of devices) {
        statements.push(
          type === "out"
            ? assertInBatch(db, DEVICE_DISPATCHABLE_EXISTS_SQL, [device.id])
            : assertInBatch(
                db,
                "SELECT 1 FROM device WHERE id = ? AND location = 'project' AND current_project_id = ?",
                [device.id, fromProject]
              )
        );
      }
      if (type !== "out") {
        for (const [materialId, total] of totals) {
          if (materials.get(materialId)?.kind === "turnover") {
            statements.push(
              assertInBatch(db, HOLDING_AT_LEAST_EXISTS_SQL, [fromProject, materialId, total])
            );
          }
        }
      }

      for (const line of doc.device_lines) {
        const device = deviceById.get(line.device_id) as Device;
        const target = type === "out" ? fromProject : type === "transfer" ? toProject : null;
        statements.push(
          db
            .prepare(
              `UPDATE device SET location = ?, current_project_id = ?, version = version + 1, updated_at = ? WHERE id = ?`
            )
            .bind(target === null ? "warehouse" : "project", target, now, device.id),
          insertLine(
            db,
            crid,
            baseLine({
              device_id: device.id,
              project_id: type === "transfer" ? toProject : fromProject,
              usage_meters: type === "back" ? line.usage_meters : null,
              soil_type: type === "back" ? line.soil_type : null,
              note: line.note
            }),
            now
          ),
          docDeviceEvent(
            db,
            device.id,
            type === "out" ? "dispatched" : type === "back" ? "returned" : "transferred",
            crid,
            type === "out"
              ? `发往${fromName}`
              : type === "back"
                ? `从${fromName}返库`
                : `从${fromName}转到${toName}`,
            operatorUserid,
            now
          )
        );
      }

      for (const line of doc.material_lines) {
        const material = materials.get(line.material_id) as Material;
        const turnover = material.kind === "turnover";
        const q = line.quantity;
        if (type === "transfer") {
          statements.push(
            insertLine(
              db,
              crid,
              baseLine({
                material_id: material.id,
                quantity: q,
                project_id: fromProject,
                project_delta: -q,
                note: line.note
              }),
              now
            ),
            insertLine(
              db,
              crid,
              baseLine({
                material_id: material.id,
                quantity: q,
                project_id: toProject,
                project_delta: q,
                note: line.note
              }),
              now
            )
          );
          continue;
        }
        const stockDelta = type === "out" ? -q : line.outcome === "returned" ? q : 0;
        const projectDelta = !turnover ? 0 : type === "out" ? q : -q;
        if (stockDelta !== 0) statements.push(adjustMaterial(db, material.id, stockDelta, now));
        statements.push(
          insertLine(
            db,
            crid,
            baseLine({
              material_id: material.id,
              quantity: q,
              outcome: type === "back" ? (line.outcome ?? "returned") : "normal",
              stock_delta: stockDelta,
              project_id: fromProject,
              project_delta: projectDelta,
              note: line.note
            }),
            now
          )
        );
      }

      if (needInspection.length > 0 && settings) {
        const taskNos = await generateSerials(
          db,
          "KFR",
          "wh_task",
          "task_no",
          needInspection.length
        );
        needInspection.forEach((device, index) => {
          const draft: TaskDraft = {
            kind: "inspection",
            source: "return",
            title: `返库检查：${device.name}`,
            description: `从${fromName}返库`,
            device_id: device.id,
            blocking: 1,
            required_photo_count: settings.return_inspection_photo_count,
            due_date: beijingDatePlusDays(doc.occurred_at, 2),
            assignee_userid: settings.default_inspector_userid ?? operatorUserid,
            parent_task_id: null,
            origin_doc_client_request_id: crid
          };
          statements.push(buildTaskInsert(db, draft, taskNos[index], operatorUserid, now));
        });
      }
      return statements;
    }
  });
};
