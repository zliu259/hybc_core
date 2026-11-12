/**
 * 库房单的公共部件：单头、单据行、物资数量调整、设备时间线，以及"取号 + 一个批处理 + 幂等重放"的执行器。
 * 同一批里的语句用 client_request_id 子查询取单头 id，不依赖上一条语句的返回值。
 */
import type { Env } from "../../types/env";
import type { WhDocLineOutcome, WhDocType } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { generateSerials } from "../serial";
import { releaseGuards } from "./guard";

export interface WhDocResult {
  id: number;
  doc_no: string;
  replayed: boolean;
  created_task_ids: number[];
}

export interface DocHeader {
  doc_type: WhDocType;
  project_id: number | null;
  to_project_id: number | null;
  /** 按配套清单发货时带上（只有 out 单）。 */
  project_kit_id: number | null;
  counterparty: string | null;
  handover_name: string | null;
  remark: string | null;
  photo_keys_json: string | null;
  occurred_at: string;
  reverses_doc_id: number | null;
  /** 盘点调整单带上是哪次盘点（只有 adjust 单）。 */
  stocktake_id?: number | null;
}

export interface LineSpec {
  device_id: number | null;
  material_id: number | null;
  quantity: number;
  outcome: WhDocLineOutcome;
  stock_delta: number;
  project_id: number | null;
  project_delta: number;
  usage_meters: number | null;
  soil_type: string | null;
  note: string | null;
}

export const DOC_ID_SQL = "(SELECT id FROM wh_doc WHERE client_request_id = ?)";

export const insertLine = (
  db: D1Database,
  clientRequestId: string,
  line: LineSpec,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO wh_doc_line
        (doc_id, device_id, material_id, quantity, outcome, stock_delta, balance_after, project_id,
         project_delta, usage_meters, soil_type, note, created_at)
       VALUES (${DOC_ID_SQL}, ?, ?, ?, ?, ?, (SELECT quantity FROM material WHERE id = ?), ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      clientRequestId,
      line.device_id,
      line.material_id,
      line.quantity,
      line.outcome,
      line.stock_delta,
      line.material_id,
      line.project_id,
      line.project_delta,
      line.usage_meters,
      line.soil_type,
      line.note,
      now
    );

/** 在库数量变化；不够时 material_quantity_non_negative 约束报错，整批回滚。 */
export const adjustMaterial = (
  db: D1Database,
  materialId: number,
  delta: number,
  now: string
): D1PreparedStatement =>
  db
    .prepare("UPDATE material SET quantity = ROUND(quantity + ?, 3), updated_at = ? WHERE id = ?")
    .bind(delta, now, materialId);

export const docDeviceEvent = (
  db: D1Database,
  deviceId: number,
  eventType: string,
  clientRequestId: string,
  summary: string,
  operatorUserid: string,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO device_event (device_id, event_type, ref_type, ref_id, summary, operator_userid, occurred_at, created_at)
       VALUES (?, ?, 'wh_doc', ${DOC_ID_SQL}, ?, ?, ?, ?)`
    )
    .bind(deviceId, eventType, clientRequestId, summary, operatorUserid, now, now);

export const findReplay = async (
  env: Env,
  clientRequestId: string
): Promise<WhDocResult | null> => {
  const doc = await env.DB.prepare("SELECT id, doc_no FROM wh_doc WHERE client_request_id = ?")
    .bind(clientRequestId)
    .first<{ id: number; doc_no: string }>();
  if (!doc) return null;
  const tasks = await env.DB.prepare(
    "SELECT id FROM wh_task WHERE origin_doc_id = ? ORDER BY id ASC"
  )
    .bind(doc.id)
    .all<{ id: number }>();
  return {
    id: Number(doc.id),
    doc_no: doc.doc_no,
    replayed: true,
    created_task_ids: (tasks.results ?? []).map((row) => Number(row.id))
  };
};

const conflictOn = (error: unknown, column: string): boolean =>
  error instanceof Error && error.message.includes(`UNIQUE constraint failed: wh_doc.${column}`);

/**
 * 取单号，把单头和 build 给出的语句放进一个批处理执行。
 * client_request_id 撞了（另一个相同请求先完成）就返回那张单；单号撞了重新取号重试一次。
 */
export const executeDoc = async (
  env: Env,
  options: {
    clientRequestId: string;
    header: DocHeader;
    operatorUserid: string;
    build: (now: string) => Promise<D1PreparedStatement[]>;
  }
): Promise<WhDocResult> => {
  const { clientRequestId, header, operatorUserid } = options;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [docNo] = await generateSerials(env.DB, "KFD", "wh_doc", "doc_no", 1);
    const now = new Date().toISOString();
    const statements = await options.build(now);
    try {
      await runAtomicBatch(env.DB, [
        env.DB.prepare(
          `INSERT INTO wh_doc
            (doc_no, doc_type, project_id, to_project_id, project_kit_id, counterparty, handover_name, remark, photo_keys_json,
             reverses_doc_id, stocktake_id, operator_userid, occurred_at, client_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          docNo,
          header.doc_type,
          header.project_id,
          header.to_project_id,
          header.project_kit_id,
          header.counterparty,
          header.handover_name,
          header.remark,
          header.photo_keys_json,
          header.reverses_doc_id,
          header.stocktake_id ?? null,
          operatorUserid,
          header.occurred_at,
          clientRequestId,
          now
        ),
        ...statements,
        releaseGuards(env.DB)
      ]);
      const created = await findReplay(env, clientRequestId);
      if (!created) throw new Error("wh_doc missing after insert");
      return { ...created, replayed: false };
    } catch (error) {
      if (conflictOn(error, "client_request_id")) {
        const replay = await findReplay(env, clientRequestId);
        if (replay) return replay;
      }
      if (conflictOn(error, "doc_no") && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
};
