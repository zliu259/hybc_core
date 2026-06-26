import { describe, expect, it } from "vitest";

import { amountChangeFloor } from "./contract-amount-change-floor";

describe("contract amount change floor", () => {
  it("uses paid_amount as the floor for outbound (付款) contracts", () => {
    const floor = amountChangeFloor({
      direction: "outbound",
      paid_amount: 5000,
      received_amount: 0
    });
    expect(floor).toEqual({ floor: 5000, label: "已打款" });
  });

  it("uses received_amount as the floor for inbound (收款) contracts", () => {
    const floor = amountChangeFloor({
      direction: "inbound",
      paid_amount: 0,
      received_amount: 8000
    });
    expect(floor).toEqual({ floor: 8000, label: "已收款" });
  });

  it("does not leak the payment floor onto inbound contracts", () => {
    // Regression: previously the endpoint validated every direction against
    // paid_amount, which is always 0 for inbound contracts, so a 收款合同 could
    // be lowered below the amount already received.
    const floor = amountChangeFloor({
      direction: "inbound",
      paid_amount: 0,
      received_amount: 12000
    });
    expect(floor.floor).toBe(12000);
  });
});
