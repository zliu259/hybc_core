/**
 * 审批详情页的决策规则：意见校验、可用动作、底部栏形态、支付方案改动判断、下一条待办。
 * 不碰 wx，页面只负责调接口和 setData，规则放这里才测得到。
 */

const QUICK_COMMENTS = ["同意", "情况属实", "请补充材料", "金额需再核对"];

const REASON_REQUIRED_TEXT = {
  reject: "驳回需要写明原因",
  return: "退回需要写明原因"
};

/**
 * 通过时意见可空（记为「同意」），驳回、退回必须写明原因。
 * @param {string} action approve | reject | return
 * @param {unknown} raw 输入框原文
 * @returns {{ ok: boolean, comment: string, error: string }}
 */
const validateDecisionComment = (action, raw) => {
  const comment = typeof raw === "string" ? raw.trim() : "";
  if (action === "approve") return { ok: true, comment: comment || "同意", error: "" };
  if (!comment && Object.prototype.hasOwnProperty.call(REASON_REQUIRED_TEXT, action)) {
    return { ok: false, comment: "", error: REASON_REQUIRED_TEXT[action] };
  }
  return { ok: true, comment, error: "" };
};

/**
 * 需要二次确认的动作文案；通过、退回返回 null。
 * confirmText 不能超过 4 个字，否则 wx.showModal 调用失败。
 */
const buildConfirmCopy = (action, { isSuperAdmin = false } = {}) => {
  if (action === "reject") {
    return {
      title: "确定驳回这笔审批？",
      content: "驳回后流程结束，发起人需要重新发起申请。",
      confirmText: "确定驳回"
    };
  }
  if (action === "withdraw") {
    return { title: "确定撤回？", content: "撤回后这笔审批不再继续流转。", confirmText: "确定撤回" };
  }
  if (action === "cancel") {
    return {
      title: isSuperAdmin ? "确定终止流程？" : "确定取消审批？",
      content: "流程会立即结束，且不能恢复。",
      confirmText: isSuperAdmin ? "确定终止" : "确定取消"
    };
  }
  return null;
};

const ACTIVE_STATUSES = ["pending", "in_progress"];
const DEFAULT_DECISION_ACTIONS = ["approve", "reject", "return_initiator", "transfer"];
const DECISION_ACTIONS = [...DEFAULT_DECISION_ACTIONS, "return_prev", "return_to"];
const NO_ACTIONS = {
  availableActions: [],
  hasAnyAction: false,
  canApprove: false,
  canReject: false,
  canReturn: false,
  canTransfer: false,
  manageActions: [],
  moreActions: []
};

/** 当前节点上有没有我的待办；待办在旧节点时不能审批 */
const hasCurrentNodeTask = (detail, userId) => {
  if (!userId) return false;
  const instance = detail.instance || {};
  const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
  const nodes = Array.isArray(detail.nodes) ? detail.nodes : [];
  const round = Number(instance.current_round || 0);
  const nodeKey = String(instance.current_node_key || "");
  const currentNode = nodes.find(
    (node) => node && Number(node.round || 0) === round && String(node.node_key || "") === nodeKey
  );
  return tasks.some(
    (task) =>
      task &&
      task.status === "pending" &&
      task.assignee_userid === userId &&
      (!round || Number(task.round || 0) === round) &&
      (!currentNode || Number(task.node_instance_id || 0) === Number(currentNode.id || 0))
  );
};

/**
 * @param {object} params
 * @param {object} params.detail 审批详情接口的 data
 * @param {string} params.userId 当前用户
 * @param {boolean} [params.isSuperAdmin]
 * @param {boolean} [params.readOnly] 只读视图关闭审批动作
 * @param {boolean} [params.allowManageInReadOnly] 从「我发起的」进入的只读视图保留撤回、取消
 */
const resolveActions = ({ detail, userId, isSuperAdmin = false, readOnly = false, allowManageInReadOnly = false }) => {
  const status = detail && detail.instance ? detail.instance.status : "";
  if (ACTIVE_STATUSES.indexOf(status) < 0) return NO_ACTIONS;

  const explicit = Array.isArray(detail.available_actions)
    ? detail.available_actions.filter((item) => typeof item === "string")
    : [];
  const explicitDecision = explicit.filter((item) => DECISION_ACTIONS.indexOf(item) >= 0);
  const decision =
    !readOnly && hasCurrentNodeTask(detail, userId)
      ? explicitDecision.length > 0
        ? explicitDecision
        : DEFAULT_DECISION_ACTIONS
      : [];
  const has = (action) => decision.indexOf(action) >= 0;

  const manageActions =
    readOnly && !allowManageInReadOnly
      ? []
      : [
          { action: "withdraw", label: "撤回" },
          { action: "cancel", label: isSuperAdmin ? "终止流程" : "取消审批" }
        ].filter((item) => explicit.indexOf(item.action) >= 0);

  const canTransfer = has("transfer");
  return {
    availableActions: [...decision, ...manageActions.map((item) => item.action)],
    hasAnyAction: decision.length > 0,
    canApprove: has("approve"),
    canReject: has("reject"),
    canReturn: has("return_initiator") || has("return_prev") || has("return_to"),
    canTransfer,
    manageActions,
    moreActions: [
      ...(canTransfer ? [{ action: "transfer", label: "转办给其他人" }] : []),
      ...manageActions
    ]
  };
};

/** 底部栏只有一种形态：decide 决策 / manage 撤回取消 / edit 退回后编辑 / acted 已处理提示 */
const resolveFooterMode = ({
  hasAnyAction,
  manageActions,
  canEditReturnedBusiness,
  userAlreadyActed,
  readOnly = false
}) => {
  if (hasAnyAction) return "decide";
  if (manageActions && manageActions.length > 0) return "manage";
  if (canEditReturnedBusiness) return "edit";
  if (userAlreadyActed && !readOnly) return "acted";
  return "";
};

/** 支付方案选择器当前值的快照，用来和进页面时的基线比较 */
const toPayoutSnapshot = ({ paymentEntity, paymentAccount, paymentMethod }) => ({
  entityId: Number((paymentEntity && paymentEntity.id) || 0),
  accountId: Number((paymentAccount && paymentAccount.id) || 0),
  method: paymentMethod || ""
});

/**
 * 没改过就不提交：否则每次审批都往备注写一条「超管修改」日志。
 * 基线为空说明选择器还没同步完，此时的值不完整，不算改动。
 */
const isPayoutDirty = (baseline, current) => {
  if (!baseline || !current) return false;
  return (
    Number(baseline.entityId || 0) !== Number(current.entityId || 0) ||
    Number(baseline.accountId || 0) !== Number(current.accountId || 0) ||
    String(baseline.method || "") !== String(current.method || "")
  );
};

const PAYMENT_METHOD_VALUES = {
  bank_transfer: "transfer",
  transfer: "transfer",
  对公转账: "transfer",
  personal_transfer: "personal_transfer",
  转账: "personal_transfer",
  cash: "cash",
  现金: "cash",
  bill: "bill",
  票据: "bill",
  other: "other",
  其他: "other"
};

const normalizePaymentMethodValue = (value) => {
  const raw = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_VALUES, raw) ? PAYMENT_METHOD_VALUES[raw] : "";
};

const buildPayoutPayload = ({ paymentEntity, paymentAccount, paymentMethod }) => ({
  ...(paymentEntity && paymentEntity.id ? { payment_entity_id: Number(paymentEntity.id) } : {}),
  ...(paymentAccount && paymentAccount.id
    ? {
        payment_entity_id: Number((paymentEntity && paymentEntity.id) || paymentAccount.entity_id),
        payment_entity_bank_account_id: Number(paymentAccount.id),
        payment_account: `${paymentAccount.bank_name} / ${paymentAccount.account_no}`
      }
    : {}),
  ...(paymentMethod ? { payment_method: paymentMethod } : {})
});

const buildPayoutSummary = ({ methodLabel, entityLabel, accountLabel }) =>
  [methodLabel, entityLabel, accountLabel].filter(Boolean).join("，") || "尚未选择";

/**
 * @param {Array<{ id?: unknown } | null>} rows 待办列表
 * @param {number} currentId 刚处理完的审批
 * @returns {number} 下一条的 id，没有返回 0
 */
const pickNextPending = (rows, currentId) => {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i += 1) {
    const id = Number(list[i] && list[i].id);
    if (Number.isInteger(id) && id > 0 && id !== Number(currentId)) return id;
  }
  return 0;
};

/**
 * @param {string} doneText 如「已通过」
 * @param {{ nextId: number, pendingCount: number | null }} state pendingCount 为 null 表示列表没取到
 * @returns {string} 只有确认列表为空才说处理完了
 */
const nextPendingToast = (doneText, { nextId, pendingCount }) => {
  if (nextId) return `${doneText}，打开下一条`;
  return pendingCount === 0 ? `${doneText}，待办已处理完` : doneText;
};

module.exports = {
  QUICK_COMMENTS,
  validateDecisionComment,
  buildConfirmCopy,
  resolveActions,
  resolveFooterMode,
  toPayoutSnapshot,
  isPayoutDirty,
  normalizePaymentMethodValue,
  buildPayoutPayload,
  buildPayoutSummary,
  pickNextPending,
  nextPendingToast
};
