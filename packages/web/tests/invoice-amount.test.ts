import assert from "node:assert/strict";
import { test } from "node:test";

const loadFn = async () => {
  const mod = await import("../src/utils/invoice-amount.ts");
  return mod.invoiceReceivableAmount;
};

test("prefers tax-inclusive amount (价税合计) over pre-tax amount", async () => {
  const invoiceReceivableAmount = await loadFn();
  assert.equal(
    invoiceReceivableAmount({ amount: 1000, amount_with_tax: 1130 }),
    1130
  );
});

test("falls back to pre-tax amount when amount_with_tax is null", async () => {
  const invoiceReceivableAmount = await loadFn();
  assert.equal(
    invoiceReceivableAmount({ amount: 1000, amount_with_tax: null }),
    1000
  );
});

test("falls back to pre-tax amount when amount_with_tax is missing", async () => {
  const invoiceReceivableAmount = await loadFn();
  assert.equal(invoiceReceivableAmount({ amount: 888 }), 888);
});

test("returns 0 when neither amount is a finite number", async () => {
  const invoiceReceivableAmount = await loadFn();
  assert.equal(
    invoiceReceivableAmount({ amount: null, amount_with_tax: null }),
    0
  );
  assert.equal(
    invoiceReceivableAmount({
      amount: Number.NaN,
      amount_with_tax: Number.NaN
    }),
    0
  );
});

test("treats amount_with_tax of 0 as a valid (non-null) value", async () => {
  const invoiceReceivableAmount = await loadFn();
  assert.equal(invoiceReceivableAmount({ amount: 1000, amount_with_tax: 0 }), 0);
});
