import assert from "node:assert/strict";
import { test } from "node:test";

const loadResolver = async () => {
  const mod = await import("../src/utils/api-error.ts");
  return mod.resolveApiErrorMessage;
};

test("extracts nested backend message ({ error: { message } }) used by receipt routes", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = {
    response: {
      data: {
        success: false,
        error: { message: "Receipt overflow for invoice: existing 50000" }
      }
    }
  };
  assert.equal(
    resolveApiErrorMessage(error, "登记失败"),
    "Receipt overflow for invoice: existing 50000"
  );
});

test("extracts flat backend message ({ message })", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = { response: { data: { message: "发票与合同不匹配" } } };
  assert.equal(resolveApiErrorMessage(error, "登记失败"), "发票与合同不匹配");
});

test("extracts string error field ({ error: '...' }) used by reimbursement routes", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = { response: { data: { error: "余额不足" } } };
  assert.equal(resolveApiErrorMessage(error, "登记失败"), "余额不足");
});

test("uses axios message only for network errors (no response)", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = { message: "timeout of 10000ms exceeded" };
  assert.equal(
    resolveApiErrorMessage(error, "登记失败"),
    "timeout of 10000ms exceeded"
  );
});

test("ignores useless axios status message when a response exists, returns fallback", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = {
    message: "Request failed with status code 400",
    response: { data: {} }
  };
  assert.equal(resolveApiErrorMessage(error, "登记失败"), "登记失败");
});

test("returns fallback for blank backend message", async () => {
  const resolveApiErrorMessage = await loadResolver();
  const error = { response: { data: { error: { message: "   " } } } };
  assert.equal(resolveApiErrorMessage(error, "登记失败"), "登记失败");
});

test("returns fallback for null / undefined / empty errors", async () => {
  const resolveApiErrorMessage = await loadResolver();
  assert.equal(resolveApiErrorMessage(null, "登记失败"), "登记失败");
  assert.equal(resolveApiErrorMessage(undefined, "登记失败"), "登记失败");
  assert.equal(resolveApiErrorMessage({}, "登记失败"), "登记失败");
});
