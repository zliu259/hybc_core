import { describe, expect, it } from "vitest";

import { detectEInvoiceInPhysical, isElectronicInvoiceNumber } from "./reimbursement-einvoice-guard";

const ocrJson = (invoices: Record<string, unknown>[]): string =>
  JSON.stringify({ extracted_invoices: invoices });

describe("isElectronicInvoiceNumber", () => {
  it("accepts 20-digit numbers with surrounding whitespace", () => {
    expect(isElectronicInvoiceNumber("24312000000012345678")).toBe(true);
    expect(isElectronicInvoiceNumber(" 24312000000012345678 ")).toBe(true);
  });

  it("rejects paper invoice numbers and non-strings", () => {
    expect(isElectronicInvoiceNumber("12345678")).toBe(false);
    expect(isElectronicInvoiceNumber("2431200000001234567X")).toBe(false);
    expect(isElectronicInvoiceNumber(24312000000012345678)).toBe(false);
    expect(isElectronicInvoiceNumber(null)).toBe(false);
  });
});

describe("detectEInvoiceInPhysical", () => {
  it("detects a 20-digit e-invoice number inside a physical envelope", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([{ invoice_unique_no: "24312000000012345678" }])
    });
    expect(result.detected).toBe(true);
    expect(result.matchedNumbers).toEqual(["24312000000012345678"]);
  });

  it("detects via top-level hint when extracted list is empty", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: null,
      invoiceUniqueNoHint: "24312000000012345678"
    });
    expect(result.detected).toBe(true);
  });

  it("ignores electronic-channel envelopes", () => {
    const result = detectEInvoiceInPhysical({
      channel: "electronic",
      ocrResultJson: ocrJson([{ invoice_unique_no: "24312000000012345678" }])
    });
    expect(result.detected).toBe(false);
  });

  it("ignores paper invoice numbers", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([{ invoice_no: "12345678", invoice_unique_no: "12345678" }])
    });
    expect(result.detected).toBe(false);
  });

  it("tolerates malformed json and missing fields", () => {
    expect(
      detectEInvoiceInPhysical({ channel: "physical", ocrResultJson: "not-json" }).detected
    ).toBe(false);
    expect(
      detectEInvoiceInPhysical({ channel: "physical", ocrResultJson: "{}" }).detected
    ).toBe(false);
  });

  it("deduplicates matched numbers", () => {
    const result = detectEInvoiceInPhysical({
      channel: "physical",
      ocrResultJson: ocrJson([
        { invoice_unique_no: "24312000000012345678" },
        { invoice_unique_no: "24312000000012345678" }
      ])
    });
    expect(result.matchedNumbers).toEqual(["24312000000012345678"]);
  });
});
