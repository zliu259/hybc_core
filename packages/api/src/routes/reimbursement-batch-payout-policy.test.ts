import { describe, expect, it } from "vitest";

import {
  canUpdateBatchPayoutPlan,
  PAYOUT_PLAN_APPROVAL_PROGRESS_ERROR_MESSAGE,
  PAYOUT_PLAN_APPROVER_ERROR_MESSAGE,
  PAYOUT_PLAN_STATE_ERROR_MESSAGE
} from "./reimbursement-batch-payout-policy";

describe("canUpdateBatchPayoutPlan", () => {
  it("allows super admin regardless of batch status", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: true,
      batchStatus: "paid",
      approvalInstanceId: null,
      approvalStatus: null,
      hasCurrentApproverTask: false
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("allows office role update when batch is draft", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "draft",
      approvalInstanceId: null,
      approvalStatus: null,
      hasCurrentApproverTask: false
    });

    expect(decision).toEqual({ allowed: true });
  });

  it("rejects non-pending states for non-super-admin", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "approved",
      approvalInstanceId: 12,
      approvalStatus: "approved",
      hasCurrentApproverTask: true
    });

    expect(decision).toEqual({
      allowed: false,
      message: PAYOUT_PLAN_STATE_ERROR_MESSAGE
    });
  });

  it("rejects pending_approval without approval instance", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "pending_approval",
      approvalInstanceId: null,
      approvalStatus: "pending",
      hasCurrentApproverTask: true
    });

    expect(decision).toEqual({
      allowed: false,
      message: PAYOUT_PLAN_STATE_ERROR_MESSAGE
    });
  });

  it("rejects when approval instance is not in progress", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "pending_approval",
      approvalInstanceId: 99,
      approvalStatus: "approved",
      hasCurrentApproverTask: true
    });

    expect(decision).toEqual({
      allowed: false,
      message: PAYOUT_PLAN_APPROVAL_PROGRESS_ERROR_MESSAGE
    });
  });

  it("rejects when caller is not current approver", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "pending_approval",
      approvalInstanceId: 99,
      approvalStatus: "in_progress",
      hasCurrentApproverTask: false
    });

    expect(decision).toEqual({
      allowed: false,
      message: PAYOUT_PLAN_APPROVER_ERROR_MESSAGE
    });
  });

  it("allows current approver while approval is in progress", () => {
    const decision = canUpdateBatchPayoutPlan({
      isSuperAdmin: false,
      batchStatus: "pending_approval",
      approvalInstanceId: 101,
      approvalStatus: "pending",
      hasCurrentApproverTask: true
    });

    expect(decision).toEqual({ allowed: true });
  });
});
