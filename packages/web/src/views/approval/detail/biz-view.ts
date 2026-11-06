import type { ApprovalInstance } from "@/api/approval";
import type { AmountChangeDetail, ContractDetail } from "@/api/contract";
import type { PaymentRequestDetail } from "@/api/payment";
import type { InvoiceRequest, ReceiptRefundDetail } from "@/api/receipt";
import type { ReimbursementBatchDetail } from "@/api/reimbursement";
import { formatBeijingDateTime } from "@/utils/datetime";
import { describeAmountChangeDelta } from "../amount-change-view";
import { toBizTypeLabel, toStatusLabel } from "../labels";
import {
  formatAmount,
  formatAmountWithUpper,
  parseJsonObject,
  splitRemark,
  toContractDirectionLabel,
  toContractDirectionTagType,
  toInvoiceTypeLabel,
  toPaymentCategoryLabel,
  toPaymentMethodLabel
} from "./formatters";
import type { DetailRow, HeroModel, LabelContext } from "./types";

export type BizRecords = {
  payment: PaymentRequestDetail | null;
  contract: ContractDetail | null;
  amountChange: AmountChangeDetail | null;
  reimbursementBatch: ReimbursementBatchDetail | null;
  invoiceRequest: InvoiceRequest | null;
  invoiceContract: ContractDetail | null;
  receiptRefund: ReceiptRefundDetail | null;
};

export type BizView = {
  hero: HeroModel;
  /** 明细区标题 */
  detailTitle: string;
  rows: DetailRow[];
};

/** 支付方案可以后补，没选的时候要说清楚，不能显示成短横线让人以为没这一项。 */
const NOT_SPECIFIED = "尚未指定";

const contractLink = (id: number | null | undefined) =>
  id ? `/finance/contract/detail/${id}` : null;

const commonFacts = (
  instance: ApprovalInstance,
  ctx: LabelContext
): DetailRow[] => [
  { label: "发起人", value: ctx.user(instance.initiator_userid) },
  { label: "提交于", value: formatBeijingDateTime(instance.submitted_at) },
  ...(instance.completed_at
    ? [
        {
          label: "完成于",
          value: formatBeijingDateTime(instance.completed_at)
        }
      ]
    : [])
];

/** 发单台等来源的摘要带系统前缀，与事由不同才值得单独列一行。 */
const summaryRow = (instance: ApprovalInstance, title: string): DetailRow[] =>
  instance.biz_summary && instance.biz_summary !== title
    ? [{ label: "审批摘要", value: instance.biz_summary, wide: true }]
    : [];

const buildPaymentView = (
  instance: ApprovalInstance,
  payment: PaymentRequestDetail,
  ctx: LabelContext
): BizView => {
  const title = payment.content || instance.biz_summary;
  const remark = splitRemark(payment.remark).text;
  return {
    hero: {
      amount: payment.amount,
      amountLabel: "申请金额",
      title,
      bizNo: payment.serial_no,
      bizNoTo: ctx.canOpenFinance
        ? `/finance/payment/detail/${payment.id}`
        : null,
      facts: [
        {
          label: "付款单位",
          value: payment.payment_entity_id
            ? ctx.entity(payment.payment_entity_id)
            : NOT_SPECIFIED
        },
        { label: "收款方", value: payment.payee?.name || "-" },
        { label: "所属项目", value: ctx.project(payment.project_id) },
        ...commonFacts(instance, ctx)
      ]
    },
    detailTitle: "付款明细",
    rows: [
      {
        label: "关联合同",
        value:
          payment.contract && payment.contract_id
            ? `${payment.contract.contract_no} - ${payment.contract.counterparty}`
            : "无合同 / 无需合同",
        to: payment.contract ? contractLink(payment.contract_id) : null
      },
      {
        label: "付款类别",
        value: toPaymentCategoryLabel(payment.category)
      },
      {
        label: "收款账号",
        value: payment.payee
          ? `${payment.payee.bank_name} / ${payment.payee.bank_account}`
          : "-",
        wide: true
      },
      {
        label: "付款账户",
        value: payment.payment_account || NOT_SPECIFIED,
        wide: true
      },
      { label: "预计付款日", value: payment.expected_payment_date },
      {
        label: "付款方式",
        value: toPaymentMethodLabel(payment.payment_method)
      },
      { label: "备注", value: remark || "-", wide: true, multiline: true },
      ...summaryRow(instance, title)
    ]
  };
};

const buildContractView = (
  instance: ApprovalInstance,
  contract: ContractDetail,
  ctx: LabelContext
): BizView => {
  const title = `${contract.counterparty} · ${contract.contract_type}`;
  return {
    hero: {
      amount: contract.total_amount,
      amountLabel: "合同金额",
      title,
      bizNo: contract.contract_no,
      bizNoTo: ctx.canOpenFinance ? contractLink(contract.id) : null,
      facts: [
        { label: "我方主体", value: ctx.entity(contract.entity_id) },
        { label: "所属项目", value: ctx.project(contract.project_id) },
        ...commonFacts(instance, ctx)
      ]
    },
    detailTitle: "合同明细",
    rows: [
      {
        label: "方向",
        tag: {
          text: toContractDirectionLabel(contract.direction),
          type: toContractDirectionTagType(contract.direction)
        }
      },
      { label: "对方单位", value: contract.counterparty },
      { label: "合同类型", value: contract.contract_type },
      { label: "经办人", value: ctx.user(contract.handler_userid) },
      { label: "合同日期", value: contract.contract_date },
      { label: "已付金额", value: formatAmount(contract.paid_amount) },
      { label: "备注", value: contract.remark || "-", wide: true },
      ...summaryRow(instance, title)
    ]
  };
};

const buildAmountChangeView = (
  instance: ApprovalInstance,
  change: AmountChangeDetail,
  ctx: LabelContext
): BizView => {
  const contract = change.contract;
  const delta = describeAmountChangeDelta(change.old_amount, change.new_amount);
  // 付款合同看已付，收款合同看已收：与后端金额下限口径一致
  const settled =
    contract?.direction === "inbound"
      ? { label: "已收金额", amount: contract.received_amount }
      : { label: "已付金额", amount: contract?.paid_amount };
  const title = contract
    ? `${contract.counterparty} 合同金额变更`
    : instance.biz_summary;
  return {
    hero: {
      amount: change.new_amount,
      amountLabel: "新合同金额",
      title,
      bizNo: contract?.contract_no ?? String(instance.biz_id),
      bizNoTo: ctx.canOpenFinance ? contractLink(change.contract_id) : null,
      facts: [
        {
          label: "所属项目",
          value: contract ? ctx.project(contract.project_id) : "-"
        },
        ...commonFacts(instance, ctx)
      ]
    },
    detailTitle: "变更明细",
    rows: [
      {
        label: "原合同金额",
        value: formatAmountWithUpper(change.old_amount),
        wide: true
      },
      {
        label: "变更差额",
        tag: {
          text: delta.label,
          type:
            delta.kind === "increase"
              ? "danger"
              : delta.kind === "decrease"
                ? "success"
                : "info"
        }
      },
      { label: settled.label, value: formatAmount(settled.amount) },
      {
        label: "方向",
        tag: contract
          ? {
              text: toContractDirectionLabel(contract.direction),
              type: toContractDirectionTagType(contract.direction)
            }
          : null,
        value: contract ? undefined : "-"
      },
      { label: "申请人", value: ctx.user(change.applicant_userid) },
      {
        label: "申请时间",
        value: formatBeijingDateTime(change.created_at)
      },
      {
        label: "变更缘由",
        value: change.reason || "-",
        wide: true,
        multiline: true
      }
    ]
  };
};

const buildReimbursementView = (
  instance: ApprovalInstance,
  batch: ReimbursementBatchDetail,
  ctx: LabelContext
): BizView => ({
  hero: {
    amount: batch.total_amount,
    amountLabel: "报销总额",
    title: `${ctx.user(batch.applicant_userid)} 的报销（${batch.item_count} 张单据）`,
    bizNo: batch.batch_no,
    bizNoTo: ctx.canOpenFinance
      ? `/finance/reimbursement/batch/${batch.id}`
      : null,
    facts: [
      {
        label: "付款单位",
        value:
          batch.payment_entity?.entity_name ||
          (batch.payment_entity_id
            ? ctx.entity(batch.payment_entity_id)
            : NOT_SPECIFIED)
      },
      { label: "所属项目", value: ctx.project(batch.project_id) },
      ...commonFacts(instance, ctx)
    ]
  },
  detailTitle: "报销明细",
  rows: [
    { label: "批次状态", value: toStatusLabel(batch.status) },
    { label: "支付方式", value: toPaymentMethodLabel(batch.payment_method) },
    {
      label: "付款账户",
      value: batch.payment_account || NOT_SPECIFIED,
      wide: true
    },
    ...summaryRow(instance, "")
  ]
});

const buildInvoiceView = (
  instance: ApprovalInstance,
  invoice: InvoiceRequest,
  linked: ContractDetail | null,
  ctx: LabelContext
): BizView => {
  const buyer = parseJsonObject(invoice.buyer_json);
  const contractNo = invoice.business_contract_no || linked?.contract_no || "-";
  return {
    hero: {
      amount: invoice.amount_with_tax,
      amountLabel: "价税合计",
      title: `开票给 ${invoice.customer_name}`,
      bizNo: invoice.request_no,
      bizNoTo: ctx.canOpenFinance
        ? {
            path: "/finance/receipt/invoice",
            query: { keyword: invoice.request_no }
          }
        : null,
      facts: [
        { label: "所属项目", value: ctx.project(invoice.project_id) },
        ...commonFacts(instance, ctx)
      ]
    },
    detailTitle: "开票明细",
    rows: [
      { label: "申请状态", value: toStatusLabel(invoice.status) },
      { label: "对方税号", value: invoice.customer_tax_no },
      {
        label: "对方联系方式",
        value: (buyer.counterparty_contact as string | undefined) || "-"
      },
      {
        label: "我方开票主体",
        value: (buyer.seller_entity_name as string | undefined) || "-"
      },
      {
        label: "关联合同",
        value: linked
          ? `${contractNo}（${toContractDirectionLabel(linked.direction)}）`
          : contractNo,
        to: contractLink(invoice.contract_id)
      },
      {
        label: "发票类型",
        value: toInvoiceTypeLabel(invoice.invoice_type)
      },
      {
        label: "发票类目",
        value: invoice.invoice_category?.trim() || "-"
      },
      { label: "税率", value: `${invoice.tax_rate}%` },
      { label: "币种", value: invoice.currency },
      {
        label: "不含税金额",
        value: formatAmount(invoice.amount_without_tax)
      },
      {
        label: "预计税额",
        value: formatAmount(invoice.tax_amount_estimated)
      },
      { label: "汇款凭证", value: invoice.payment_reference || "-" },
      { label: "备注", value: invoice.remark || "-", wide: true }
    ]
  };
};

const buildRefundView = (
  instance: ApprovalInstance,
  refund: ReceiptRefundDetail,
  ctx: LabelContext
): BizView => {
  const invoiceAmount =
    refund.invoice?.amount_with_tax ?? refund.invoice?.amount ?? null;
  return {
    hero: {
      amount: refund.amount,
      amountLabel: "退款金额",
      title: `退款给 ${refund.contract.counterparty}`,
      bizNo: refund.refund_no,
      bizNoTo: ctx.canOpenFinance
        ? `/finance/receipt/detail/${refund.receipt.id}`
        : null,
      facts: commonFacts(instance, ctx)
    },
    detailTitle: "退款明细",
    rows: [
      {
        label: "退款方式",
        value: refund.refund_mode === "full" ? "全部退款" : "部分退款"
      },
      { label: "收款单号", value: refund.receipt.receipt_no },
      { label: "收款日期", value: refund.receipt.received_date },
      { label: "收款金额", value: formatAmount(refund.receipt.amount) },
      {
        label: "收款账户",
        value: refund.receipt.payment_account || "-",
        wide: true
      },
      { label: "合同号", value: refund.contract.contract_no },
      {
        label: "合同金额",
        value: formatAmount(refund.contract.total_amount)
      },
      {
        label: "合同已收",
        value: formatAmount(refund.contract.received_amount)
      },
      {
        label: "是否含发票",
        value: refund.invoice ? "是（流程含红冲发票签发）" : "否"
      },
      ...(refund.invoice
        ? [
            { label: "发票号", value: refund.invoice.invoice_no || "-" },
            { label: "发票金额", value: formatAmount(invoiceAmount) }
          ]
        : []),
      { label: "退款原因", value: refund.reason || "-", wide: true },
      { label: "备注", value: refund.remark || "-", wide: true }
    ]
  };
};

/** 业务详情还没回来（或该业务类型没有专门视图）时的兜底：先把已知信息显示出来。 */
const buildFallbackView = (
  instance: ApprovalInstance,
  ctx: LabelContext
): BizView => ({
  hero: {
    amount: null,
    amountLabel: "",
    title: instance.biz_summary,
    bizNo: String(instance.biz_id),
    bizNoTo: null,
    facts: commonFacts(instance, ctx)
  },
  detailTitle: "申请明细",
  rows: []
});

/** 把各业务的详情统一成「头部 + 明细行」，页面模板不再按业务类型分支。 */
export const buildBizView = (
  instance: ApprovalInstance,
  records: BizRecords,
  ctx: LabelContext
): BizView => {
  if (records.payment) {
    return buildPaymentView(instance, records.payment, ctx);
  }
  if (records.contract) {
    return buildContractView(instance, records.contract, ctx);
  }
  if (records.amountChange) {
    return buildAmountChangeView(instance, records.amountChange, ctx);
  }
  if (records.reimbursementBatch) {
    return buildReimbursementView(instance, records.reimbursementBatch, ctx);
  }
  if (records.invoiceRequest) {
    return buildInvoiceView(
      instance,
      records.invoiceRequest,
      records.invoiceContract,
      ctx
    );
  }
  if (records.receiptRefund) {
    return buildRefundView(instance, records.receiptRefund, ctx);
  }
  return buildFallbackView(instance, ctx);
};

export const bizTypeTitle = (bizType: string): string =>
  toBizTypeLabel(bizType);
