export type ApprovalLockInput = {
  isCreate: boolean;
  approvalInstanceId?: number | null;
  bizStatus?: string | null;
  pendingStatus?: string;
  unlockedStatuses?: string[];
};

export const isApprovalInProgress = (
  bizStatus?: string | null,
  pendingStatus = "pending_approval"
) => {
  return !!bizStatus && bizStatus === pendingStatus;
};

export const isApprovalFinishedLocked = ({
  isCreate,
  approvalInstanceId,
  bizStatus,
  pendingStatus = "pending_approval",
  unlockedStatuses = []
}: ApprovalLockInput) => {
  if (isCreate) return false;
  if (!approvalInstanceId) return false;
  if (!bizStatus) return false;
  if (isApprovalInProgress(bizStatus, pendingStatus)) return false;
  return !unlockedStatuses.includes(bizStatus);
};
