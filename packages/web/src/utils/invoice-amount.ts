/**
 * 发票收款口径金额：价税合计（税后）优先，缺失时回退税前金额。
 *
 * 与后端 `receipt-invoice-amount.ts` 的 `invoiceContractAmount`
 * （SQL `COALESCE(amount_with_tax, amount)`）保持一致。实际收款发生在
 * 税后金额上，因此收款登记的展示与可收余额校验都应使用该口径。
 */
export interface InvoiceAmountInput {
  amount: number | null;
  amount_with_tax?: number | null;
}

export function invoiceReceivableAmount(invoice: InvoiceAmountInput): number {
  const withTax = invoice.amount_with_tax;
  if (typeof withTax === "number" && Number.isFinite(withTax)) {
    return withTax;
  }
  return typeof invoice.amount === "number" && Number.isFinite(invoice.amount)
    ? invoice.amount
    : 0;
}
