/**
 * 完成盘点：按「实盘数 − 录入那一刻的账面数」出一张 adjust 库房单，改库存、写设备时间线、把盘点标成已完成，
 * 全部在一个批处理里。语句按集合写，条数不随物资数量增长（D1 一条语句最多 100 个绑定参数）。
 * 设备只出报告：不改位置、不建任务。
 */
import type { Env } from "../../types/env";
import { runAtomicBatch } from "../db-transaction";
import { DOC_ID_SQL, executeDoc } from "./doc-core";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, releaseGuards } from "./guard";
import {
  ANY_DEVICE_MARKED_SQL,
  getStocktake,
  getStocktakeRow,
  LINE_HAS_DIFF_SQL,
  type StocktakeDetail,
  type StocktakeRow
} from "./stocktake-query";
import { optionalNumber } from "./validation";

export interface CompleteStocktakeResult {
  stocktake: StocktakeDetail;
  adjust_doc: { id: number; doc_no: string } | null;
  /** 这次请求没有再写库：盘点之前已经完成了 */
  replayed: boolean;
}

const DIFF_SQL = "ROUND(l.counted_qty - l.book_qty, 3)";
const nowIso = () => new Date().toISOString();

/** 调整单的幂等键：一次盘点最多一张。 */
const adjustRequestId = (stocktakeId: number): string => `stocktake-${stocktakeId}`;

const formatQty = (value: number): string => String(Math.round(value * 1000) / 1000);

const toResult = async (
  env: Env,
  id: number,
  replayed: boolean
): Promise<CompleteStocktakeResult> => {
  const stocktake = await getStocktake(env, id);
  if (!stocktake) throw new Error("stocktake missing after complete");
  return {
    stocktake,
    adjust_doc:
      stocktake.adjust_doc_id !== null && stocktake.adjust_doc_no !== null
        ? { id: stocktake.adjust_doc_id, doc_no: stocktake.adjust_doc_no }
        : null,
    replayed
  };
};

const anyDeviceMarked = async (env: Env, id: number): Promise<boolean> =>
  Boolean(await env.DB.prepare(`${ANY_DEVICE_MARKED_SQL} LIMIT 1`).bind(id).first());

/** 完成那一刻账面数不够减的第一条：给出具体是哪条物资。 */
const assertCanDeduct = async (env: Env, id: number): Promise<void> => {
  const short = await env.DB.prepare(
    `SELECT m.name, m.spec, m.unit, m.quantity, ${DIFF_SQL} AS diff
       FROM stocktake_material_line l
       JOIN material m ON m.id = l.material_id
      WHERE l.stocktake_id = ? AND ${LINE_HAS_DIFF_SQL}
        AND ROUND(m.quantity + ${DIFF_SQL}, 3) < 0
      ORDER BY l.id ASC LIMIT 1`
  )
    .bind(id)
    .first<{ name: string; spec: string | null; unit: string; quantity: number; diff: number }>();
  if (!short) return;
  const label = [short.name, short.spec].filter(Boolean).join(" ");
  throw badRequest(
    `${label} 现在账面只有 ${formatQty(Number(short.quantity))}${short.unit}，扣不了 ${formatQty(
      Math.abs(Number(short.diff))
    )}，请重新盘这一项`
  );
};

/** 改库存和插调整单的行：两条语句，每条有差额的物资各一行。 */
const adjustStatements = (db: D1Database, id: number, now: string): D1PreparedStatement[] => [
  db
    .prepare(
      `UPDATE material
          SET quantity = ROUND(quantity + (
                SELECT ${DIFF_SQL} FROM stocktake_material_line l
                 WHERE l.stocktake_id = ? AND l.material_id = material.id), 3),
              updated_at = ?
        WHERE id IN (SELECT l.material_id FROM stocktake_material_line l
                      WHERE l.stocktake_id = ? AND ${LINE_HAS_DIFF_SQL})`
    )
    .bind(id, now, id),
  // 上一条已经改完库存，这里的 m.quantity 就是变更后的在库数
  db
    .prepare(
      `INSERT INTO wh_doc_line
         (doc_id, device_id, material_id, quantity, outcome, stock_delta, balance_after, project_id,
          project_delta, usage_meters, soil_type, note, created_at)
       SELECT ${DOC_ID_SQL}, NULL, l.material_id, ABS(${DIFF_SQL}), 'normal', ${DIFF_SQL}, m.quantity, NULL,
              0, NULL, NULL, l.note, ?
         FROM stocktake_material_line l
         JOIN material m ON m.id = l.material_id
        WHERE l.stocktake_id = ? AND ${LINE_HAS_DIFF_SQL}
        ORDER BY l.id ASC`
    )
    .bind(adjustRequestId(id), now, id)
];

/** 设备报告和盘点状态：没标记的在库设备记成没找到，写时间线，盘点标成已完成。 */
const closingStatements = (
  db: D1Database,
  stocktake: StocktakeRow,
  userid: string,
  now: string
): D1PreparedStatement[] => [
  // 盘点期间已经发往项目的不算没找到，所以只动现在仍在库的。
  // 一台设备都没标记过的盘点（多半是选了「全部」但只盘了物资）不记设备：
  // 不然每台设备的时间线上都会多一条去不掉的「盘点未找到」。
  db
    .prepare(
      `UPDATE stocktake_device_line SET found = 0, updated_at = ?
        WHERE stocktake_id = ? AND expected = 1 AND found IS NULL
          AND device_id IN (SELECT d.id FROM device d WHERE d.location = 'warehouse')
          AND EXISTS (${ANY_DEVICE_MARKED_SQL})`
    )
    .bind(now, stocktake.id, stocktake.id),
  db
    .prepare(
      `INSERT INTO device_event
         (device_id, event_type, ref_type, ref_id, summary, operator_userid, occurred_at, created_at)
       SELECT dl.device_id, 'stocktake_missing', 'stocktake', ?, ?, ?, ?, ?
         FROM stocktake_device_line dl
         JOIN device d ON d.id = dl.device_id
        WHERE dl.stocktake_id = ? AND dl.expected = 1 AND dl.found = 0 AND d.location = 'warehouse'
        ORDER BY dl.id ASC`
    )
    .bind(stocktake.id, `盘点未找到（${stocktake.stocktake_no}）`, userid, now, now, stocktake.id),
  db
    .prepare(
      `UPDATE stocktake
          SET status = 'done', completed_by_userid = ?, completed_at = ?,
              version = version + 1, updated_at = ?
        WHERE id = ?`
    )
    .bind(userid, now, now, stocktake.id)
];

export const completeStocktake = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  userid: string
): Promise<CompleteStocktakeResult> => {
  const version = optionalNumber(input.version, "盘点版本", {
    min: 1,
    max: 1_000_000_000,
    integer: true
  });
  if (version === null) throw badRequest("缺少盘点版本，请刷新后重试");

  const stocktake = await getStocktakeRow(env, id);
  if (!stocktake) throw new WarehouseError(404, "盘点不存在");
  if (stocktake.status === "done") return toResult(env, id, true);
  if (stocktake.status === "cancelled") throw new WarehouseError(409, "这次盘点已经取消");
  if (stocktake.version !== version) {
    throw new WarehouseError(409, "盘点内容有变化，请刷新后再点完成");
  }
  if (stocktake.material_counted === 0 && !(await anyDeviceMarked(env, id))) {
    throw badRequest("还什么都没盘。不盘了请点取消");
  }
  await assertCanDeduct(env, id);

  const db = env.DB;
  // 版本在批里再核对一次：预查之后有人又录了一行，整批回滚
  const versionGuard = () =>
    assertInBatch(db, "SELECT 1 FROM stocktake WHERE id = ? AND status = 'counting' AND version = ?", [
      id,
      version
    ]);

  if (stocktake.material_diff === 0) {
    const now = nowIso();
    await runAtomicBatch(db, [
      versionGuard(),
      ...closingStatements(db, stocktake, userid, now),
      releaseGuards(db)
    ]);
    return toResult(env, id, false);
  }

  const result = await executeDoc(env, {
    clientRequestId: adjustRequestId(id),
    operatorUserid: userid,
    header: {
      doc_type: "adjust",
      project_id: null,
      to_project_id: null,
      project_kit_id: null,
      counterparty: null,
      handover_name: null,
      remark: `盘点 ${stocktake.stocktake_no} 调整`,
      photo_keys_json: null,
      occurred_at: nowIso(),
      reverses_doc_id: null,
      stocktake_id: id
    },
    build: async (now) => [
      versionGuard(),
      ...adjustStatements(db, id, now),
      ...closingStatements(db, stocktake, userid, now)
    ]
  });
  // replayed：另一个相同的完成请求先做完了，这次没有再写库
  return toResult(env, id, result.replayed);
};
