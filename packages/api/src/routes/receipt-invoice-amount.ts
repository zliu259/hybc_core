export type InvoiceContractAmountInput = {
  amount: number | null;
  amount_with_tax?: number | null;
};

export const invoiceContractAmountSql = "COALESCE(amount_with_tax, amount)";

export const invoiceContractAmount = (invoice: InvoiceContractAmountInput) => {
  if (typeof invoice.amount_with_tax === "number" && Number.isFinite(invoice.amount_with_tax)) {
    return invoice.amount_with_tax;
  }
  return typeof invoice.amount === "number" && Number.isFinite(invoice.amount) ? invoice.amount : 0;
};
