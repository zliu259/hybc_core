import { describe, expect, it } from "vitest";

import type { FuelCard } from "@/api/fleet";

import { useVehicleFuelCards } from "./useVehicleFuelCards";

const card = (id: number): FuelCard => ({
  id,
  card_no: `CARD-${id}`,
  issued_to_entity_id: null,
  latest_balance: 0,
  status: "active",
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  vehicle_id: 1,
  vehicle_plate_no: "V1"
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("useVehicleFuelCards", () => {
  it("auto-selects the only card of the chosen vehicle", async () => {
    const loader = useVehicleFuelCards(async () => [card(7)]);

    expect(await loader.selectVehicle(1)).toEqual({
      applied: true,
      cardId: 7
    });
    expect(loader.cards.value.map(c => c.id)).toEqual([7]);
    expect(loader.noCard.value).toBe(false);
  });

  it("reports no card only when the vehicle really has none", async () => {
    const loader = useVehicleFuelCards(async () => []);

    await loader.selectVehicle(3);

    expect(loader.noCard.value).toBe(true);
    expect(loader.loadFailed.value).toBe(false);
  });

  it("does not report no card when loading fails", async () => {
    const failure = new Error("network lost");
    const loader = useVehicleFuelCards(async () => {
      throw failure;
    });

    const result = await loader.selectVehicle(1);

    expect(result).toEqual({
      applied: true,
      cardId: undefined,
      error: failure
    });
    expect(loader.loadFailed.value).toBe(true);
    expect(loader.noCard.value).toBe(false);
    expect(loader.loading.value).toBe(false);
  });

  it("drops a late response from a previously selected vehicle", async () => {
    const slow = deferred<FuelCard[]>();
    const loader = useVehicleFuelCards(vehicleId =>
      vehicleId === 2 ? slow.promise : Promise.resolve([card(11)])
    );

    const first = loader.selectVehicle(2);
    expect(await loader.selectVehicle(1)).toEqual({
      applied: true,
      cardId: 11
    });
    slow.resolve([card(21), card(22)]);

    expect(await first).toEqual({ applied: false });
    expect(loader.cards.value.map(c => c.id)).toEqual([11]);
    expect(loader.loading.value).toBe(false);
  });

  it("clearing the vehicle stops loading and shows no warning", async () => {
    const slow = deferred<FuelCard[]>();
    const loader = useVehicleFuelCards(() => slow.promise);

    const pending = loader.selectVehicle(2);
    expect(loader.loading.value).toBe(true);
    expect(await loader.selectVehicle(undefined)).toEqual({
      applied: true,
      cardId: undefined
    });
    slow.resolve([card(21)]);
    await pending;

    expect(loader.loading.value).toBe(false);
    expect(loader.cards.value).toEqual([]);
    expect(loader.noCard.value).toBe(false);
  });
});
