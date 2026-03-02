const bizTypeLabelMap: Record<string, string> = {
  outbound_contract: "对外合同审批",
  inbound_contract: "收款合同审批",
  payment_request: "付款审批",
  reimbursement_batch: "报销审批",
  stock_order: "出入库审批",
  contract_amount_change: "合同金额变更"
};

const statusLabelMap: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已取消",
  withdrawn: "已撤回",
  completed: "已完成",
  transferred: "已转签",
  skipped: "已跳过",
  returned: "已退回",
  active: "启用",
  inactive: "停用",
  none: "未执行",
  failed: "失败"
};

const actionLabelMap: Record<string, string> = {
  approve: "通过",
  reject: "驳回",
  transfer: "转签",
  return_initiator: "退回发起人",
  return_prev: "退回上一节点",
  return_to: "退回指定节点",
  withdraw: "撤回",
  cancel: "取消",
  resubmit: "重新提交"
};

export const toBizTypeLabel = (value: string | undefined | null): string => {
  if (!value) return "-";
  return bizTypeLabelMap[value] ?? value;
};

export const toStatusLabel = (value: string | undefined | null): string => {
  if (!value) return "-";
  return statusLabelMap[value] ?? value;
};

export const toActionLabel = (value: string | undefined | null): string => {
  if (!value) return "-";
  return actionLabelMap[value] ?? value;
};
