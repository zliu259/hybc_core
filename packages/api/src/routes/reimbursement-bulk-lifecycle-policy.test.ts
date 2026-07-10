import { describe, expect, it } from "vitest";

import { decideBulkLifecycle } from "./reimbursement-bulk-lifecycle-policy";

describe("decideBulkLifecycle", () => {
  it.each(["draft", "unregistered", "submitted", "received"])(
    "allows voiding status %s",
    (status) => {
      expect(decideBulkLifecycle("void", status)).toEqual({
        allowed: true,
        nextStatus: "cancelled"
      });
    }
  );

  it.each(["batched", "pending_approval", "approved", "paid", "cancelled", "deleted"])(
    "rejects voiding status %s",
    (status) => {
      expect(decideBulkLifecycle("void", status).allowed).toBe(false);
    }
  );

  it.each(["draft", "unregistered", "cancelled"])("allows deleting status %s", (status) => {
    expect(decideBulkLifecycle("delete", status)).toEqual({
      allowed: true,
      nextStatus: "deleted"
    });
  });

  it.each(["submitted", "received", "batched", "pending_approval", "approved", "paid", "deleted"])(
    "rejects deleting status %s (must void first or never entered flow)",
    (status) => {
      expect(decideBulkLifecycle("delete", status).allowed).toBe(false);
    }
  );
});
