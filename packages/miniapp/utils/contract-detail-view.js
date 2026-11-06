/**
 * 合同详情页的视图模型。头部、明细沿用审批详情的合同口径，这里补合同自己才有的内容：
 * 业务状态、付款或开票到账进度、金额变更、关联付款和收款。
 */
const {
  buildContractView,
  buildRemarkEdits,
  formatBeijingTime,
  withFileSizeText
} = require("./approval-detail-view");
const { formatAmount, toChineseAmount } = require("./amount-cn");
const { parseQueryAttachments } = require("./attachment-open");
const { amountChangeTypeLabel } = require("./enum-labels");
const { paymentStatusView } = require("./payment-detail-view");

const lookup = (table, key, fallback) =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;

const CONTRACT_STATUS_VIEWS = {
  draft: ["草稿", "default"],
  pending_review: ["待审查", "warning"],
  pending_approval: ["待审批", "warning"],
  active: ["生效中", "success"],
  completed: ["已完成", "primary"],
  terminated: ["已终止", "danger"]
};

const AMOUNT_CHANGE_STATUS_VIEWS = {
  approved: ["已通过", "success"],
  rejected: ["已驳回", "danger"],
  cancelled: ["已取消", "default"]
};

const RECEIPT_STATUS_VIEWS = {
  recorded: ["已登记", "success"],
  partial_refunded: ["部分退款", "warning"],
  refunded: ["已退款", "default"],
  reversed: ["已冲销", "default"],
  deleted: ["已删除", "default"]
};

const UNKNOWN = ["未知", "default"];
/** 明细里不再重复显示的行：进度已在头部 */
const PROGRESS_ROW_LABELS = ["已付金额", "已收金额"];
/** 不算有效付款的状态，合计时要排除 */
const VOID_PAYMENT_STATUSES = ["cancelled", "rejected"];

const asNumber = (value) => Number(value) || 0;

const progressRow = (label, done, total) => {
  const doneAmount = asNumber(done);
  return {
    label,
    doneText: formatAmount(doneAmount),
    totalText: formatAmount(total),
    // 单价合同总额可能是 0，算不出比例，也不能写成 100%
    percent: total > 0 ? Math.min(100, Math.round((doneAmount / total) * 100)) : null,
    over: total > 0 && doneAmount > total
  };
};

const buildProgress = (contract) => {
  const total = asNumber(contract.total_amount);
  if (contract.direction === "inbound") {
    return {
      progress: [
        progressRow("已开票", contract.invoiced_amount, total),
        progressRow("已到账", contract.received_amount, total)
      ],
      remainText: ""
    };
  }
  return {
    progress: [progressRow("已付款", contract.paid_amount, total)],
    remainText: total > 0 ? `剩余 ${formatAmount(total - asNumber(contract.paid_amount))} 元` : ""
  };
};

/** 变更单提交后业务状态一直是 pending，要看审批实例才知道走到哪了 */
const amountChangeStatusView = (row) => {
  if (row.status !== "pending") return lookup(AMOUNT_CHANGE_STATUS_VIEWS, row.status, UNKNOWN);
  if (row.approval_status === "in_progress" || row.approval_status === "pending") return ["审批中", "warning"];
  if (row.approval_status === "returned") return ["已退回", "warning"];
  if (row.approval_status === "withdrawn") return ["已撤回", "default"];
  return ["待提交", "primary"];
};

const buildAmountChanges = (rows, user) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const [statusText, statusTheme] = amountChangeStatusView(row);
    return {
      id: row.id,
      typeText: amountChangeTypeLabel(row.change_type, "调整"),
      amountText: `${formatAmount(row.old_amount)} → ${formatAmount(row.new_amount)}`,
      statusText,
      statusTheme,
      applicantText: user(row.applicant_userid),
      reason: row.reason || "",
      createdAtText: formatBeijingTime(row.created_at),
      attachments: withFileSizeText(Array.isArray(row.attachments) ? row.attachments : [])
    };
  });

const buildPayments = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const effectiveTotal = list
    .filter((row) => VOID_PAYMENT_STATUSES.indexOf(row.status) < 0)
    .reduce((sum, row) => sum + asNumber(row.amount), 0);
  return {
    payments: list.map((row) => {
      const [statusText, statusTheme] = paymentStatusView(row.status);
      return {
        id: row.id,
        serialNo: row.serial_no || "-",
        amountText: formatAmount(row.amount),
        statusText,
        statusTheme,
        createdAtText: formatBeijingTime(row.created_at)
      };
    }),
    paymentSummary: list.length > 0 ? `共 ${list.length} 笔，有效合计 ${formatAmount(effectiveTotal)} 元` : ""
  };
};

/**
 * @param {Array} rows GET /receipt?contract_id= 的结果
 * @param {Record<string, string>} userNames
 */
const buildReceiptRows = (rows, userNames) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const [statusText, statusTheme] = lookup(RECEIPT_STATUS_VIEWS, row.status, UNKNOWN);
    return {
      id: row.id,
      receiptNo: row.receipt_no || "-",
      amountText: formatAmount(row.amount),
      statusText,
      statusTheme,
      receiverText: (row.receiver_userid && userNames[row.receiver_userid]) || "未匹配",
      receivedDate: row.received_date || "-"
    };
  });

/**
 * @param {object} params
 * @param {object} params.contract GET /contract/:id 的返回，带 project、entity、amount_changes、payment_requests
 * @param {Record<string, string>} params.userNames userid → 姓名
 */
const buildContractDetailView = ({ contract, userNames }) => {
  const user = (id) => (id && userNames[id]) || "未匹配";
  const project = contract.project || {};
  const entity = contract.entity || {};
  const base = buildContractView(contract, {
    user,
    project: () => project.project_name || project.project_code || "未匹配",
    entity: () => entity.entity_name || "未匹配",
    formatTime: formatBeijingTime
  });
  const [statusText, statusTheme] = lookup(CONTRACT_STATUS_VIEWS, contract.status, UNKNOWN);
  const amountText = formatAmount(contract.total_amount);
  const isInbound = contract.direction === "inbound";

  return {
    id: contract.id,
    contractNo: contract.contract_no || "-",
    statusText,
    statusTheme,
    isLegacy: Boolean(contract.legacy_data_id),
    isInbound,
    title: base.title,
    amountLabel: base.amountLabel,
    amountText,
    amountCn: amountText === "-" ? "-" : toChineseAmount(contract.total_amount),
    facts: [...base.keyFacts, { label: "经办人", value: user(contract.handler_userid) }],
    rows: [
      ...base.rows.filter(
        (item) => PROGRESS_ROW_LABELS.indexOf(item.label) < 0 && item.label !== "经办人"
      ),
      { label: "创建时间", value: formatBeijingTime(contract.created_at), multiline: false },
      { label: "更新时间", value: formatBeijingTime(contract.updated_at), multiline: false }
    ],
    remarkEdits: buildRemarkEdits(base.edits, { user, formatTime: formatBeijingTime }),
    ...buildProgress(contract),
    amountChanges: buildAmountChanges(contract.amount_changes, user),
    ...buildPayments(isInbound ? [] : contract.payment_requests),
    approvalInstanceId: Number(contract.approval_instance_id) || 0,
    attachments: withFileSizeText(parseQueryAttachments(contract.attachments_json))
  };
};

module.exports = { buildContractDetailView, buildReceiptRows };
