const E_INVOICE_NUMBER_PATTERN = /^\d{20}$/;

const isElectronicInvoiceNumber = (value: unknown): boolean =>
  typeof value === "string" && E_INVOICE_NUMBER_PATTERN.test(value.trim());

export type EInvoiceDetectionInput = {
  channel?: string | null;
  ocrResultJson?: string | null;
  invoiceUniqueNoHint?: string | null;
};

/** 与 API 端 reimbursement-einvoice-guard 保持一致的检测逻辑（前端展示用） */
export const detectEInvoiceInPhysical = (
  input: EInvoiceDetectionInput
): boolean => {
  if (input.channel !== "physical") return false;
  if (isElectronicInvoiceNumber(input.invoiceUniqueNoHint)) return true;
  if (!input.ocrResultJson) return false;
  try {
    const parsed = JSON.parse(input.ocrResultJson) as {
      extracted_invoices?: {
        invoice_unique_no?: unknown;
        invoice_no?: unknown;
      }[];
    };
    return (parsed.extracted_invoices ?? []).some(
      item =>
        isElectronicInvoiceNumber(item.invoice_unique_no) ||
        isElectronicInvoiceNumber(item.invoice_no)
    );
  } catch {
    return false;
  }
};
