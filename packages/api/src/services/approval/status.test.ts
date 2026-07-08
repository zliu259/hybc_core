import { describe, expect, it } from "vitest";

import {
  getExistingApprovalSubmissionDecision,
  isOwnerReworkState,
  isResubmittable
} from "./status";

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

describe("isOwnerReworkState", () => {
  it("treats a plain draft without approval instance as rework", () => {
    expect(isOwnerReworkState("draft", null)).toBe(true);
  });

  it("treats a draft reverted after return or rejection as rework", () => {
    expect(isOwnerReworkState("draft", "returned")).toBe(true);
    expect(isOwnerReworkState("draft", "rejected")).toBe(true);
  });

  it("treats stale returned rows (biz status never reverted) as rework", () => {
    // Legacy 2026-07-01 conversion set instances to 'returned' without
    // reverting the business record, e.g. payment_request 108 stuck in
    // pending_approval.
    expect(isOwnerReworkState("pending_approval", "returned")).toBe(true);
    expect(isOwnerReworkState("pending_approval", "pending")).toBe(true);
    expect(isOwnerReworkState("pending_approval", "withdrawn")).toBe(true);
  });

  it("never treats an actively running approval as rework", () => {
    expect(isOwnerReworkState("pending_approval", "in_progress")).toBe(false);
    // Resubmit may leave the biz record 'draft' while round 2 runs.
    expect(isOwnerReworkState("draft", "in_progress")).toBe(false);
  });

  it("does not treat finished non-draft records as rework", () => {
    expect(isOwnerReworkState("active", "approved")).toBe(false);
    expect(isOwnerReworkState("pending_approval", "rejected")).toBe(false);
  });
});
