/**
 * Shared predicates for approval-instance status semantics.
 *
 * The "returned to initiator, awaiting resubmit" state is canonically
 * `returned`. Legacy rows (before the 2026-07-01 migration) used `pending` for
 * the same meaning, so it is accepted as an alias on read paths.
 *
 * Centralising these avoids the earlier class of bug where individual business
 * routes hard-coded `status === 'pending'` and were missed when the canonical
 * status changed.
 */

/** Statuses from which the initiator may resubmit (start a fresh round). */
export const RESUBMITTABLE_STATUSES = ["returned", "pending", "withdrawn"] as const;

/** True when the initiator can resubmit this instance (edit biz doc → resubmit). */
export const isResubmittable = (status: string): boolean =>
  (RESUBMITTABLE_STATUSES as readonly string[]).includes(status);

/** True when an approval is actively running and should block re-submission/edits. */
export const isApprovalActive = (status: string): boolean => status === "in_progress";

/**
 * True when a business document is back in the owner's hands for rework and
 * ordinary edit locks must not apply: a plain draft (fresh, reverted on
 * return, or left draft after a failed resubmit/rejection) or an instance
 * awaiting resubmit whose business status was never reverted (legacy rows
 * from the 2026-07-01 conversion, e.g. payment_request stuck in
 * pending_approval). An actively running approval is never rework, even if
 * the business record still reads 'draft'.
 */
export const isOwnerReworkState = (
  bizStatus: string,
  approvalStatus: string | null
): boolean => {
  if (approvalStatus !== null && isApprovalActive(approvalStatus)) return false;
  if (bizStatus === "draft") return true;
  return approvalStatus !== null && isResubmittable(approvalStatus);
};

export type ExistingApprovalSubmissionDecision = "active" | "resubmit" | "new";

export const getExistingApprovalSubmissionDecision = (
  status: string
): ExistingApprovalSubmissionDecision => {
  if (isApprovalActive(status)) return "active";
  if (isResubmittable(status)) return "resubmit";
  return "new";
};
