/**
 * 付款详情页的视图模型。头部、明细沿用审批详情的付款口径，这里只补付款单自己才有的内容：
 * 业务状态、合同余额、付款执行信息。
 */
const {
  buildPaymentView,
  buildRemarkEdits,
  formatBeijingTime,
  withFileSizeText
} = require("./approval-detail-view");
const { formatAmount, toChineseAmount } = require("./amount-cn");
const { parseQueryAttachments } = require("./attachment-open");

const STATUS_VIEWS = {
  draft: ["草稿", "default"],
  pending_approval: ["待审批", "warning"],
  approved: ["已审批", "success"],
  paid: ["已付款", "primary"],
  rejected: ["已拒绝", "danger"],
  cancelled: ["已废止", "default"]
};
const UNKNOWN_STATUS = ["未知", "default"];

const textRow = (label, value) => ({ label, value: value || "-", multiline: false });

const paymentStatusView = (status) =>
  Object.prototype.hasOwnProperty.call(STATUS_VIEWS, status) ? STATUS_VIEWS[status] : UNKNOWN_STATUS;

/** 合同已付和总额都有意义时才算余额；单价合同总额可能是 0，算出来反而误导 */
const balanceRows = (contract) => {
  const total = Number(contract && contract.total_amount);
  if (!Number.isFinite(total) || total <= 0) return [];
  const paid = Number(contract.paid_amount) || 0;
  return [
    textRow(
      "剩余额度",
      `${formatAmount(total - paid)} 元（合同 ${formatAmount(total)}，已付 ${formatAmount(paid)}）`
    )
  ];
};

/** Web 登记付款时只填日期，这种值不能按时间点换算成「08:00:00」 */
const formatPaidAt = (value) => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : formatBeijingTime(value);
};

const buildPayout = (payment, user) => {
  if (payment.paid_at) {
    return {
      payoutRows: [
        textRow("支付日期", formatPaidAt(payment.paid_at)),
        textRow("支付流水号", payment.payment_reference),
        textRow("经办人", payment.paid_by_userid ? user(payment.paid_by_userid) : "")
      ],
      payoutNote: ""
    };
  }
  return {
    payoutRows: [],
    payoutNote: payment.status === "approved" ? "审批已通过，等待出纳付款。" : ""
  };
};

/**
 * @param {object} params
 * @param {object} params.payment GET /payment/:id 的返回，带 contract、payee、project、payment_entity
 * @param {Record<string, string>} params.userNames userid → 姓名
 */
const buildPaymentDetailView = ({ payment, userNames }) => {
  const user = (id) => (id && userNames[id]) || "未匹配";
  const project = payment.project || {};
  const entity = payment.payment_entity || {};
  const base = buildPaymentView(payment, {
    user,
    project: () => project.project_name || project.project_code || "未匹配",
    entity: () => entity.entity_name || "未匹配",
    formatTime: formatBeijingTime
  });
  const [statusText, statusTheme] = paymentStatusView(payment.status);
  const amountText = formatAmount(payment.amount);

  return {
    id: payment.id,
    serialNo: payment.serial_no || "-",
    statusText,
    statusTheme,
    isLegacy: Boolean(payment.legacy_data_id),
    title: payment.content || "-",
    amountLabel: base.amountLabel,
    amountText,
    amountCn: amountText === "-" ? "-" : toChineseAmount(payment.amount),
    facts: [...base.keyFacts, { label: "申请人", value: user(payment.applicant_userid) }],
    rows: [
      ...base.rows.flatMap((item) =>
        item.label === "关联合同" ? [item, ...balanceRows(payment.contract)] : [item]
      ),
      textRow("创建时间", formatBeijingTime(payment.created_at)),
      textRow("更新时间", formatBeijingTime(payment.updated_at))
    ],
    remarkEdits: buildRemarkEdits(base.edits, { user, formatTime: formatBeijingTime }),
    ...buildPayout(payment, user),
    approvalInstanceId: Number(payment.approval_instance_id) || 0,
    contractId: Number(payment.contract_id) || 0,
    attachments: withFileSizeText(parseQueryAttachments(payment.attachments_json))
  };
};

module.exports = { buildPaymentDetailView, paymentStatusView };
