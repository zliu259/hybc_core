import type { ApprovalDetailResponse } from "@/api/approval";
import type { ContractAmountChange, ContractDetail } from "@/api/contract";
import type { AttachmentUploadRoute } from "../shared/format";

type TagType = "primary" | "success" | "warning" | "danger" | "info";

/** PUT /contract/:id、提交审批的角色，与后端 requireRoles 保持一致 */
const WRITE_ROLES = ["super_admin", "manager", "site_manager", "finance"];
/** 触发审查、金额变更的角色 */
const REVIEW_ROLES = ["super_admin", "manager", "finance"];
const DECISION_ACTIONS = [
  "approve",
  "reject",
  "return_prev",
  "return_to",
  "return_initiator"
];
/** 履约已结束的合同，普通角色不再改资料 */
const CLOSED_STATUSES = ["completed", "terminated"];
/** 这些实例状态表示审批还在跑，不能再提交一次 */
const RUNNING_APPROVAL_STATUSES = ["pending", "in_progress"];
/** 不算有效付款的状态，合计时要排除 */
const VOID_PAYMENT_STATUSES = ["cancelled", "rejected"];

export type ContractCapabilities = {
  canEditFields: boolean;
  /** 合同金额：只有草稿能直接改，生效后走金额变更 */
  canEditAmount: boolean;
  canToggleSuperEdit: boolean;
  canSubmit: boolean;
  canTriggerReview: boolean;
  canRequestAmountChange: boolean;
  attachmentUploadVia: AttachmentUploadRoute;
  canRemoveAttachment: boolean;
};

export type ContractCapabilityInput = {
  detail: Pick<ContractDetail, "status" | "approval_instance_id"> | null;
  approvalDetail: Pick<
    ApprovalDetailResponse,
    "instance" | "available_actions"
  > | null;
  roles: readonly string[];
  superEditMode: boolean;
};

const NO_CAPABILITIES: ContractCapabilities = {
  canEditFields: false,
  canEditAmount: false,
  canToggleSuperEdit: false,
  canSubmit: false,
  canTriggerReview: false,
  canRequestAmountChange: false,
  attachmentUploadVia: null,
  canRemoveAttachment: false
};

const hasAnyRole = (roles: readonly string[], allowed: readonly string[]) =>
  roles.some(role => allowed.includes(role));

/**
 * 当前用户在这份合同上能做什么。页面只显示能用的按钮，这里的规则要和后端的
 * 角色、状态校验一致，否则用户点了才报错。
 */
export const resolveContractCapabilities = ({
  detail,
  approvalDetail,
  roles,
  superEditMode
}: ContractCapabilityInput): ContractCapabilities => {
  if (!detail) return NO_CAPABILITIES;
  const { status } = detail;
  const isSuperAdmin = roles.includes("super_admin");
  const canWrite = hasAnyRole(roles, WRITE_ROLES);
  const canReview = hasAnyRole(roles, REVIEW_ROLES);
  const hasInstance = Boolean(detail.approval_instance_id);
  const running =
    status === "pending_approval" ||
    approvalDetail?.instance.status === "in_progress";
  const draftLike =
    (status === "draft" || status === "pending_review") && !running;
  // 走完过审批的合同（退回或驳回后状态回到 draft 的除外）资料锁定
  const finishedLock = hasInstance && status !== "draft" && !running;
  const editableByRule =
    canWrite && !running && !finishedLock && !CLOSED_STATUSES.includes(status);
  const superEdit = isSuperAdmin && superEditMode;
  const canDecide = (approvalDetail?.available_actions ?? []).some(action =>
    DECISION_ACTIONS.includes(action)
  );
  const canEditFields = editableByRule || superEdit;

  const resolveUploadRoute = (): AttachmentUploadRoute => {
    if (superEdit) return "biz";
    if (running) {
      return hasInstance && (canDecide || isSuperAdmin) ? "approval" : null;
    }
    return canWrite ? "biz" : null;
  };

  return {
    canEditFields,
    canEditAmount: (status === "draft" && !running && canWrite) || superEdit,
    canToggleSuperEdit: isSuperAdmin && !editableByRule,
    canSubmit: draftLike && canWrite,
    canTriggerReview: draftLike && canReview,
    canRequestAmountChange: status === "active" && canReview,
    attachmentUploadVia: resolveUploadRoute(),
    canRemoveAttachment: canEditFields
  };
};

export const canSubmitAmountChange = (
  row: Pick<ContractAmountChange, "status" | "approval_status">,
  roles: readonly string[]
): boolean =>
  hasAnyRole(roles, REVIEW_ROLES) &&
  row.status === "pending" &&
  !RUNNING_APPROVAL_STATUSES.includes(row.approval_status ?? "");

/** 变更单提交后业务状态一直是 pending，要看审批实例才知道走到哪了。 */
export const toAmountChangeStatus = (
  row: Pick<ContractAmountChange, "status" | "approval_status">
): { label: string; type: TagType } => {
  if (row.status === "approved") return { label: "已通过", type: "success" };
  if (row.status === "rejected") return { label: "已驳回", type: "danger" };
  if (row.status === "cancelled") return { label: "已取消", type: "info" };
  if (RUNNING_APPROVAL_STATUSES.includes(row.approval_status ?? "")) {
    return { label: "审批中", type: "warning" };
  }
  if (row.approval_status === "returned") {
    return { label: "已退回", type: "warning" };
  }
  if (row.approval_status === "withdrawn") {
    return { label: "已撤回", type: "info" };
  }
  return { label: "待提交", type: "primary" };
};

const AMOUNT_CHANGE_TYPE_LABELS: Record<string, string> = {
  increase: "增加",
  decrease: "减少",
  adjust: "调整"
};

export const toAmountChangeTypeLabel = (value: string): string =>
  AMOUNT_CHANGE_TYPE_LABELS[value] ?? value;

export type ContractProgressRow = {
  label: string;
  done: number;
  total: number;
  /** 总额不大于 0（如单价合同）时算不出比例，为 null，不能显示成 100% */
  percent: number | null;
  over: boolean;
};

const progressRow = (
  label: string,
  done: number,
  total: number
): ContractProgressRow => ({
  label,
  done,
  total,
  percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null,
  over: total > 0 && done > total
});

export const buildContractProgress = (
  detail: Pick<
    ContractDetail,
    | "direction"
    | "total_amount"
    | "paid_amount"
    | "invoiced_amount"
    | "received_amount"
  >
): { rows: ContractProgressRow[]; remaining: number | null } => {
  const total = detail.total_amount;
  if (detail.direction === "inbound") {
    return {
      rows: [
        progressRow("已开票", detail.invoiced_amount, total),
        progressRow("已到账", detail.received_amount, total)
      ],
      remaining: null
    };
  }
  return {
    rows: [progressRow("已付款", detail.paid_amount, total)],
    remaining: total > 0 ? total - detail.paid_amount : null
  };
};

/** 关联付款合计：作废和被拒的付款不算数，否则会比合同已付还多得离谱。 */
export const effectivePaymentTotal = (
  payments: ContractDetail["payment_requests"]
): number =>
  payments
    .filter(item => !VOID_PAYMENT_STATUSES.includes(item.status))
    .reduce((sum, item) => sum + item.amount, 0);

export const CONTRACT_STATUS_TAGS: Record<string, TagType> = {
  draft: "info",
  pending_review: "warning",
  pending_approval: "warning",
  active: "success",
  completed: "primary",
  terminated: "danger"
};

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审查",
  pending_approval: "待审批",
  active: "生效中",
  completed: "已完成",
  terminated: "已终止"
};

const DEFAULT_CONTRACT_TYPES = ["人工", "机械", "总包", "材料", "其他"];

/** 下拉选项里要包含当前值，否则存量的「服务」「租赁」等类型会显示成空白。 */
export const contractTypeOptions = (current: string): string[] =>
  current && !DEFAULT_CONTRACT_TYPES.includes(current)
    ? [...DEFAULT_CONTRACT_TYPES, current]
    : DEFAULT_CONTRACT_TYPES;
