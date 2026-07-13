import { describe, expect, it } from "vitest";

import { evaluateDuplicatePrecheckGate } from "./reimbursement-duplicate-gate";

describe("evaluateDuplicatePrecheckGate", () => {
  it("passes when no duplicate risk exists", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 0,
        overrideRequested: false,
        actorRoles: ["site_manager"]
      })
    ).toEqual({ outcome: "pass" });
  });

  it("passes when the applicant already insist-submitted", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 3,
        overrideRequested: true,
        actorRoles: ["site_manager"]
      })
    ).toEqual({ outcome: "pass" });
  });

  it("lets finance override with a reason (trimmed)", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 2,
        overrideRequested: false,
        actorRoles: ["finance"],
        overrideReason: "  已人工核对票据，非重复报销  "
      })
    ).toEqual({ outcome: "override", reason: "已人工核对票据，非重复报销" });
  });

  it("lets super_admin override with a reason", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 1,
        overrideRequested: false,
        actorRoles: ["super_admin"],
        overrideReason: "线下已与申请人确认"
      })
    ).toEqual({ outcome: "override", reason: "线下已与申请人确认" });
  });

  it("blocks finance without a reason but marks it overridable", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 1,
        overrideRequested: false,
        actorRoles: ["finance"]
      })
    ).toEqual({ outcome: "blocked", canOverride: true });
  });

  it("blocks finance when the reason is whitespace only", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 1,
        overrideRequested: false,
        actorRoles: ["finance"],
        overrideReason: "   "
      })
    ).toEqual({ outcome: "blocked", canOverride: true });
  });

  it("blocks non-finance roles even with a reason", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 1,
        overrideRequested: false,
        actorRoles: ["manager", "site_manager"],
        overrideReason: "想强行通过"
      })
    ).toEqual({ outcome: "blocked", canOverride: false });
  });

  it("ignores non-string override reasons", () => {
    expect(
      evaluateDuplicatePrecheckGate({
        duplicateCount: 1,
        overrideRequested: false,
        actorRoles: ["finance"],
        overrideReason: 123 as unknown
      })
    ).toEqual({ outcome: "blocked", canOverride: true });
  });
});
