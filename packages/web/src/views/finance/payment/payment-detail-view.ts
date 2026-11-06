import type { ApprovalDetailResponse } from "@/api/approval";
import type { Payee, PaymentRequestDetail } from "@/api/payment";
import type { AttachmentUploadRoute } from "../shared/format";

/** PUT /payment/:id 和触发风险评估的角色，与后端 requireRoles 保持一致 */
const WRITE_ROLES = ["super_admin", "manager", "site_manager", "finance"];
/** POST /payment/:id/mark-paid 的角色 */
const PAYOUT_ROLES = ["super_admin", "manager", "finance"];
const DECISION_ACTIONS = [
  "approve",
  "reject",
  "return_prev",
  "return_to",
  "return_initiator"
];
/** 这些状态已走完审批，只允许补传附件 */
const FINISHED_STATUSES = ["approved", "paid", "rejected", "cancelled"];

export type PaymentCapabilities = {
  canEditFields: boolean;
  canToggleSuperEdit: boolean;
  canSubmit: boolean;
  canAssessRisk: boolean;
  canMarkPaid: boolean;
  canVoid: boolean;
  canReactivate: boolean;
  canAdjustPayout: boolean;
  attachmentUploadVia: AttachmentUploadRoute;
  canRemoveAttachment: boolean;
};

export type CapabilityInput = {
  detail: Pick<PaymentRequestDetail, "status" | "approval_instance_id"> | null;
  approvalDetail: Pick<
    ApprovalDetailResponse,
    "instance" | "available_actions"
  > | null;
  roles: readonly string[];
  superEditMode: boolean;
};

const NO_CAPABILITIES: PaymentCapabilities = {
  canEditFields: false,
  canToggleSuperEdit: false,
  canSubmit: false,
  canAssessRisk: false,
  canMarkPaid: false,
  canVoid: false,
  canReactivate: false,
  canAdjustPayout: false,
  attachmentUploadVia: null,
  canRemoveAttachment: false
};

const hasAnyRole = (roles: readonly string[], allowed: readonly string[]) =>
  roles.some(role => allowed.includes(role));

const resolveUploadRoute = (params: {
  status: string;
  hasInstance: boolean;
  isDraft: boolean;
  approvalRunning: boolean;
  canWrite: boolean;
  isSuperAdmin: boolean;
  superEdit: boolean;
  canDecide: boolean;
}): AttachmentUploadRoute => {
  if (params.superEdit) return "biz";
  if (params.isDraft) return params.canWrite ? "biz" : null;
  if (params.approvalRunning) {
    return params.hasInstance && (params.canDecide || params.isSuperAdmin)
      ? "approval"
      : null;
  }
  return params.canWrite &&
    params.hasInstance &&
    FINISHED_STATUSES.includes(params.status)
    ? "biz"
    : null;
};

/**
 * 当前用户在这张付款单上能做什么。页面只显示能用的按钮，这里的规则要和后端的
 * 角色、状态校验一致，否则用户点了才报错。
 */
export const resolvePaymentCapabilities = ({
  detail,
  approvalDetail,
  roles,
  superEditMode
}: CapabilityInput): PaymentCapabilities => {
  if (!detail) return NO_CAPABILITIES;
  const { status } = detail;
  const isSuperAdmin = roles.includes("super_admin");
  const canWrite = hasAnyRole(roles, WRITE_ROLES);
  const approvalRunning =
    status === "pending_approval" ||
    approvalDetail?.instance.status === "in_progress";
  const isDraft = status === "draft" && !approvalRunning;
  const superEdit = isSuperAdmin && superEditMode;
  const actions = approvalDetail?.available_actions ?? [];
  const canDecide = actions.some(action => DECISION_ACTIONS.includes(action));

  return {
    canEditFields: (isDraft && canWrite) || superEdit,
    canToggleSuperEdit: isSuperAdmin && !isDraft,
    canSubmit: isDraft,
    canAssessRisk: isDraft && canWrite,
    canMarkPaid: status === "approved" && hasAnyRole(roles, PAYOUT_ROLES),
    canVoid: isSuperAdmin && status !== "cancelled",
    canReactivate: isSuperAdmin && status === "cancelled",
    canAdjustPayout:
      approvalRunning && (actions.includes("approve") || superEdit),
    attachmentUploadVia: resolveUploadRoute({
      status,
      hasInstance: Boolean(detail.approval_instance_id),
      isDraft,
      approvalRunning,
      canWrite,
      isSuperAdmin,
      superEdit,
      canDecide
    }),
    canRemoveAttachment: (isDraft && canWrite) || superEdit
  };
};

/** 合同余额。单价合同总额可能是 0，算出来反而误导，返回 null 不显示。 */
export const contractRemaining = (
  contract: PaymentRequestDetail["contract"]
): number | null => {
  if (!contract || !(contract.total_amount > 0)) return null;
  return contract.total_amount - contract.paid_amount;
};

/** 登记付款时只填日期，这种值不能按时间点换算成「08:00:00」。 */
export const isDateOnly = (value: string | null | undefined): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

/** 收款人列表只含启用的；当前收款人被停用时也要能显示名字，不能露出内部 id。 */
export const mergeCurrentPayee = (
  payees: Payee[],
  detail: Pick<PaymentRequestDetail, "payee_id" | "payee"> | null
): Array<Pick<Payee, "id" | "name" | "bank_name" | "bank_account">> => {
  if (!detail?.payee || payees.some(item => item.id === detail.payee_id)) {
    return payees;
  }
  return [{ id: detail.payee_id, ...detail.payee }, ...payees];
};

export const PAYMENT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "prepayment", label: "预付款" },
  { value: "progress", label: "进度款" },
  { value: "settlement", label: "结算款" },
  { value: "特殊审批", label: "特殊审批" },
  { value: "行政费", label: "行政费" },
  { value: "劳务费", label: "劳务费" },
  { value: "机械费", label: "机械费" },
  { value: "材料费", label: "材料费" },
  { value: "其他费用", label: "其他费用" }
];

export const PAYMENT_METHOD_OPTIONS: readonly string[] = [
  "对公转账",
  "转账",
  "现金",
  "票据",
  "其他"
];
