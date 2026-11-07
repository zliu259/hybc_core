import type { Env } from "../../types/env";

// 报销识别流程共用的小工具：解析任务结果、归一化发票字段、判断识别表是否存在。

export const UNASSIGNED_APPLICANT = "__UNASSIGNED__";

export const parseTaskResult = (resultJson: string | null): Record<string, unknown> | null => {
  if (!resultJson) {
    return null;
  }

  try {
    const raw = JSON.parse(resultJson) as { output?: string } & Record<string, unknown>;
    if (typeof raw.output === "string") {
      try {
        return JSON.parse(raw.output) as Record<string, unknown>;
      } catch {
        return { output: raw.output };
      }
    }
    return raw;
  } catch {
    return null;
  }
};

const extractInvoiceUniqueNo = (payload: Record<string, unknown> | null): string | null => {
  if (!payload) return null;
  const candidates = [payload.invoice_unique_no, payload.invoice_number, payload.fphm, payload.invoice_no];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized) return normalized;
    }
  }
  return null;
};

export const parseStoredJson = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const normalizeHintValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

export const extractInvoiceRecognitionHints = (payload: Record<string, unknown> | null) => {
  return {
    invoice_unique_no: extractInvoiceUniqueNo(payload),
    invoice_no:
      normalizeHintValue(payload?.invoice_no) ?? normalizeHintValue(payload?.invoice_number),
    expense_date:
      normalizeHintValue(payload?.issue_date) ?? normalizeHintValue(payload?.date),
    result_json: payload ? JSON.stringify(payload) : null
  };
};

export const normalizeInvoiceNo = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, "").trim();
  return normalized || null;
};

export const normalizeInvoiceDate = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const digits = cleaned.replace(/[^0-9]/g, "");
  if (/^\d{8}$/.test(digits)) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
};

export const toAmountValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const parseQrInvoiceHints = (qrText: string | null): {
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_unique_no: string | null;
  amount: number | null;
} => {
  if (!qrText) {
    return { invoice_no: null, invoice_date: null, invoice_unique_no: null, amount: null };
  }
  const compact = qrText.trim();
  const lower = compact.toLowerCase();

  const params = new URLSearchParams(lower.includes("?") ? lower.split("?").slice(1).join("?") : "");
  const queryInvoiceNo = normalizeInvoiceNo(params.get("invoice_no") || params.get("invoiceNumber"));
  const queryDate = normalizeInvoiceDate(params.get("invoice_date") || params.get("date"));
  const queryAmount = toAmountValue(params.get("amount") || params.get("total"));

  const tokens = compact.split(/[，,;；\s]+/).filter(Boolean);
  let tokenInvoiceNo: string | null = null;
  let tokenDate: string | null = null;
  let tokenAmount: number | null = null;
  let tokenUniqueNo: string | null = null;

  for (const token of tokens) {
    if (!tokenInvoiceNo && /^\d{8}$/.test(token)) {
      tokenInvoiceNo = token;
    }
    if (!tokenDate) {
      const parsedDate = normalizeInvoiceDate(token);
      if (parsedDate) tokenDate = parsedDate;
    }
    if (tokenAmount === null) {
      const parsedAmount = toAmountValue(token);
      if (parsedAmount !== null && parsedAmount > 0) tokenAmount = parsedAmount;
    }
    if (!tokenUniqueNo && /^\d{10,20}$/.test(token)) {
      tokenUniqueNo = token;
    }
  }

  return {
    invoice_no: queryInvoiceNo ?? tokenInvoiceNo,
    invoice_date: queryDate ?? tokenDate,
    invoice_unique_no: tokenUniqueNo,
    amount: queryAmount ?? tokenAmount
  };
};

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
};

export const isMissingInvoiceReviewTableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("no such table") && message.includes("reimbursement_invoice_review");
};

export const supportsInvoiceReviewTable = async (env: Env): Promise<boolean> => {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reimbursement_invoice_review'"
    ).first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

export type InvoiceReviewRow = {
  id: number;
  attachment_id: number;
  review_round: number;
  task_id: number | null;
  task_status: string;
  extraction_json: string | null;
  qr_text: string | null;
  qr_hash: string | null;
  invoice_unique_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  source: string | null;
  risk_level: string;
  risk_hint: string | null;
};
