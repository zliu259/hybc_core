import { describe, expect, it } from "vitest";

import {
  bindFuelCardToVehicle,
  isFuelCardBoundToVehicle,
  listFuelCardVehicleBindings,
  unbindFuelCardFromVehicle
} from "./fleet-card-binding";
import type { Env } from "../types/env";

type FakeOptions = {
  card?: { status: string } | null;
  vehicle?: { status: string } | null;
  activeBinding?: { id: number; vehicle_id: number } | null;
  closeChanges?: number;
  insertError?: Error;
  historyRows?: unknown[];
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeBindingDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class FakeBindingDb {
  readonly runs: { sql: string; params: unknown[] }[] = [];
  readonly reads: { sql: string; params: unknown[] }[] = [];

  constructor(private readonly options: FakeOptions = {}) {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    this.reads.push({ sql, params });
    if (sql.includes("FROM fuel_card_vehicle_binding")) {
      const binding = this.options.activeBinding ?? null;
      if (!binding) return null;
      if (sql.includes("vehicle_id = ?") && params[1] !== binding.vehicle_id) return null;
      return binding as T;
    }
    if (sql.includes("FROM fuel_card WHERE id = ?")) {
      if (this.options.card === null) return null;
      return { id: params[0], status: "active", ...this.options.card } as T;
    }
    if (sql.includes("FROM company_vehicle WHERE id = ?")) {
      if (this.options.vehicle === null) return null;
      return { id: params[0], status: "active", ...this.options.vehicle } as T;
    }
    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    this.reads.push({ sql, params });
    return { results: (this.options.historyRows ?? []) as T[] };
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    if (sql.includes("INSERT INTO fuel_card_vehicle_binding") && this.options.insertError) {
      throw this.options.insertError;
    }
    if (sql.includes("UPDATE fuel_card_vehicle_binding")) {
      return { meta: { last_row_id: 0, changes: this.options.closeChanges ?? 1 } };
    }
    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }
}

const envWith = (options: FakeOptions = {}) => {
  const db = new FakeBindingDb(options);
  return { env: { DB: db } as unknown as Env, db };
};

const bindInput = { fuelCardId: 5, vehicleId: 3, operatorUserid: "office-a" };

describe("bindFuelCardToVehicle", () => {
  it("rejects inactive or missing card", async () => {
    const missing = envWith({ card: null });
    expect(await bindFuelCardToVehicle(missing.env, bindInput)).toEqual({
      ok: false,
      reason: "card_invalid"
    });
    expect(missing.db.runs).toEqual([]);

    const inactive = envWith({ card: { status: "inactive" } });
    expect(await bindFuelCardToVehicle(inactive.env, bindInput)).toEqual({
      ok: false,
      reason: "card_invalid"
    });
    expect(inactive.db.runs).toEqual([]);
  });

  it("rejects inactive or missing vehicle", async () => {
    const missing = envWith({ vehicle: null });
    expect(await bindFuelCardToVehicle(missing.env, bindInput)).toEqual({
      ok: false,
      reason: "vehicle_invalid"
    });
    expect(missing.db.runs).toEqual([]);

    const inactive = envWith({ vehicle: { status: "inactive" } });
    expect(await bindFuelCardToVehicle(inactive.env, bindInput)).toEqual({
      ok: false,
      reason: "vehicle_invalid"
    });
    expect(inactive.db.runs).toEqual([]);
  });

  it("binds an unbound card", async () => {
    const { env, db } = envWith();

    expect(await bindFuelCardToVehicle(env, bindInput)).toEqual({
      ok: true,
      outcome: "bound",
      previousVehicleId: null
    });
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]?.sql).toContain("INSERT INTO fuel_card_vehicle_binding");
    expect(db.runs[0]?.params).toEqual(
      expect.arrayContaining([5, 3, "office-a"])
    );
  });

  it("returns unchanged without writes when already bound to the same vehicle", async () => {
    const { env, db } = envWith({ activeBinding: { id: 11, vehicle_id: 3 } });

    expect(await bindFuelCardToVehicle(env, bindInput)).toEqual({
      ok: true,
      outcome: "unchanged",
      previousVehicleId: 3
    });
    expect(db.runs).toEqual([]);
  });

  it("transfers a card bound to another vehicle", async () => {
    const { env, db } = envWith({ activeBinding: { id: 11, vehicle_id: 8 } });

    expect(await bindFuelCardToVehicle(env, bindInput)).toEqual({
      ok: true,
      outcome: "transferred",
      previousVehicleId: 8
    });
    expect(db.runs).toHaveLength(2);
    const [close, insert] = db.runs;
    expect(close?.sql).toContain("UPDATE fuel_card_vehicle_binding");
    expect(close?.sql).toContain("status = 'inactive'");
    expect(close?.sql).toContain("unbound_at");
    expect(close?.sql).toContain("unbound_by_userid");
    expect(close?.sql).toContain("WHERE id = ? AND status = 'active'");
    expect(close?.params).toEqual(expect.arrayContaining(["office-a", 11]));
    expect(insert?.sql).toContain("INSERT INTO fuel_card_vehicle_binding");
    expect(insert?.params).toEqual(expect.arrayContaining([5, 3, "office-a"]));
  });

  it("returns conflict when closing the old binding changes 0 rows", async () => {
    const { env, db } = envWith({ activeBinding: { id: 11, vehicle_id: 8 }, closeChanges: 0 });

    expect(await bindFuelCardToVehicle(env, bindInput)).toEqual({ ok: false, reason: "conflict" });
    expect(db.runs.some((call) => call.sql.includes("INSERT INTO"))).toBe(false);
  });

  it("returns conflict when insert hits the active-card unique index", async () => {
    const { env } = envWith({
      insertError: new Error(
        "D1_ERROR: UNIQUE constraint failed: fuel_card_vehicle_binding.fuel_card_id: SQLITE_CONSTRAINT"
      )
    });

    expect(await bindFuelCardToVehicle(env, bindInput)).toEqual({ ok: false, reason: "conflict" });
  });

  it("rethrows other insert errors", async () => {
    const { env } = envWith({ insertError: new Error("D1_ERROR: network lost") });

    await expect(bindFuelCardToVehicle(env, bindInput)).rejects.toThrow("network lost");
  });
});

describe("unbindFuelCardFromVehicle", () => {
  it("unbind returns not_bound when no active binding", async () => {
    const { env, db } = envWith();

    expect(await unbindFuelCardFromVehicle(env, { fuelCardId: 5, operatorUserid: "office-a" })).toEqual({
      ok: false,
      reason: "not_bound"
    });
    expect(db.runs).toEqual([]);
  });

  it("unbind closes the active binding", async () => {
    const { env, db } = envWith({ activeBinding: { id: 11, vehicle_id: 8 } });

    expect(await unbindFuelCardFromVehicle(env, { fuelCardId: 5, operatorUserid: "office-a" })).toEqual({
      ok: true,
      previousVehicleId: 8
    });
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]?.sql).toContain("status = 'inactive'");
    expect(db.runs[0]?.params).toEqual(expect.arrayContaining(["office-a", 11]));
  });

  it("unbind returns conflict when the binding changed underneath", async () => {
    const { env } = envWith({ activeBinding: { id: 11, vehicle_id: 8 }, closeChanges: 0 });

    expect(await unbindFuelCardFromVehicle(env, { fuelCardId: 5, operatorUserid: "office-a" })).toEqual({
      ok: false,
      reason: "conflict"
    });
  });
});

describe("isFuelCardBoundToVehicle", () => {
  it("is true only for the vehicle the card is actively bound to", async () => {
    const { env, db } = envWith({ activeBinding: { id: 11, vehicle_id: 8 } });

    expect(await isFuelCardBoundToVehicle(env, 5, 8)).toBe(true);
    expect(await isFuelCardBoundToVehicle(env, 5, 3)).toBe(false);

    const query = db.reads[0];
    expect(query?.sql).toContain("fuel_card_id = ?");
    expect(query?.sql).toContain("vehicle_id = ?");
    expect(query?.sql).toContain("status = 'active'");
    expect(query?.params).toEqual([5, 8]);
  });

  it("is false for an unbound card", async () => {
    const { env } = envWith();

    expect(await isFuelCardBoundToVehicle(env, 5, 8)).toBe(false);
  });
});

describe("listFuelCardVehicleBindings", () => {
  it("returns the card's binding history newest first with plate numbers", async () => {
    const rows = [
      {
        id: 12,
        vehicle_id: 3,
        vehicle_plate_no: "京MKG902",
        status: "active",
        bound_at: "2026-10-25T02:00:00.000Z",
        bound_by_userid: "office-a",
        unbound_at: null,
        unbound_by_userid: null
      }
    ];
    const { env, db } = envWith({ historyRows: rows });

    expect(await listFuelCardVehicleBindings(env, 5)).toEqual(rows);
    expect(db.reads[0]?.sql).toContain("LEFT JOIN company_vehicle");
    expect(db.reads[0]?.sql).toContain("ORDER BY b.id DESC");
    expect(db.reads[0]?.params).toEqual([5]);
  });
});
