import { describe, expect, it } from "vitest";

import type { FleetVehicle, FuelCard } from "@/api/fleet";

import {
  fuelCardOptionLabel,
  resolveFuelCardSelection,
  vehicleOptionLabel
} from "./fuel-card-selection";

const card = (id: number, overrides: Partial<FuelCard> = {}): FuelCard => ({
  id,
  card_no: `CARD-${id}`,
  issued_to_entity_id: null,
  latest_balance: 0,
  status: "active",
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  vehicle_id: 3,
  vehicle_plate_no: "京MKG902",
  ...overrides
});

const vehicle = (overrides: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id: 3,
  vehicle_uuid: "uuid-3",
  entity_id: null,
  ownership_type: "company_owned",
  owner_name: null,
  current_plate_no: "京MKG902",
  vehicle_model: "福田（轻型普通货车）",
  status: "active",
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  fuel_card_count: 2,
  fuel_card_nos: "a,b",
  ...overrides
});

describe("resolveFuelCardSelection", () => {
  it("keeps the previous card when it is still in the list", () => {
    expect(resolveFuelCardSelection([card(3), card(5)], 5)).toBe(5);
  });

  it("auto-selects the only card", () => {
    expect(resolveFuelCardSelection([card(7)])).toBe(7);
    expect(resolveFuelCardSelection([card(7)], 99)).toBe(7);
  });

  it("leaves selection empty for multiple cards without a valid previous", () => {
    expect(resolveFuelCardSelection([card(3), card(5)])).toBeUndefined();
    expect(resolveFuelCardSelection([card(3), card(5)], 99)).toBeUndefined();
    expect(resolveFuelCardSelection([])).toBeUndefined();
  });
});

describe("fuelCardOptionLabel", () => {
  it("shows the card number and balance with two decimals", () => {
    expect(
      fuelCardOptionLabel(
        card(5, { card_no: "1000111300013742430", latest_balance: 1000 })
      )
    ).toBe("1000111300013742430（余额 1000.00）");
    expect(
      fuelCardOptionLabel(card(5, { card_no: "X", latest_balance: 1136.27 }))
    ).toBe("X（余额 1136.27）");
  });
});

describe("vehicleOptionLabel", () => {
  it("shows plate and model", () => {
    expect(vehicleOptionLabel(vehicle())).toBe(
      "京MKG902 · 福田（轻型普通货车）"
    );
  });

  it("marks vehicles without cards", () => {
    expect(vehicleOptionLabel(vehicle({ fuel_card_count: 0 }))).toBe(
      "京MKG902 · 福田（轻型普通货车）（未配卡）"
    );
  });

  it("shows only the plate when the model is missing", () => {
    expect(vehicleOptionLabel(vehicle({ vehicle_model: null }))).toBe(
      "京MKG902"
    );
  });
});
