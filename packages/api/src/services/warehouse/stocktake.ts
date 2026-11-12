/**
 * 发起和取消盘点。
 * 发起时把行建好：范围含物资时每条启用的物资一行，范围含设备时每台账上在库的设备一行。
 * 「同一时间只能有一个进行中」先查一次给出明确提示，并发时由唯一索引兜底。
 */
import type { Env } from "../../types/env";
import type { StocktakeScope } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { generateSerials } from "../serial";
import { WarehouseError } from "./errors";
import { assertInBatch, releaseGuards } from "./guard";
import {
  getCountingStocktake,
  getStocktake,
  STOCKTAKE_COUNTING_EXISTS_SQL,
  type StocktakeDetail
} from "./stocktake-query";
import { optionalText, requireEnum } from "./validation";

export const STOCKTAKE_SCOPES: readonly StocktakeScope[] = ["material", "device", "all"];

const STOCKTAKE_ID_SQL = "(SELECT id FROM stocktake WHERE stocktake_no = ?)";
const nowIso = () => new Date().toISOString();

const errorText = (error: unknown): string => {
  if (!(error instanceof Error)) return "";
  const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
  return `${error.message}${cause}`;
};
const uniqueFailedOn = (error: unknown, column: string): boolean =>
  errorText(error).includes(`UNIQUE constraint failed: stocktake.${column}`);

const alreadyCounting = (stocktakeNo: string): WarehouseError =>
  new WarehouseError(409, `已有进行中的盘点 ${stocktakeNo}，先完成或取消它`);

const loadDetail = async (env: Env, id: number): Promise<StocktakeDetail> => {
  const detail = await getStocktake(env, id);
  if (!detail) throw new Error("stocktake missing after write");
  return detail;
};

export const startStocktake = async (
  env: Env,
  input: Record<string, unknown>,
  userid: string
): Promise<StocktakeDetail> => {
  const scope = requireEnum(input.scope, "盘点范围", STOCKTAKE_SCOPES);
  const remark = optionalText(input.remark, "备注", 200);
  const open = await getCountingStocktake(env);
  if (open) throw alreadyCounting(open.stocktake_no);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [stocktakeNo] = await generateSerials(env.DB, "PD", "stocktake", "stocktake_no", 1);
    const now = nowIso();
    const db = env.DB;
    try {
      await runAtomicBatch(db, [
        db
          .prepare(
            `INSERT INTO stocktake (stocktake_no, scope, status, remark, created_by_userid, version, created_at, updated_at)
             VALUES (?, ?, 'counting', ?, ?, 1, ?, ?)`
          )
          .bind(stocktakeNo, scope, remark, userid, now, now),
        ...(scope === "device"
          ? []
          : [
              db
                .prepare(
                  `INSERT INTO stocktake_material_line (stocktake_id, material_id, created_at, updated_at)
                   SELECT ${STOCKTAKE_ID_SQL}, m.id, ?, ? FROM material m WHERE m.status = 'active'`
                )
                .bind(stocktakeNo, now, now)
            ]),
        ...(scope === "material"
          ? []
          : [
              db
                .prepare(
                  `INSERT INTO stocktake_device_line (stocktake_id, device_id, expected, created_at, updated_at)
                   SELECT ${STOCKTAKE_ID_SQL}, d.id, 1, ?, ? FROM device d WHERE d.location = 'warehouse'`
                )
                .bind(stocktakeNo, now, now)
            ]),
        releaseGuards(db)
      ]);
    } catch (error) {
      if (uniqueFailedOn(error, "stocktake_no") && attempt === 0) continue;
      if (uniqueFailedOn(error, "status")) {
        const other = await getCountingStocktake(env);
        throw alreadyCounting(other?.stocktake_no ?? "");
      }
      throw error;
    }
    const created = await db
      .prepare("SELECT id FROM stocktake WHERE stocktake_no = ?")
      .bind(stocktakeNo)
      .first<{ id: number }>();
    if (!created) throw new Error("stocktake missing after insert");
    return loadDetail(env, Number(created.id));
  }
  throw new Error("unreachable");
};

export const cancelStocktake = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  userid: string
): Promise<StocktakeDetail> => {
  const reason = optionalText(input.reason, "取消原因", 200);
  const current = await env.DB.prepare("SELECT status FROM stocktake WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  if (!current) throw new WarehouseError(404, "盘点不存在");
  if (current.status !== "counting") throw new WarehouseError(409, "这次盘点已经结束");
  const now = nowIso();
  await runAtomicBatch(env.DB, [
    assertInBatch(env.DB, STOCKTAKE_COUNTING_EXISTS_SQL, [id]),
    env.DB.prepare(
      `UPDATE stocktake
          SET status = 'cancelled', cancel_reason = ?, cancelled_by_userid = ?, cancelled_at = ?,
              version = version + 1, updated_at = ?
        WHERE id = ?`
    ).bind(reason, userid, now, now, id),
    releaseGuards(env.DB)
  ]);
  return loadDetail(env, id);
};
