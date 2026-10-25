import type { Env } from "../types/env";

/**
 * 油卡 ↔ 车辆绑定（油卡跟车走）。
 *
 * 一张卡同一时刻只挂一辆车，由 0090 迁移的部分唯一索引
 * `idx_fuel_card_vehicle_binding_active_card` 兜底；转移/解绑把旧行置 inactive
 * 并记 unbound_*，历史按行保留。
 *
 * D1 不支持事务（runInTransaction 在生产静默降级），转移是"先乐观关闭旧绑定、
 * 再插新行"两步：关闭撞上并发（changes = 0）或插入撞上唯一索引都返回 conflict，
 * 由调用方提示刷新重试；插入因其他原因失败时卡会处于未绑定状态，重试即可恢复。
 */

export type FuelCardBindOutcome = "unchanged" | "bound" | "transferred";

export type BindFuelCardResult =
  | { ok: true; outcome: FuelCardBindOutcome; previousVehicleId: number | null }
  | { ok: false; reason: "card_invalid" | "vehicle_invalid" | "conflict" };

export type UnbindFuelCardResult =
  | { ok: true; previousVehicleId: number }
  | { ok: false; reason: "not_bound" | "conflict" };

export type FuelCardVehicleBindingHistoryRow = {
  id: number;
  vehicle_id: number;
  vehicle_plate_no: string | null;
  status: "active" | "inactive";
  bound_at: string;
  bound_by_userid: string;
  unbound_at: string | null;
  unbound_by_userid: string | null;
};

type ActiveBinding = { id: number; vehicle_id: number };

const nowIso = () => new Date().toISOString();

const isActiveRow = async (env: Env, table: "fuel_card" | "company_vehicle", id: number) => {
  const row = await env.DB.prepare(`SELECT id, status FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ id: number; status: string }>();
  return row?.status === "active";
};

const findActiveBinding = (env: Env, fuelCardId: number) =>
  env.DB.prepare(
    "SELECT id, vehicle_id FROM fuel_card_vehicle_binding WHERE fuel_card_id = ? AND status = 'active'"
  )
    .bind(fuelCardId)
    .first<ActiveBinding>();

const closeBinding = async (env: Env, bindingId: number, operatorUserid: string): Promise<boolean> => {
  const ts = nowIso();
  const result = await env.DB.prepare(
    `UPDATE fuel_card_vehicle_binding
     SET status = 'inactive', unbound_at = ?, unbound_by_userid = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`
  )
    .bind(ts, operatorUserid, ts, bindingId)
    .run();
  return (result.meta.changes ?? 0) > 0;
};

const isActiveCardUniqueViolation = (error: unknown) =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed");

export const bindFuelCardToVehicle = async (
  env: Env,
  input: { fuelCardId: number; vehicleId: number; operatorUserid: string }
): Promise<BindFuelCardResult> => {
  if (!(await isActiveRow(env, "fuel_card", input.fuelCardId))) {
    return { ok: false, reason: "card_invalid" };
  }
  if (!(await isActiveRow(env, "company_vehicle", input.vehicleId))) {
    return { ok: false, reason: "vehicle_invalid" };
  }

  const current = await findActiveBinding(env, input.fuelCardId);
  if (current?.vehicle_id === input.vehicleId) {
    return { ok: true, outcome: "unchanged", previousVehicleId: current.vehicle_id };
  }
  if (current && !(await closeBinding(env, current.id, input.operatorUserid))) {
    return { ok: false, reason: "conflict" };
  }

  const ts = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO fuel_card_vehicle_binding (
        fuel_card_id, vehicle_id, status, bound_at, bound_by_userid, created_at, updated_at
      ) VALUES (?, ?, 'active', ?, ?, ?, ?)`
    )
      .bind(input.fuelCardId, input.vehicleId, ts, input.operatorUserid, ts, ts)
      .run();
  } catch (error) {
    if (isActiveCardUniqueViolation(error)) {
      return { ok: false, reason: "conflict" };
    }
    throw error;
  }

  return current
    ? { ok: true, outcome: "transferred", previousVehicleId: current.vehicle_id }
    : { ok: true, outcome: "bound", previousVehicleId: null };
};

export const unbindFuelCardFromVehicle = async (
  env: Env,
  input: { fuelCardId: number; operatorUserid: string }
): Promise<UnbindFuelCardResult> => {
  const current = await findActiveBinding(env, input.fuelCardId);
  if (!current) {
    return { ok: false, reason: "not_bound" };
  }
  if (!(await closeBinding(env, current.id, input.operatorUserid))) {
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, previousVehicleId: current.vehicle_id };
};

export const isFuelCardBoundToVehicle = async (
  env: Env,
  fuelCardId: number,
  vehicleId: number
): Promise<boolean> => {
  const row = await env.DB.prepare(
    "SELECT id FROM fuel_card_vehicle_binding WHERE fuel_card_id = ? AND vehicle_id = ? AND status = 'active'"
  )
    .bind(fuelCardId, vehicleId)
    .first<{ id: number }>();
  return Boolean(row);
};

export const listFuelCardVehicleBindings = async (
  env: Env,
  fuelCardId: number
): Promise<FuelCardVehicleBindingHistoryRow[]> => {
  const rows = await env.DB.prepare(
    `SELECT
      b.id,
      b.vehicle_id,
      v.current_plate_no AS vehicle_plate_no,
      b.status,
      b.bound_at,
      b.bound_by_userid,
      b.unbound_at,
      b.unbound_by_userid
     FROM fuel_card_vehicle_binding b
     LEFT JOIN company_vehicle v ON v.id = b.vehicle_id
     WHERE b.fuel_card_id = ?
     ORDER BY b.id DESC`
  )
    .bind(fuelCardId)
    .all<FuelCardVehicleBindingHistoryRow>();
  return rows.results ?? [];
};
