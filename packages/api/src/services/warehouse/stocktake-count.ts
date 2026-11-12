/**
 * 盘点中的两种写入：录实盘数、标记设备。
 * 每次写都在同一个批处理里断言「盘点还在进行中」并把盘点的 version 加一，完成盘点时靠它发现撞车。
 */
import type { Env } from "../../types/env";
import type { DeviceLocation, StocktakeScope } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, releaseGuards } from "./guard";
import {
  SELECT_DEVICE_LINE,
  SELECT_MATERIAL_LINE,
  STOCKTAKE_COUNTING_EXISTS_SQL,
  type StocktakeDeviceLineRow,
  type StocktakeMaterialLineRow
} from "./stocktake-query";
import { optionalId, optionalText } from "./validation";

export interface DeviceMarkResult {
  line: StocktakeDeviceLineRow;
  /** 这台设备账上不在库（在项目或已报废） */
  unexpected: boolean;
  /** 给库管看的一句话，没有就是 null */
  hint: string | null;
}

const MAX_COUNT = 1_000_000;
const COUNT_TEXT = /^\d+(\.\d+)?$/;
const nowIso = () => new Date().toISOString();

/** 实盘数：null 是清掉；否则 0 到 1000000，最多 3 位小数。只认普通写法的数字，不认 1e3、0x10。 */
const parseCountedQty = (input: Record<string, unknown>): number | null => {
  const value = input.counted_qty;
  if (value === null && "counted_qty" in input) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (typeof value === "string" && text.startsWith("-") && COUNT_TEXT.test(text.slice(1))) {
    throw badRequest("实盘数不能是负数");
  }
  const parsed =
    typeof value === "number" ? value : COUNT_TEXT.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(parsed)) throw badRequest("实盘数请填数字");
  if (parsed < 0) throw badRequest("实盘数不能是负数");
  if (parsed > MAX_COUNT) throw badRequest("实盘数太大了");
  const scaled = parsed * 1000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) throw badRequest("实盘数最多 3 位小数");
  return parsed;
};

const requireCounting = async (env: Env, stocktakeId: number): Promise<StocktakeScope> => {
  const row = await env.DB.prepare("SELECT status, scope FROM stocktake WHERE id = ?")
    .bind(stocktakeId)
    .first<{ status: string; scope: StocktakeScope }>();
  if (!row) throw new WarehouseError(404, "盘点不存在");
  if (row.status !== "counting") throw new WarehouseError(409, "这次盘点已经结束，不能再改");
  return row.scope;
};

const bumpVersion = (db: D1Database, stocktakeId: number, now: string): D1PreparedStatement =>
  db
    .prepare("UPDATE stocktake SET version = version + 1, updated_at = ? WHERE id = ?")
    .bind(now, stocktakeId);

export const saveMaterialCount = async (
  env: Env,
  stocktakeId: number,
  lineId: number,
  input: Record<string, unknown>,
  userid: string
): Promise<StocktakeMaterialLineRow> => {
  const counted = parseCountedQty(input);
  const note = optionalText(input.note, "备注", 200);
  await requireCounting(env, stocktakeId);
  const db = env.DB;
  const existing = await db
    .prepare("SELECT id FROM stocktake_material_line WHERE id = ? AND stocktake_id = ?")
    .bind(lineId, stocktakeId)
    .first<{ id: number }>();
  if (!existing) throw new WarehouseError(404, "这次盘点里没有这一行");

  const now = nowIso();
  const cleared = counted === null;
  await runAtomicBatch(db, [
    assertInBatch(db, STOCKTAKE_COUNTING_EXISTS_SQL, [stocktakeId]),
    // 账面数在同一条语句里取，不先读再写：记下的就是写入那一刻的数
    db
      .prepare(
        `UPDATE stocktake_material_line
            SET counted_qty = ?,
                book_qty = CASE WHEN ? = 1 THEN NULL ELSE
                  (SELECT ROUND(m.quantity, 3) FROM material m WHERE m.id = stocktake_material_line.material_id) END,
                note = ?, counted_by_userid = ?, counted_at = ?, updated_at = ?
          WHERE id = ? AND stocktake_id = ?`
      )
      .bind(
        counted,
        cleared ? 1 : 0,
        note,
        cleared ? null : userid,
        cleared ? null : now,
        now,
        lineId,
        stocktakeId
      ),
    bumpVersion(db, stocktakeId, now),
    releaseGuards(db)
  ]);
  const line = await db
    .prepare(`${SELECT_MATERIAL_LINE} WHERE l.id = ?`)
    .bind(lineId)
    .first<StocktakeMaterialLineRow>();
  if (!line) throw new Error("stocktake material line missing after update");
  return line;
};

interface DeviceRef {
  id: number;
  location: DeviceLocation;
  project_name: string | null;
}

const findDevice = async (env: Env, input: Record<string, unknown>): Promise<DeviceRef> => {
  const deviceId = optionalId(input.device_id, "设备");
  const code = typeof input.device_code === "string" ? input.device_code.trim() : "";
  if (deviceId === null && !code) throw badRequest("请给出设备");
  const select = `SELECT d.id, d.location, p.project_name FROM device d
    LEFT JOIN project p ON p.id = d.current_project_id`;
  const device =
    deviceId !== null
      ? await env.DB.prepare(`${select} WHERE d.id = ?`).bind(deviceId).first<DeviceRef>()
      : await env.DB.prepare(`${select} WHERE UPPER(d.device_code) = UPPER(?)`)
          .bind(code)
          .first<DeviceRef>();
  if (!device) throw new WarehouseError(404, "没有这台设备");
  return { ...device, id: Number(device.id) };
};

const parseFound = (input: Record<string, unknown>): 0 | 1 | null => {
  if (input.found === true) return 1;
  if (input.found === false) return 0;
  if (input.found === null && "found" in input) return null;
  throw badRequest("标记只能是找到、没找到或清掉");
};

const hintFor = (device: DeviceRef): string | null => {
  if (device.location === "project") {
    return `账上在「${device.project_name ?? "项目"}」，盘完后补一张返库单`;
  }
  return device.location === "scrapped" ? "账上已报废" : null;
};

export const markStocktakeDevice = async (
  env: Env,
  stocktakeId: number,
  input: Record<string, unknown>,
  userid: string
): Promise<DeviceMarkResult> => {
  const found = parseFound(input);
  const hasNote = "note" in input;
  const note = optionalText(input.note, "备注", 200);
  const scope = await requireCounting(env, stocktakeId);
  if (scope === "material") throw badRequest("这次盘点不盘设备");
  const device = await findDevice(env, input);
  const db = env.DB;
  const existing = await db
    .prepare("SELECT id FROM stocktake_device_line WHERE stocktake_id = ? AND device_id = ?")
    .bind(stocktakeId, device.id)
    .first<{ id: number }>();
  if (!existing && found !== 1) throw badRequest("这台设备不在这次盘点里，只能标记找到");

  const now = nowIso();
  const cleared = found === null;
  // 不带备注时原来的备注留着（连续扫码不会把手写的备注冲掉）
  const noteSql = hasNote ? "excluded.note" : "stocktake_device_line.note";
  await runAtomicBatch(db, [
    assertInBatch(db, STOCKTAKE_COUNTING_EXISTS_SQL, [stocktakeId]),
    db
      .prepare(
        `INSERT INTO stocktake_device_line
           (stocktake_id, device_id, expected, found, note, scanned_by_userid, scanned_at, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stocktake_id, device_id) DO UPDATE SET
           found = excluded.found, note = ${noteSql},
           scanned_by_userid = excluded.scanned_by_userid, scanned_at = excluded.scanned_at,
           updated_at = excluded.updated_at`
      )
      .bind(
        stocktakeId,
        device.id,
        found,
        note,
        cleared ? null : userid,
        cleared ? null : now,
        now,
        now
      ),
    bumpVersion(db, stocktakeId, now),
    releaseGuards(db)
  ]);
  const line = await db
    .prepare(`${SELECT_DEVICE_LINE} WHERE dl.stocktake_id = ? AND dl.device_id = ?`)
    .bind(stocktakeId, device.id)
    .first<StocktakeDeviceLineRow>();
  if (!line) throw new Error("stocktake device line missing after upsert");
  const unexpected = Number(line.expected) === 0 && device.location !== "warehouse";
  return { line, unexpected, hint: unexpected ? hintFor(device) : null };
};
