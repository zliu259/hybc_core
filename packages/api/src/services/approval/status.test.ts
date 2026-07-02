import { describe, expect, it } from "vitest";

import { getExistingApprovalSubmissionDecision, isResubmittable } from "./status";

describe("isResubmittable", () => {
  it("treats a returned-to-initiator instance as resubmittable", () => {
    // The regression: business submit-approval endpoints gated resubmit on
    // 'pending'/'withdrawn' only, so after returnToInitiator started writing
    // 'returned', editing a returned biz doc and re-submitting no longer took
    // the resubmit branch.
    expect(isResubmittable("returned")).toBe(true);
  });

  it("still accepts the legacy 'pending' alias and 'withdrawn'", () => {
    expect(isResubmittable("pending")).toBe(true);
    expect(isResubmittable("withdrawn")).toBe(true);
  });

  it("does not treat active or terminal instances as resubmittable", () => {
    expect(isResubmittable("in_progress")).toBe(false);
    expect(isResubmittable("approved")).toBe(false);
    expect(isResubmittable("rejected")).toBe(false);
    expect(isResubmittable("cancelled")).toBe(false);
  });
});

describe("getExistingApprovalSubmissionDecision", () => {
  it("blocks only active approval instances", () => {
    expect(getExistingApprovalSubmissionDecision("in_progress")).toBe("active");
  });

  it("routes returned, legacy pending, and withdrawn instances to resubmit", () => {
    expect(getExistingApprovalSubmissionDecision("returned")).toBe("resubmit");
    expect(getExistingApprovalSubmissionDecision("pending")).toBe("resubmit");
    expect(getExistingApprovalSubmissionDecision("withdrawn")).toBe("resubmit");
  });

  it("does not treat terminal instances as active or resubmittable", () => {
    expect(getExistingApprovalSubmissionDecision("approved")).toBe("new");
    expect(getExistingApprovalSubmissionDecision("rejected")).toBe("new");
    expect(getExistingApprovalSubmissionDecision("cancelled")).toBe("new");
  });
});
