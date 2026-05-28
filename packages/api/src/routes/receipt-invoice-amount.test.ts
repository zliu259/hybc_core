import { describe, expect, it } from "vitest";

import { invoiceContractAmount, invoiceContractAmountSql } from "./receipt-invoice-amount";

describe("receipt invoice contract amount", () => {
  it("uses tax-inclusive amount for contract invoiced totals", () => {
    expect(invoiceContractAmount({ amount: 100, amount_with_tax: 106 })).toBe(106);
  });

  it("falls back to legacy invoice amount when tax-inclusive amount is absent", () => {
    expect(invoiceContractAmount({ amount: 100, amount_with_tax: null })).toBe(100);
  });

  it("publishes the SQL expression used by invoice aggregate queries", () => {
    expect(invoiceContractAmountSql).toBe("COALESCE(amount_with_tax, amount)");
  });
});
