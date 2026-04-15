export const PAYOUT_PLAN_STATE_ERROR_MESSAGE =
  "Batch payout plan can only be changed in draft or in-progress approval state";
export const PAYOUT_PLAN_APPROVAL_PROGRESS_ERROR_MESSAGE =
  "Batch payout plan can only be changed while approval is in progress";
export const PAYOUT_PLAN_APPROVER_ERROR_MESSAGE =
  "Only current approver can adjust payout plan during approval";

export type BatchPayoutPlanUpdatePolicyInput = {
  isSuperAdmin: boolean;
  batchStatus: string;
  approvalInstanceId: number | null;
  approvalStatus: string | null;
  hasCurrentApproverTask: boolean;
};

export const canUpdateBatchPayoutPlan = (
  input: BatchPayoutPlanUpdatePolicyInput
): { allowed: true } | { allowed: false; message: string } => {
  if (input.isSuperAdmin) {
    return { allowed: true };
  }

  if (input.batchStatus === "draft") {
    return { allowed: true };
  }

  if (input.batchStatus !== "pending_approval" || !input.approvalInstanceId) {
    return {
      allowed: false,
      message: PAYOUT_PLAN_STATE_ERROR_MESSAGE
    };
  }

  const approvalInProgress =
    input.approvalStatus === "pending" || input.approvalStatus === "in_progress";
  if (!approvalInProgress) {
    return {
      allowed: false,
      message: PAYOUT_PLAN_APPROVAL_PROGRESS_ERROR_MESSAGE
    };
  }

  if (!input.hasCurrentApproverTask) {
    return {
      allowed: false,
      message: PAYOUT_PLAN_APPROVER_ERROR_MESSAGE
    };
  }

  return { allowed: true };
};
