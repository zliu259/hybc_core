const RETURNED_APPROVAL_EDIT_BIZ_TYPES = [
  "payment_request",
  "reimbursement_batch",
  "stock_order",
  "warehouse_asset_work_order",
  "outbound_contract",
  "inbound_contract",
  "invoice_request"
];

const editableBizTypeSet = new Set(RETURNED_APPROVAL_EDIT_BIZ_TYPES);

const normalizeUserId = (value) => String(value || "").trim();

const canEditReturnedApproval = (instance, currentUserId) => {
  if (!instance || typeof instance !== "object") return false;
  if (instance.status !== "returned") return false;
  if (!editableBizTypeSet.has(String(instance.biz_type || ""))) return false;
  if (!Number(instance.biz_id || 0)) return false;
  const initiator = normalizeUserId(instance.initiator_userid);
  const userId = normalizeUserId(currentUserId);
  return Boolean(initiator && userId && initiator === userId);
};

const getReturnedApprovalEditRoute = ({ approvalId, bizType, bizId }) => {
  const normalizedBizType = String(bizType || "").trim();
  if (!editableBizTypeSet.has(normalizedBizType)) return "";
  const normalizedApprovalId = Number(approvalId || 0);
  const normalizedBizId = Number(bizId || 0);
  if (!normalizedApprovalId || !normalizedBizId) return "";
  return `/pages/returned-approval-edit/index?approvalId=${normalizedApprovalId}&bizType=${encodeURIComponent(
    normalizedBizType
  )}&bizId=${normalizedBizId}`;
};

module.exports = {
  RETURNED_APPROVAL_EDIT_BIZ_TYPES,
  canEditReturnedApproval,
  getReturnedApprovalEditRoute
};
