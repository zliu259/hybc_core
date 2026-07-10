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

describe("decideBulkLifecycle unassigned stock envelope guard", () => {
  const UNASSIGNED = "__UNASSIGNED__";

  it.each(["draft", "unregistered", "cancelled"])(
    "rejects deleting an unassigned stock envelope even when status %s would otherwise be deletable",
    (status) => {
      const decision = decideBulkLifecycle("delete", status, {
        applicantUserid: UNASSIGNED,
        unassignedApplicant: UNASSIGNED
      });
      expect(decision.allowed).toBe(false);
    }
  );

  it.each(["draft", "unregistered", "submitted", "received"])(
    "rejects voiding an unassigned stock envelope even when status %s would otherwise be voidable",
    (status) => {
      const decision = decideBulkLifecycle("void", status, {
        applicantUserid: UNASSIGNED,
        unassignedApplicant: UNASSIGNED
      });
      expect(decision.allowed).toBe(false);
    }
  );

  it("carries a descriptive message when the unassigned guard blocks the operation", () => {
    const decision = decideBulkLifecycle("void", "draft", {
      applicantUserid: UNASSIGNED,
      unassignedApplicant: UNASSIGNED
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.message).toMatch(/unassigned/i);
  });

  it("behaves as usual when applicantUserid is a regular user (not the unassigned sentinel)", () => {
    expect(
      decideBulkLifecycle("void", "draft", {
        applicantUserid: "zhangsan",
        unassignedApplicant: UNASSIGNED
      })
    ).toEqual({ allowed: true, nextStatus: "cancelled" });

    expect(
      decideBulkLifecycle("delete", "submitted", {
        applicantUserid: "zhangsan",
        unassignedApplicant: UNASSIGNED
      }).allowed
    ).toBe(false);
  });

  it("preserves prior behavior when context is omitted entirely (backward compatibility)", () => {
    expect(decideBulkLifecycle("void", "draft")).toEqual({
      allowed: true,
      nextStatus: "cancelled"
    });
    expect(decideBulkLifecycle("delete", "submitted").allowed).toBe(false);
    expect(decideBulkLifecycle("delete", "draft")).toEqual({
      allowed: true,
      nextStatus: "deleted"
    });
  });
});
