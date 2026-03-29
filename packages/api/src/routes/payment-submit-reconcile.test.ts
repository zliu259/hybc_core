import { describe, expect, it } from "vitest";

import {
  isPaymentStatusReconcileEligible,
  mapApprovalInstanceStatusToPaymentStatus
} from "./payment";

describe("mapApprovalInstanceStatusToPaymentStatus", () => {
  it("maps pending and in_progress to pending_approval", () => {
    expect(mapApprovalInstanceStatusToPaymentStatus("pending")).toBe(
      "pending_approval"
    );
    expect(mapApprovalInstanceStatusToPaymentStatus("in_progress")).toBe(
      "pending_approval"
    );
  });

  it("maps approved and completed to approved", () => {
    expect(mapApprovalInstanceStatusToPaymentStatus("approved")).toBe("approved");
    expect(mapApprovalInstanceStatusToPaymentStatus("completed")).toBe("approved");
  });

  it("maps rejected to rejected", () => {
    expect(mapApprovalInstanceStatusToPaymentStatus("rejected")).toBe("rejected");
  });

  it("returns null for unsupported statuses", () => {
    expect(mapApprovalInstanceStatusToPaymentStatus("withdrawn")).toBeNull();
    expect(mapApprovalInstanceStatusToPaymentStatus("cancelled")).toBeNull();
    expect(mapApprovalInstanceStatusToPaymentStatus("unknown")).toBeNull();
  });
});

describe("isPaymentStatusReconcileEligible", () => {
  it("allows draft and pending_approval", () => {
    expect(isPaymentStatusReconcileEligible("draft")).toBe(true);
    expect(isPaymentStatusReconcileEligible("pending_approval")).toBe(true);
  });

  it("blocks terminal and non-submit statuses", () => {
    expect(isPaymentStatusReconcileEligible("approved")).toBe(false);
    expect(isPaymentStatusReconcileEligible("paid")).toBe(false);
    expect(isPaymentStatusReconcileEligible("cancelled")).toBe(false);
    expect(isPaymentStatusReconcileEligible("rejected")).toBe(false);
  });
});
