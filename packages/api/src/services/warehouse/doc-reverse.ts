/**
 * 冲销：录错了不改不删，生成一张数量相反的同类型单据，原单标记已冲销。
 * 设备要恢复到原单执行前的位置，前提是它在原单之后没有别的单据；返库单生成的检查任务一并取消。
 */
import type { Env } from "../../types/env";
import type { Device, Material, WhDoc, WhDocLine } from "../../types/wh";
import {
  adjustMaterial,
  docDeviceEvent,
  executeDoc,
  findReplay,
  insertLine,
  type WhDocResult
} from "./doc-core";
import { materialLabel, requireClientRequestId } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch } from "./guard";
import { HOLDING_AT_LEAST_EXISTS_SQL, loadHoldings } from "./holdings";

const REVERSIBLE = new Set(["opening", "inbound", "out", "back", "transfer"]);
const num = (value: number): string => String(Number(value.toFixed(3)));

/** 原单执行后设备所在的位置，以及冲销后要回到的位置。 */
const positions = (doc: WhDoc) => {
  if (doc.doc_type === "out") return { after: doc.project_id, before: null };
  if (doc.doc_type === "back") return { after: null, before: doc.project_id };
  return { after: doc.to_project_id, before: doc.project_id };
};

export const reverseWhDoc = async (
  env: Env,
  docId: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WhDocResult> => {
  const crid = requireClientRequestId(input.client_request_id);
  const replay = await findReplay(env, crid);
  if (replay) return replay;

  const original = await env.DB.prepare("SELECT * FROM wh_doc WHERE id = ?")
    .bind(docId)
    .first<WhDoc>();
  if (!original) throw new WarehouseError(404, "单据不存在");
  if (original.reverses_doc_id !== null) throw badRequest("冲销单不能再冲销");
  if (!REVERSIBLE.has(original.doc_type)) throw badRequest("这种单据不能冲销");
  const reversed = await env.DB.prepare("SELECT id FROM wh_doc WHERE reverses_doc_id = ?")
    .bind(docId)
    .first();
  if (reversed) throw new WarehouseError(409, "这张单已经冲销过");

  const lines =
    (
      await env.DB.prepare("SELECT * FROM wh_doc_line WHERE doc_id = ? ORDER BY id ASC")
        .bind(docId)
        .all<WhDocLine>()
    ).results ?? [];
  const materialIds = [
    ...new Set(lines.flatMap((line) => (line.material_id === null ? [] : [line.material_id])))
  ];
  const materials = new Map<number, Material>();
  if (materialIds.length > 0) {
    const rows = await env.DB.prepare(
      `SELECT * FROM material WHERE id IN (${materialIds.map(() => "?").join(", ")})`
    )
      .bind(...materialIds)
      .all<Material>();
    for (const row of rows.results ?? []) materials.set(Number(row.id), row);
  }

  const stockDelta = new Map<number, number>();
  const holdingDelta = new Map<string, { projectId: number; materialId: number; delta: number }>();
  for (const line of lines) {
    if (line.material_id === null) continue;
    stockDelta.set(line.material_id, (stockDelta.get(line.material_id) ?? 0) - line.stock_delta);
    if (line.project_id !== null && line.project_delta !== 0) {
      const key = `${line.project_id}:${line.material_id}`;
      const entry = holdingDelta.get(key) ?? {
        projectId: line.project_id,
        materialId: line.material_id,
        delta: 0
      };
      holdingDelta.set(key, { ...entry, delta: entry.delta - line.project_delta });
    }
  }
  for (const [materialId, delta] of stockDelta) {
    const material = materials.get(materialId) as Material;
    if (delta < 0 && material.quantity + delta < -1e-9) {
      throw badRequest(`库存不足，无法冲销：${materialLabel(material)}`);
    }
  }
  const holdingNeeds = [...holdingDelta.values()].filter((entry) => entry.delta < 0);
  for (const need of holdingNeeds) {
    const holding =
      (await loadHoldings(env, need.projectId, [need.materialId])).get(need.materialId) ?? 0;
    if (holding + need.delta < -1e-9) {
      const material = materials.get(need.materialId) as Material;
      throw badRequest(`${materialLabel(material)} 在场只有 ${num(holding)}，无法冲销`);
    }
  }

  const deviceLines = lines.filter((line) => line.device_id !== null);
  const { after, before } = positions(original);
  for (const line of deviceLines) {
    const device = await env.DB.prepare("SELECT * FROM device WHERE id = ?")
      .bind(line.device_id)
      .first<Device>();
    const later = await env.DB.prepare(
      "SELECT 1 FROM wh_doc_line WHERE device_id = ? AND doc_id > ? LIMIT 1"
    )
      .bind(line.device_id, docId)
      .first();
    if (!device || later || device.current_project_id !== after) {
      throw new WarehouseError(409, `${device?.device_code ?? ""} 之后又有新的单据，不能冲销`);
    }
  }

  const tasks =
    original.doc_type === "back"
      ? ((
          await env.DB.prepare(
            `SELECT t.id, t.status,
                    (SELECT COUNT(*) FROM wh_task_photo p WHERE p.task_id = t.id AND p.deleted_at IS NULL) AS photos
               FROM wh_task t WHERE t.origin_doc_id = ?`
          )
            .bind(docId)
            .all<{ id: number; status: string; photos: number }>()
        ).results ?? [])
      : [];
  if (tasks.some((task) => task.status !== "todo" || Number(task.photos) > 0)) {
    throw new WarehouseError(409, "返库后的检查任务已经开始，不能冲销");
  }

  try {
    return await executeDoc(env, {
      clientRequestId: crid,
      operatorUserid,
      header: {
        doc_type: original.doc_type,
        project_id: original.project_id,
        to_project_id: original.to_project_id,
        counterparty: original.counterparty,
        handover_name: original.handover_name,
        remark: `冲销 ${original.doc_no}`,
        photo_keys_json: null,
        occurred_at: new Date().toISOString(),
        reverses_doc_id: docId
      },
      build: async (now) => {
        const db = env.DB;
        const statements: D1PreparedStatement[] = [];
        for (const need of holdingNeeds) {
          statements.push(
            assertInBatch(db, HOLDING_AT_LEAST_EXISTS_SQL, [
              need.projectId,
              need.materialId,
              -need.delta
            ])
          );
        }
        for (const line of deviceLines) {
          statements.push(
            assertInBatch(
              db,
              `SELECT 1 FROM device WHERE id = ? AND current_project_id IS ?
                 AND NOT EXISTS (SELECT 1 FROM wh_doc_line WHERE device_id = ? AND doc_id > ?)`,
              [line.device_id, after, line.device_id, docId]
            )
          );
        }
        if (tasks.length > 0) {
          statements.push(
            assertInBatch(
              db,
              `SELECT 1 WHERE NOT EXISTS (
                 SELECT 1 FROM wh_task t WHERE t.origin_doc_id = ? AND (t.status <> 'todo'
                   OR EXISTS (SELECT 1 FROM wh_task_photo p WHERE p.task_id = t.id AND p.deleted_at IS NULL)))`,
              [docId]
            ),
            db
              .prepare(
                `UPDATE wh_task SET status = 'cancelled', cancel_reason = '单据冲销', version = version + 1, updated_at = ?
                  WHERE origin_doc_id = ? AND status = 'todo'`
              )
              .bind(now, docId)
          );
        }
        for (const line of lines) {
          if (line.material_id !== null && line.stock_delta !== 0) {
            statements.push(adjustMaterial(db, line.material_id, -line.stock_delta, now));
          }
          if (line.device_id !== null) {
            statements.push(
              db
                .prepare(
                  "UPDATE device SET location = ?, current_project_id = ?, version = version + 1, updated_at = ? WHERE id = ?"
                )
                .bind(before === null ? "warehouse" : "project", before, now, line.device_id),
              docDeviceEvent(
                db,
                line.device_id,
                "reversed",
                crid,
                `单据 ${original.doc_no} 已冲销`,
                operatorUserid,
                now
              )
            );
          }
          statements.push(
            insertLine(
              db,
              crid,
              {
                device_id: line.device_id,
                material_id: line.material_id,
                quantity: line.quantity,
                outcome: line.outcome,
                stock_delta: -line.stock_delta,
                project_id: line.project_id,
                project_delta: -line.project_delta,
                usage_meters: line.usage_meters,
                soil_type: line.soil_type,
                note: line.note
              },
              now
            )
          );
        }
        return statements;
      }
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: wh_doc.reverses_doc_id")
    ) {
      throw new WarehouseError(409, "这张单已经冲销过");
    }
    throw error;
  }
};
