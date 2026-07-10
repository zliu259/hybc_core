const E_INVOICE_NUMBER_PATTERN = /^\d{20}$/;

export const isElectronicInvoiceNumber = (value: unknown): boolean =>
  typeof value === "string" && E_INVOICE_NUMBER_PATTERN.test(value.trim());

export type EInvoiceDetectionInput = {
  channel: string;
  ocrResultJson: string | null;
  invoiceUniqueNoHint?: string | null;
};

export type EInvoiceDetectionResult = {
  detected: boolean;
  matchedNumbers: string[];
};

export const detectEInvoiceInPhysical = (
  input: EInvoiceDetectionInput
): EInvoiceDetectionResult => {
  if (input.channel !== "physical") {
    return { detected: false, matchedNumbers: [] };
  }

  const matched = new Set<string>();

  if (isElectronicInvoiceNumber(input.invoiceUniqueNoHint)) {
    matched.add(String(input.invoiceUniqueNoHint).trim());
  }

  if (input.ocrResultJson) {
    try {
      const parsed = JSON.parse(input.ocrResultJson) as Record<string, unknown>;
      const invoices = Array.isArray(parsed.extracted_invoices)
        ? (parsed.extracted_invoices as Record<string, unknown>[])
        : [];
      for (const invoice of invoices) {
        for (const candidate of [invoice.invoice_unique_no, invoice.invoice_no]) {
          if (isElectronicInvoiceNumber(candidate)) {
            matched.add(String(candidate).trim());
          }
        }
      }
    } catch {
      // 非法 JSON 视为无信号，不阻断
    }
  }

  return { detected: matched.size > 0, matchedNumbers: [...matched] };
};
