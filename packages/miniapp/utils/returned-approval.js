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

/**
 * 业务单据已作废（status = cancelled）时，即便审批实例仍停在 returned，也不能再编辑重提：
 * 后端 submit-approval 会因单据非草稿直接拒绝。审批详情与退回编辑页据此收起入口、给出明确提示
 * （2026-09-13 SP-20260913-0007：付款被作废后实例仍是 returned，入口照常出现，提交却失败）。
 */
const isBizRecordCancelled = (bizDetail) => {
  if (!bizDetail || typeof bizDetail !== "object") return false;
  return String(bizDetail.status || "").trim().toLowerCase() === "cancelled";
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
  isBizRecordCancelled,
  getReturnedApprovalEditRoute
};
