import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { writeAuditLog } from "../services/audit-log";
import { runInTransaction } from "../services/db-transaction";
import { publishEvent } from "../services/event-bus";
import {
  abandonIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest
} from "../services/idempotency";
import { submitForApproval } from "../services/approval/engine";
import { resubmit as resubmitOp } from "../services/approval/operations";
import {
  getExistingApprovalSubmissionDecision,
  isApprovalActive
} from "../services/approval/status";
import { generateSerial } from "../services/serial";
import { canUpdateBatchPayoutPlan } from "./reimbursement-batch-payout-policy";
import { decideCreateRouteBranch } from "./reimbursement-create-policy";
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice-guard";
import { decideSplitEnvelope } from "./reimbursement-split-policy";
import type { Env } from "../types/env";
import { reimbursementChannels, reimbursementStatuses } from "../types/reimbursement";
import type {
  BatchGenerateEnvelopeRequest,
  CreateReimbursementBatchRequest,
  CreateEnvelopeRequest,
  ElectronicUploadRequest,
  EnvelopeAttachment,
  MarkBatchPaidRequest,
  RebindEnvelopeUuidRequest,
  PrecheckEnvelopeRequest,
  ReimbursementBatch,
  ReimbursementDuplicateCheck,
  ReimbursementEnvelope,
  ReimbursementPaymentVoucherInput,
  ScanEnvelopeRequest,
  SplitEnvelopeRequest,
  SubmitEnvelopeRequest,
  SubmitReimbursementBatchApprovalRequest,
  UpdateReimbursementBatchItemBasicInfoRequest,
  UpdateReimbursementBatchPaymentVouchersRequest,
  UpdateReimbursementBatchPayoutPlanRequest,
  UpdateEnvelopeRequest,
  VerifyEnvelopeRequest
} from "../types/reimbursement";

const nowIso = () => new Date().toISOString();
const UNASSIGNED_APPLICANT = "__UNASSIGNED__";
const validChannelSet = new Set<string>(reimbursementChannels);
const reimbursementStatusSet = new Set<string>(reimbursementStatuses);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reimbursementOfficeRoles = ["super_admin", "manager", "site_manager", "finance"];
const isValidUuid = (value: string | null | undefined): boolean => {
  const trimmed = String(value || "").trim();
  return Boolean(trimmed && UUID_REGEX.test(trimmed));
};

/**
 * Sanitize invoice_unique_no: reject descriptive text like "电子发票", "收据", "支出凭证".
 * Only allow values that look like actual invoice numbers (alphanumeric, dashes, dots).
 */
const INVOICE_NO_PATTERN = /^[A-Za-z0-9\-._]{4,}$/;
const sanitizeInvoiceUniqueNo = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!INVOICE_NO_PATTERN.test(trimmed)) return null;
  return trimmed;
};

const parseTaskResult = (resultJson: string | null): Record<string, unknown> | null => {
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

const parseStoredJson = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const normalizeHintValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const extractInvoiceRecognitionHints = (payload: Record<string, unknown> | null) => {
  return {
    invoice_unique_no: extractInvoiceUniqueNo(payload),
    invoice_no:
      normalizeHintValue(payload?.invoice_no) ?? normalizeHintValue(payload?.invoice_number),
    expense_date:
      normalizeHintValue(payload?.issue_date) ?? normalizeHintValue(payload?.date),
    result_json: payload ? JSON.stringify(payload) : null
  };
};

const normalizeInvoiceNo = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, "").trim();
  return normalized || null;
};

const normalizeInvoiceDate = (value: unknown): string | null => {
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

const toAmountValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseQrInvoiceHints = (qrText: string | null): {
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

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
};

const isMissingInvoiceReviewTableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("no such table") && message.includes("reimbursement_invoice_review");
};

const supportsInvoiceReviewTable = async (env: Env): Promise<boolean> => {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reimbursement_invoice_review'"
    ).first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

const hasOfficeRole = (roles: string[] = []) => {
  return roles.some((role) => reimbursementOfficeRoles.includes(role));
};

type ReimbursementPaymentMethod = "transfer" | "personal_transfer" | "cash" | "bill" | "other";

const paymentMethodAliasMap: Record<string, ReimbursementPaymentMethod> = {
  transfer: "transfer",
  bank_transfer: "transfer",
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

const normalizePaymentMethodValue = (
  value: string | null | undefined
): { normalized: ReimbursementPaymentMethod | null; invalid: boolean } => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return { normalized: null, invalid: false };
  }
  const mapped = paymentMethodAliasMap[trimmed];
  if (!mapped) {
    return { normalized: null, invalid: true };
  }
  return { normalized: mapped, invalid: false };
};

const accountToDisplayText = (account: {
  bank_name: string;
  bank_branch_no: string | null;
  account_no: string;
}) => {
  const branch = account.bank_branch_no?.trim();
  return `${account.bank_name}${branch ? `-${branch}` : ""} / ${account.account_no}`;
};

type ReimbursementPayoutPlanInput = {
  payment_method?: string;
  payment_entity_id?: number;
  payment_entity_bank_account_id?: number;
  payment_account?: string;
};

type ReimbursementPayoutPlanResolved = {
  payment_method: ReimbursementPaymentMethod | null;
  payment_entity_id: number | null;
  payment_entity_bank_account_id: number | null;
  payment_account: string | null;
};

const normalizePaymentVoucherInputs = (value: unknown): ReimbursementPaymentVoucherInput[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ReimbursementPaymentVoucherInput | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as {
        file_key?: string;
        file_name?: string;
        file_size?: number;
      };
      if (!row.file_key || !row.file_key.trim()) return null;
      return {
        file_key: row.file_key.trim(),
        file_name: row.file_name?.trim() || undefined,
        file_size: row.file_size
      };
    })
    .filter((item): item is ReimbursementPaymentVoucherInput => Boolean(item));
};

const resolveReimbursementPayoutPlan = async (
  env: Env,
  input: ReimbursementPayoutPlanInput,
  current: ReimbursementPayoutPlanResolved = {
    payment_method: null,
    payment_entity_id: null,
    payment_entity_bank_account_id: null,
    payment_account: null
  }
): Promise<{ value: ReimbursementPayoutPlanResolved } | { error: string }> => {
  let paymentMethod = current.payment_method;
  let paymentEntityId = current.payment_entity_id;
  let paymentEntityBankAccountId = current.payment_entity_bank_account_id;
  let paymentAccount = current.payment_account;
  let bankAccountDisplay: string | null = null;

  if (input.payment_method !== undefined) {
    const normalized = normalizePaymentMethodValue(input.payment_method);
    if (normalized.invalid) {
      return {
        error:
          "payment_method must be one of transfer/personal_transfer/cash/bill/other (or 对公转账/转账/现金/票据/其他)"
      };
    }
    paymentMethod = normalized.normalized;
  }

  if (input.payment_entity_id !== undefined) {
    if (!Number.isInteger(input.payment_entity_id) || input.payment_entity_id <= 0) {
      return { error: "payment_entity_id must be a positive integer" };
    }
    const entity = await env.DB.prepare("SELECT id FROM entity WHERE id = ? AND status = 'active'")
      .bind(input.payment_entity_id)
      .first<{ id: number }>();
    if (!entity) {
      return { error: "payment entity not found or inactive" };
    }
    paymentEntityId = entity.id;
  }

  if (input.payment_entity_bank_account_id !== undefined) {
    if (
      !Number.isInteger(input.payment_entity_bank_account_id) ||
      input.payment_entity_bank_account_id <= 0
    ) {
      return { error: "payment_entity_bank_account_id must be a positive integer" };
    }

    const bankAccount = await env.DB.prepare(
      "SELECT id, entity_id, bank_name, bank_branch_no, account_no FROM entity_bank_account WHERE id = ? AND status = 'active'"
    )
      .bind(input.payment_entity_bank_account_id)
      .first<{
        id: number;
        entity_id: number;
        bank_name: string;
        bank_branch_no: string | null;
        account_no: string;
      }>();

    if (!bankAccount) {
      return { error: "payment bank account not found or inactive" };
    }
    if (paymentEntityId !== null && bankAccount.entity_id !== paymentEntityId) {
      return { error: "payment bank account does not belong to payment entity" };
    }

    paymentEntityBankAccountId = bankAccount.id;
    paymentEntityId = bankAccount.entity_id;
    bankAccountDisplay = accountToDisplayText(bankAccount);
  }

  if (input.payment_account !== undefined) {
    paymentAccount = input.payment_account?.trim() || null;
  } else if (bankAccountDisplay) {
    paymentAccount = bankAccountDisplay;
  }

  return {
    value: {
      payment_method: paymentMethod,
      payment_entity_id: paymentEntityId,
      payment_entity_bank_account_id: paymentEntityBankAccountId,
      payment_account: paymentAccount
    }
  };
};

const assertEnvelopeAccess = async (
  env: Env,
  envelopeId: number,
  auth: { sub: string; roles: string[] }
): Promise<ReimbursementEnvelope | null> => {
  const envelope = await env.DB.prepare(
    "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
  )
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope) return null;
  if (hasOfficeRole(auth.roles) || envelope.applicant_userid === auth.sub) {
    return envelope;
  }
  return null;
};

const filterTaskResultForViewer = (
  auth: { roles: string[] },
  result: Record<string, unknown> | null
) => {
  return hasOfficeRole(auth.roles) ? result : null;
};

const insertAttachments = async (
  db: D1Database,
  envelopeId: number,
  attachments: CreateEnvelopeRequest["attachments"] | UpdateEnvelopeRequest["attachments"]
) => {
  if (!attachments || attachments.length === 0) {
    return;
  }

  const now = nowIso();

  for (const item of attachments) {
    await db.prepare(
      `INSERT INTO envelope_attachment
        (envelope_id, attachment_type, file_key, file_name, file_size, invoice_no, amount, issue_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(
        envelopeId,
        item.attachment_type ?? "invoice",
        item.file_key,
        item.file_name ?? null,
        item.file_size ?? null,
        item.invoice_no ?? null,
        item.amount ?? null,
        item.issue_date ?? null,
        now
      )
      .run();
  }
};

type InvoiceReviewRow = {
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

const createInvoiceReviewTasks = async (
  env: Env,
  envelope: ReimbursementEnvelope,
  attachments: Array<{ id: number; file_key: string; file_name: string | null }>,
  options?: { forceRerun?: boolean }
): Promise<{ round: number; latestTaskId: number | null }> => {
  const latestRoundRow = await env.DB.prepare(
    "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
  )
    .bind(envelope.id)
    .first<{ max_round: number | null }>();
  const latestRound = Number(latestRoundRow?.max_round ?? 0);
  const round = options?.forceRerun ? latestRound + 1 : Math.max(latestRound, 1);
  const now = nowIso();

  const existingRows = await env.DB.prepare(
    `SELECT attachment_id, task_id, task_status
       FROM reimbursement_invoice_review
      WHERE envelope_id = ? AND review_round = ?`
  )
    .bind(envelope.id, round)
    .all<{ attachment_id: number; task_id: number | null; task_status: string }>();
  const existingByAttachment = new Map<number, { task_id: number | null; task_status: string }>();
  for (const row of existingRows.results ?? []) {
    existingByAttachment.set(row.attachment_id, row);
  }

  let latestTaskId: number | null = null;
  for (const attachment of attachments) {
    const existing = existingByAttachment.get(attachment.id);
    if (existing && !options?.forceRerun && ["pending", "assigned", "running", "completed"].includes(existing.task_status)) {
      latestTaskId = existing.task_id ?? latestTaskId;
      continue;
    }

    const task = await createTask(env, {
      task_type: "ocr_extract",
      biz_type: "reimbursement_envelope",
      biz_id: envelope.id,
      priority: envelope.channel === "electronic" ? 5 : 4,
      payload: {
        envelope_id: envelope.id,
        attachment_id: attachment.id,
        file_key: attachment.file_key,
        file_name: attachment.file_name,
        channel: envelope.channel,
        project_id: envelope.project_id
      },
      timeout_seconds: 300
    });
    latestTaskId = task.id;

    await env.DB.prepare(
      `INSERT INTO reimbursement_invoice_review
        (envelope_id, attachment_id, review_round, channel, task_id, task_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
      .bind(envelope.id, attachment.id, round, envelope.channel, task.id, now, now)
      .run();
  }

  return { round, latestTaskId };
};

const applyInvoiceReviewDuplicateChecks = async (
  env: Env,
  envelopeId: number,
  rows: InvoiceReviewRow[]
): Promise<number> => {
  await env.DB.prepare(
    "DELETE FROM reimbursement_duplicate_check WHERE envelope_id = ? AND match_type IN ('invoice_no_date', 'qr_hash')"
  )
    .bind(envelopeId)
    .run();

  const now = nowIso();
  let count = 0;
  for (const row of rows) {
    const invoiceNo = row.invoice_no?.trim();
    const invoiceDate = row.invoice_date?.trim();
    if (invoiceNo && invoiceDate) {
      const matched = await env.DB.prepare(
        `SELECT envelope_id FROM reimbursement_invoice_review
          WHERE envelope_id != ?
            AND invoice_no = ?
            AND invoice_date = ?
            AND task_status = 'completed'
          ORDER BY id DESC
          LIMIT 10`
      )
        .bind(envelopeId, invoiceNo, invoiceDate)
        .all<{ envelope_id: number }>();

      for (const item of matched.results ?? []) {
        const riskLevel = row.invoice_unique_no ? "high" : "medium";
        await env.DB.prepare(
          `INSERT INTO reimbursement_duplicate_check
            (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
           VALUES (?, ?, ?, 'invoice_no_date', 1, ?, ?, ?, ?)`
        )
          .bind(
            envelopeId,
            item.envelope_id,
            invoiceNo,
            riskLevel,
            row.invoice_unique_no
              ? "电子发票号+日期重复且唯一编号可交叉验证，疑似重复票据"
              : "电子发票号+日期重复，建议办公室结合附件原件进一步核对",
            JSON.stringify({
              invoice_no: invoiceNo,
              invoice_date: invoiceDate,
              invoice_unique_no: row.invoice_unique_no,
              confidence: row.invoice_unique_no ? "strong" : "medium"
            }),
            now
          )
          .run();
        count += 1;
      }
    }

    const qrHash = row.qr_hash?.trim();
    if (!qrHash) continue;
    const matchedQr = await env.DB.prepare(
      `SELECT envelope_id FROM reimbursement_invoice_review
        WHERE envelope_id != ?
          AND qr_hash = ?
          AND task_status = 'completed'
        ORDER BY id DESC
        LIMIT 10`
    )
      .bind(envelopeId, qrHash)
      .all<{ envelope_id: number }>();
    for (const item of matchedQr.results ?? []) {
      await env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, 'qr_hash', 1, 'high', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          item.envelope_id,
          row.invoice_no,
          "电子发票二维码内容重复，疑似重复票据",
          JSON.stringify({ qr_hash: qrHash, invoice_no: row.invoice_no, invoice_date: row.invoice_date }),
          now
        )
        .run();
      count += 1;
    }
  }
  return count;
};

const applyDuplicateChecks = async (
  env: Env,
  envelopeId: number,
  hints?: {
    invoice_unique_no?: string | null;
    invoice_no?: string | null;
    expense_date?: string | null;
  }
): Promise<number> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") {
    return 0;
  }

  await env.DB.prepare("DELETE FROM reimbursement_duplicate_check WHERE envelope_id = ?")
    .bind(envelopeId)
    .run();

  const now = nowIso();
  let count = 0;

  const invoiceUniqueNo = hints?.invoice_unique_no?.trim() || envelope.invoice_unique_no?.trim();
  const invoiceNo = hints?.invoice_no?.trim() || envelope.invoice_no?.trim();
  const expenseDate = hints?.expense_date?.trim() || envelope.expense_date;
  if (invoiceUniqueNo || invoiceNo) {
    const rows = invoiceUniqueNo
      ? await env.DB.prepare(
          `SELECT id, project_id, invoice_no, invoice_unique_no FROM reimbursement_envelope
           WHERE id != ? AND status != 'deleted' AND invoice_unique_no = ?`
        )
          .bind(envelopeId, invoiceUniqueNo)
          .all<{ id: number; project_id: number; invoice_no: string | null; invoice_unique_no: string | null }>()
      : await env.DB.prepare(
          `SELECT id, project_id, invoice_no, invoice_unique_no FROM reimbursement_envelope
           WHERE id != ? AND status != 'deleted' AND invoice_no = ?`
        )
          .bind(envelopeId, invoiceNo ?? "")
          .all<{ id: number; project_id: number; invoice_no: string | null; invoice_unique_no: string | null }>();

    for (const row of rows.results ?? []) {
      const matchType = row.project_id === envelope.project_id ? "exact" : "cross_project";
      await env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'high', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.id,
          row.invoice_unique_no ?? row.invoice_no,
          matchType,
          1,
          matchType === "exact" ? "发票唯一编号完全重复" : "发票唯一编号跨项目重复",
          JSON.stringify({
            matched_envelope_id: row.id,
            invoice_unique_no: row.invoice_unique_no,
            invoice_no: row.invoice_no
          }),
          now
        )
        .run();
      count += 1;
    }
  }

  if (envelope.amount > 0) {
    const fuzzyRows = await env.DB.prepare(
      `SELECT id, project_id, invoice_no, amount, expense_date FROM reimbursement_envelope
       WHERE id != ? AND status != 'deleted'
         AND ABS(amount - ?) <= 1
         AND (
           expense_date IS NULL OR ? IS NULL OR ABS(julianday(expense_date) - julianday(?)) <= 7
         )
       ORDER BY updated_at DESC
       LIMIT 10`
    )
       .bind(envelopeId, envelope.amount, expenseDate, expenseDate)
      .all<{
        id: number;
        project_id: number;
        invoice_no: string | null;
        amount: number;
        expense_date: string | null;
      }>();

    for (const row of fuzzyRows.results ?? []) {
      await env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, 'fuzzy', ?, 'medium', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.id,
          row.invoice_no,
          0.6,
          "金额接近且时间相近，疑似重复报销",
          JSON.stringify({
            matched_envelope_id: row.id,
            amount: row.amount,
            expense_date: row.expense_date
          }),
          now
        )
        .run();
      count += 1;
    }
  }

  const attachmentRows = await env.DB.prepare(
    "SELECT file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' AND file_key IS NOT NULL"
  )
    .bind(envelopeId)
    .all<{ file_key: string }>();
  const fileKeys = Array.from(
    new Set(
      (attachmentRows.results ?? [])
        .map(row => row.file_key?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

  for (const fileKey of fileKeys) {
    const matched = await env.DB.prepare(
      `SELECT ea.envelope_id
         FROM envelope_attachment ea
         JOIN reimbursement_envelope re ON re.id = ea.envelope_id
        WHERE ea.file_key = ?
          AND ea.status = 'active'
          AND ea.envelope_id != ?
          AND re.status != 'deleted'
        ORDER BY ea.id DESC
        LIMIT 10`
    )
      .bind(fileKey, envelopeId)
      .all<{ envelope_id: number }>();

    for (const row of matched.results ?? []) {
      await env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, NULL, 'attachment_file_key', ?, 'high', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.envelope_id,
          0.95,
          "附件文件疑似重复提交（file_key 一致）",
          JSON.stringify({ matched_envelope_id: row.envelope_id, file_key: fileKey }),
          now
        )
        .run();
      count += 1;
    }
  }

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET duplicate_check_status = 'completed', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), envelopeId)
    .run();

  return count;
};

const enqueueEnvelopeAiAudit = async (
  env: Env,
  envelopeId: number,
  options?: { file_key?: string | null; forceRerun?: boolean; triggeredBy?: string | null; reason?: string | null }
) => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") return;

  const duplicateCount = await applyDuplicateChecks(env, envelopeId);
  const now = nowIso();

  const attachments = await env.DB.prepare(
    `SELECT id, attachment_type, file_key, file_name, file_size, invoice_no, amount, issue_date
       FROM envelope_attachment
      WHERE envelope_id = ? AND status = 'active'
      ORDER BY id ASC`
  )
    .bind(envelopeId)
    .all<{
      id: number;
      attachment_type: string;
      file_key: string;
      file_name: string | null;
      file_size: number | null;
      invoice_no: string | null;
      amount: number | null;
      issue_date: string | null;
    }>();

  const duplicateChecks = await env.DB.prepare(
    `SELECT matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json
       FROM reimbursement_duplicate_check
      WHERE envelope_id = ?
      ORDER BY id DESC`
  )
    .bind(envelopeId)
    .all<{
      matched_envelope_id: number | null;
      matched_invoice_no: string | null;
      match_type: string;
      match_score: number | null;
      risk_level: string;
      summary: string | null;
      evidence_json: string | null;
    }>();

  await createTask(env, {
    task_type: "reimbursement_anomaly",
    biz_type: "reimbursement_envelope",
    biz_id: envelopeId,
    priority: 4,
    payload: {
      envelope_id: envelopeId,
      review_strategy:
        envelope.channel === "electronic"
          ? "electronic_qr_first_duplicate_by_invoice_no_date"
          : "physical_invoice_multimodal_redundant",
      review_triggered_by: options?.triggeredBy ?? null,
      review_reason: options?.reason ?? null,
      rerun: options?.forceRerun === true,
      amount: envelope.amount,
      duplicate_count: duplicateCount,
      project_id: envelope.project_id,
      applicant_userid: envelope.applicant_userid,
      category: envelope.category,
      description: envelope.description,
      channel: envelope.channel,
      attachments: (attachments.results ?? []).map(item => ({
        attachment_type: item.attachment_type,
        file_key: item.file_key,
        file_name: item.file_name,
        file_size: item.file_size,
        invoice_no: item.invoice_no,
        amount: item.amount,
        issue_date: item.issue_date
      })),
      duplicate_checks: duplicateChecks.results ?? []
    },
    timeout_seconds: 300
  });

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET precheck_status = 'pending', duplicate_check_status = 'pending', silent_review_result = NULL, updated_at = ? WHERE id = ?"
  )
    .bind(now, envelopeId)
    .run();

  const validAttachments = (attachments.results ?? [])
    .map((item) => ({ id: item.id, file_key: item.file_key?.trim() ?? "", file_name: item.file_name ?? null }))
    .filter((item) => item.file_key);
  if (validAttachments.length === 0) return;

  const hasInvoiceReviewTable = await supportsInvoiceReviewTable(env);
  if (hasInvoiceReviewTable) {
    try {
      const reviewTaskState = await createInvoiceReviewTasks(env, envelope, validAttachments, {
        forceRerun: options?.forceRerun === true
      });

      await env.DB.prepare(
        "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
      )
        .bind(reviewTaskState.latestTaskId, nowIso(), envelopeId)
        .run();
      return;
    } catch (error) {
      if (!isMissingInvoiceReviewTableError(error)) {
        throw error;
      }
    }
  }

  const preferredFromOption = options?.file_key?.trim();
  const preferredAttachment =
    (preferredFromOption && validAttachments.find((item) => item.file_key === preferredFromOption)) ||
    validAttachments[validAttachments.length - 1];
  if (!preferredAttachment) return;
  const fallbackOcrTask = await createTask(env, {
    task_type: "ocr_extract",
    biz_type: "reimbursement_envelope",
    biz_id: envelopeId,
    priority: envelope.channel === "electronic" ? 5 : 4,
    payload: {
      envelope_id: envelopeId,
      file_key: preferredAttachment.file_key,
      file_name: preferredAttachment.file_name,
      project_id: envelope.project_id,
      channel: envelope.channel
    },
    timeout_seconds: 300
  });

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
  )
    .bind(fallbackOcrTask.id, nowIso(), envelopeId)
    .run();
};

const syncEnvelopeAuditState = async (env: Env, envelopeId: number): Promise<void> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();
  if (!envelope) return;
  if (envelope.status === "cancelled") return;

  let hasReviewRows = false;
  let latestReviewRound = 0;
  if (await supportsInvoiceReviewTable(env)) {
    try {
      const reviewRoundRow = await env.DB.prepare(
        "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
      )
        .bind(envelopeId)
        .first<{ max_round: number | null }>();
      latestReviewRound = Number(reviewRoundRow?.max_round ?? 0);
      hasReviewRows = latestReviewRound > 0;
    } catch (error) {
      if (!isMissingInvoiceReviewTableError(error)) {
        throw error;
      }
    }
  }

  if (hasReviewRows) {
    const reviewRows = await env.DB.prepare(
      `SELECT id, attachment_id, review_round, task_id, task_status, extraction_json,
              qr_text, qr_hash, invoice_unique_no, invoice_no, invoice_date, invoice_amount,
              source, risk_level, risk_hint
         FROM reimbursement_invoice_review
        WHERE envelope_id = ? AND review_round = ?
        ORDER BY id ASC`
    )
      .bind(envelopeId, latestReviewRound)
      .all<InvoiceReviewRow>();

    for (const row of reviewRows.results ?? []) {
      if (!row.task_id) continue;
      if (!["pending", "assigned", "running"].includes(row.task_status)) continue;
      const task = await env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
        .bind(row.task_id)
        .first<{ status: string; result_json: string | null }>();
      if (!task) continue;

      if (task.status === "completed") {
        const parsed = parseTaskResult(task.result_json ?? null);
        const hints = extractInvoiceRecognitionHints(parsed);
        const qrText = normalizeHintValue(parsed?.qr_code_text) ?? normalizeHintValue(parsed?.qr_text);
        const qrHints = parseQrInvoiceHints(qrText);
        const invoiceNo = normalizeInvoiceNo(hints.invoice_no ?? qrHints.invoice_no ?? null);
        const invoiceDate = normalizeInvoiceDate(hints.expense_date ?? qrHints.invoice_date ?? null);
        const invoiceUniqueNo = normalizeInvoiceNo(hints.invoice_unique_no ?? qrHints.invoice_unique_no ?? null);
        const invoiceAmount =
          toAmountValue(parsed?.amount_with_tax) ??
          toAmountValue(parsed?.amount) ??
          qrHints.amount ??
          null;
        const qrHash = qrText ? await sha256Hex(qrText) : null;
        const source = qrText
          ? "qr_payload"
          : parsed && Object.keys(parsed).length > 0
            ? "ocr_text"
            : "fallback";

        await env.DB.prepare(
          `UPDATE reimbursement_invoice_review SET
             task_status = 'completed',
             extraction_json = ?,
             qr_text = ?,
             qr_hash = ?,
             invoice_unique_no = ?,
             invoice_no = ?,
             invoice_date = ?,
             invoice_amount = ?,
             source = ?,
             risk_level = ?,
             risk_hint = ?,
             updated_at = ?
           WHERE id = ?`
        )
          .bind(
            parsed ? JSON.stringify(parsed) : null,
            qrText,
            qrHash,
            invoiceUniqueNo,
            invoiceNo,
            invoiceDate,
            invoiceAmount,
            source,
            invoiceNo && invoiceDate ? "low" : "medium",
            invoiceNo && invoiceDate ? null : "票据识别字段不完整，建议人工复核",
            nowIso(),
            row.id
          )
          .run();
      } else if (task.status === "failed" || task.status === "timeout") {
        await env.DB.prepare(
          `UPDATE reimbursement_invoice_review SET
             task_status = 'failed',
             risk_level = 'high',
             risk_hint = '票据识别失败，建议办公室人工复核原件',
             updated_at = ?
           WHERE id = ?`
        )
          .bind(nowIso(), row.id)
          .run();
      } else {
        await env.DB.prepare(
          "UPDATE reimbursement_invoice_review SET task_status = ?, updated_at = ? WHERE id = ?"
        )
          .bind(task.status, nowIso(), row.id)
          .run();
      }
    }

    const syncedRows = await env.DB.prepare(
      `SELECT id, attachment_id, review_round, task_id, task_status, extraction_json,
              qr_text, qr_hash, invoice_unique_no, invoice_no, invoice_date, invoice_amount,
              source, risk_level, risk_hint
         FROM reimbursement_invoice_review
        WHERE envelope_id = ? AND review_round = ?
        ORDER BY id ASC`
    )
      .bind(envelopeId, latestReviewRound)
      .all<InvoiceReviewRow>();

    const rows = syncedRows.results ?? [];
    const pendingCount = rows.filter((row) => ["pending", "assigned", "running"].includes(row.task_status)).length;
    const completedRows = rows.filter((row) => row.task_status === "completed");
    const failedCount = rows.filter((row) => row.task_status === "failed").length;
    const ocrStatus = pendingCount > 0 ? "pending" : completedRows.length > 0 ? "completed" : "failed";
    const bestRow =
      completedRows.find((row) => row.qr_text && row.invoice_no && row.invoice_date) ??
      completedRows.find((row) => row.invoice_no || row.invoice_unique_no || row.invoice_date) ??
      rows[0];

    const extractedTotal = completedRows.reduce((sum, row) => {
      return sum + (typeof row.invoice_amount === "number" && Number.isFinite(row.invoice_amount) ? row.invoice_amount : 0);
    }, 0);
    const amountDelta = Number(((envelope.amount || 0) - extractedTotal).toFixed(2));
    const amountMismatch = completedRows.length > 0 && Math.abs(amountDelta) > 0.01;

    const hints = {
      invoice_unique_no: bestRow?.invoice_unique_no ?? null,
      invoice_no: bestRow?.invoice_no ?? null,
      expense_date: bestRow?.invoice_date ?? null,
      result_json: JSON.stringify({
        review_round: latestReviewRound,
        extracted_invoices: completedRows.map((row) => ({
          attachment_id: row.attachment_id,
          invoice_no: row.invoice_no,
          invoice_unique_no: row.invoice_unique_no,
          invoice_date: row.invoice_date,
          invoice_amount: row.invoice_amount,
          qr_text: row.qr_text,
          source: row.source,
          risk_level: row.risk_level,
          risk_hint: row.risk_hint
        })),
        failed_count: failedCount,
        pending_count: pendingCount,
        amount_summary: {
          declared_amount: envelope.amount,
          extracted_total: Number(extractedTotal.toFixed(2)),
          delta: amountDelta,
          mismatch: amountMismatch
        }
      })
    };

    await applyDuplicateChecks(env, envelopeId, hints);
    await applyInvoiceReviewDuplicateChecks(env, envelopeId, rows);

    // 审计同步只回写 OCR/审查字段;业务状态(成批/送审/付款等)由各自动作显式流转,
    // 此处绝不能改写 status,否则已进入后续流程的信封会被打回「待签收」
    await env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         ocr_status = ?,
         ocr_result_json = ?,
         ocr_invoice_unique_no_hint = ?,
         ocr_invoice_no_hint = ?,
         ocr_expense_date_hint = ?,
         duplicate_check_status = CASE WHEN ? > 0 THEN 'pending' ELSE 'completed' END,
         silent_review_result = COALESCE(silent_review_result, ?),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        ocrStatus,
        hints.result_json,
        hints.invoice_unique_no,
        hints.invoice_no,
        hints.expense_date,
        pendingCount,
        JSON.stringify({
          review_round: latestReviewRound,
          channel: envelope.channel,
          strategy:
            envelope.channel === "electronic"
              ? "电子发票二维码优先提取+历史比对+费用合理性AI辅助"
              : "实体票据OCR/Vision双通道识别+冗余安全兜底",
          summary: amountMismatch
            ? "检测到票据合计与申报金额不一致，请办公室优先复核金额与票据明细"
            : "静默审查已完成，建议结合AI建议与附件原件进行确认",
          invoice_review: {
            total: rows.length,
            completed: completedRows.length,
            failed: failedCount,
            pending: pendingCount
          },
          amount_consistency: {
            declared_amount: envelope.amount,
            extracted_total: Number(extractedTotal.toFixed(2)),
            delta: amountDelta,
            mismatch: amountMismatch,
            conclusion: amountMismatch
              ? "票据合计与申报金额存在差异，需办公室人工复核"
              : "票据合计与申报金额一致"
          },
          office_hints: [
            pendingCount > 0 ? "仍有票据识别任务进行中，请稍后刷新" : null,
            failedCount > 0 ? "存在票据识别失败，请人工核对附件原件" : null,
            amountMismatch ? "检测到票据合计与申报金额不一致" : null
          ].filter((item): item is string => Boolean(item))
        }),
        nowIso(),
        envelopeId
      )
      .run();
  }

  if (!hasReviewRows && envelope.ocr_task_id) {
    const ocrTask = await env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
      .bind(envelope.ocr_task_id)
      .first<{ status: string; result_json: string | null }>();
    const ocrResult = parseTaskResult(ocrTask?.result_json ?? null);

    if (ocrTask?.status === "completed" && envelope.ocr_status !== "completed") {
      const hints = extractInvoiceRecognitionHints(ocrResult);
      // 同上:审计同步不改写业务状态
      await env.DB.prepare(
        `UPDATE reimbursement_envelope SET
           ocr_status = 'completed',
           ocr_result_json = ?,
           ocr_invoice_unique_no_hint = ?,
           ocr_invoice_no_hint = ?,
           ocr_expense_date_hint = ?,
           updated_at = ?
         WHERE id = ?`
      )
        .bind(
          hints.result_json,
          hints.invoice_unique_no,
          hints.invoice_no,
          hints.expense_date,
          nowIso(),
          envelopeId
        )
        .run();

      await applyDuplicateChecks(env, envelopeId, hints);
    }

    if ((ocrTask?.status === "failed" || ocrTask?.status === "timeout") && envelope.ocr_status !== "failed") {
      await env.DB.prepare(
        "UPDATE reimbursement_envelope SET ocr_status = 'failed', duplicate_check_status = 'failed', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), envelopeId)
        .run();
    }
  }

  const anomalyTask = await env.DB.prepare(
    `SELECT status, result_json FROM task_queue
     WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
     ORDER BY id DESC LIMIT 1`
  )
    .bind(envelopeId)
    .first<{ status: string; result_json: string | null }>();

  if (anomalyTask?.status === "completed") {
    const silentReviewResult = parseTaskResult(anomalyTask.result_json ?? null);
    const latestSilentReviewRow = await env.DB.prepare(
      "SELECT silent_review_result FROM reimbursement_envelope WHERE id = ?"
    )
      .bind(envelopeId)
      .first<{ silent_review_result: string | null }>();
    const existingSilentReview = parseStoredJson(latestSilentReviewRow?.silent_review_result ?? null);
    const mergedSilentReview = {
      ...(existingSilentReview ?? {}),
      ai_reasonability: silentReviewResult,
      ai_reasonability_summary:
        typeof silentReviewResult?.summary === "string"
          ? silentReviewResult.summary
          : typeof silentReviewResult?.comment === "string"
            ? silentReviewResult.comment
            : null
    };
    await env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         duplicate_check_status = 'completed',
         silent_review_result = ?,
         precheck_status = CASE WHEN precheck_status = 'none' THEN 'pending' ELSE precheck_status END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(JSON.stringify(mergedSilentReview), nowIso(), envelopeId)
      .run();
  }

  if (anomalyTask?.status === "failed" || anomalyTask?.status === "timeout") {
    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET duplicate_check_status = 'failed', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), envelopeId)
      .run();
  }
};

export const reimbursementRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

reimbursementRoutes.use("*", authMiddleware);

reimbursementRoutes.get(
  "/workbench-summary",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const envelopeRow = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS to_receive,
         SUM(CASE WHEN status = 'received' AND precheck_status IN ('none', 'pending', 'supplement') THEN 1 ELSE 0 END) AS to_precheck,
         SUM(CASE WHEN status = 'received' AND precheck_status = 'approved' AND batch_id IS NULL THEN 1 ELSE 0 END) AS to_batch
       FROM reimbursement_envelope
       WHERE status != 'cancelled'`
    ).first<{
      to_receive: number | null;
      to_precheck: number | null;
      to_batch: number | null;
    }>();

    const batchRow = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS batches_to_submit,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS batches_to_pay
       FROM reimbursement_batch`
    ).first<{
      batches_to_submit: number | null;
      batches_to_pay: number | null;
    }>();

    return c.json({
      success: true,
      data: {
        to_receive: envelopeRow?.to_receive ?? 0,
        to_precheck: envelopeRow?.to_precheck ?? 0,
        to_batch: envelopeRow?.to_batch ?? 0,
        batches_to_submit: batchRow?.batches_to_submit ?? 0,
        batches_to_pay: batchRow?.batches_to_pay ?? 0
      }
    });
  }
);

reimbursementRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rawStatus = c.req.query("status") ?? "";
  const statusFilters = rawStatus
    .split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(item) && reimbursementStatusSet.has(item));
  const rawPrecheck = c.req.query("precheck_status") ?? "";
  const precheckFilters = rawPrecheck
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const projectId = c.req.query("project_id");
  const creatorId = c.req.query("creator_id");
  const applicantUserid = c.req.query("applicant_userid");
  const requestedApplicantFilter = creatorId
    ? creatorId === "me"
      ? auth.sub
      : creatorId
    : applicantUserid;
  const applicantFilter = hasOfficeRole(auth.roles) ? requestedApplicantFilter : auth.sub;
  const channel = c.req.query("channel");
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");
  const excludeCancelled = ["1", "true", "yes"].includes(
    (c.req.query("exclude_cancelled") ?? "").toLowerCase()
  );
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let sql = `SELECT
      e.*,
      (
        SELECT COUNT(*)
          FROM reimbursement_duplicate_check d
         WHERE d.envelope_id = e.id
      ) AS duplicate_count,
      (
        SELECT CASE MAX(
          CASE d.risk_level
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
          END
        )
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          WHEN 1 THEN 'low'
          ELSE NULL
        END
          FROM reimbursement_duplicate_check d
         WHERE d.envelope_id = e.id
      ) AS duplicate_risk_level
    FROM reimbursement_envelope e
    WHERE e.status != 'deleted'`;
  let countSql = "SELECT COUNT(*) as total FROM reimbursement_envelope e WHERE e.status != 'deleted'";
  const params: (string | number)[] = [];

  if (statusFilters.length > 0) {
    const placeholders = statusFilters.map(() => "?").join(", ");
    sql += ` AND e.status IN (${placeholders})`;
    countSql += ` AND e.status IN (${placeholders})`;
    params.push(...statusFilters);
  } else if (excludeCancelled) {
    sql += " AND e.status != 'cancelled'";
    countSql += " AND e.status != 'cancelled'";
  }
  if (precheckFilters.length > 0) {
    const placeholders = precheckFilters.map(() => "?").join(", ");
    sql += ` AND e.precheck_status IN (${placeholders})`;
    countSql += ` AND e.precheck_status IN (${placeholders})`;
    params.push(...precheckFilters);
  }
  if (projectId) {
    sql += " AND e.project_id = ?";
    countSql += " AND e.project_id = ?";
    params.push(Number(projectId));
  }
  if (applicantFilter) {
    sql += " AND e.applicant_userid = ?";
    countSql += " AND e.applicant_userid = ?";
    params.push(applicantFilter);
  }
  if (channel) {
    sql += " AND e.channel = ?";
    countSql += " AND e.channel = ?";
    params.push(channel);
  }
  if (keyword) {
    sql += " AND (e.envelope_no LIKE ? OR e.envelope_uuid LIKE ? OR IFNULL(e.invoice_no, '') LIKE ? OR IFNULL(e.description, '') LIKE ?)";
    countSql += " AND (e.envelope_no LIKE ? OR e.envelope_uuid LIKE ? OR IFNULL(e.invoice_no, '') LIKE ? OR IFNULL(e.description, '') LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (legacyDataId) {
    sql += " AND e.legacy_data_id = ?";
    countSql += " AND e.legacy_data_id = ?";
    params.push(legacyDataId);
  }

  sql += " ORDER BY e.id DESC LIMIT ? OFFSET ?";

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all<ReimbursementEnvelope>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

reimbursementRoutes.get(
  "/precheck/pending",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const projectId = c.req.query("project_id");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql =
      "SELECT * FROM reimbursement_envelope WHERE status IN ('submitted', 'received') AND precheck_status IN ('none', 'pending', 'supplement')";
    let countSql =
      "SELECT COUNT(*) as total FROM reimbursement_envelope WHERE status IN ('submitted', 'received') AND precheck_status IN ('none', 'pending', 'supplement')";
    const params: (string | number)[] = [];

    if (projectId) {
      sql += " AND project_id = ?";
      countSql += " AND project_id = ?";
      params.push(Number(projectId));
    }

    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();

    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<ReimbursementEnvelope>();

    const data = await Promise.all(
      (rows.results ?? []).map(async (item) => {
        const duplicateCount = await c.env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM reimbursement_duplicate_check WHERE envelope_id = ?"
        )
          .bind(item.id)
          .first<{ cnt: number }>();

        return {
          ...item,
          duplicate_count: duplicateCount?.cnt ?? 0
        };
      })
    );

    return c.json({
      success: true,
      data,
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

reimbursementRoutes.get(
  "/duplicate-center",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const riskLevel = c.req.query("risk_level");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql =
      "SELECT d.*, e.envelope_no, e.project_id, e.applicant_userid, e.amount FROM reimbursement_duplicate_check d JOIN reimbursement_envelope e ON d.envelope_id = e.id WHERE e.status != 'deleted'";
    let countSql =
      "SELECT COUNT(*) as total FROM reimbursement_duplicate_check d JOIN reimbursement_envelope e ON d.envelope_id = e.id WHERE e.status != 'deleted'";
    const params: (string | number)[] = [];

    if (riskLevel) {
      sql += " AND d.risk_level = ?";
      countSql += " AND d.risk_level = ?";
      params.push(riskLevel);
    }

    sql += " ORDER BY d.id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();
    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

reimbursementRoutes.get(
  "/batch",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const status = c.req.query("status");
    const projectId = c.req.query("project_id");
    const applicantUserid = c.req.query("applicant_userid");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM reimbursement_batch WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM reimbursement_batch WHERE 1=1";
    const params: (string | number)[] = [];

    if (status) {
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(status);
    }
    if (projectId) {
      sql += " AND project_id = ?";
      countSql += " AND project_id = ?";
      params.push(Number(projectId));
    }
    if (applicantUserid) {
      sql += " AND applicant_userid = ?";
      countSql += " AND applicant_userid = ?";
      params.push(applicantUserid);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const totalRow = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();

    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<ReimbursementBatch>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: { page, pageSize, total: totalRow?.total ?? 0 }
    });
  }
);

reimbursementRoutes.get(
  "/batch/candidates",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const projectId = Number(c.req.query("project_id") ?? "0");
    const applicantUserid = c.req.query("applicant_userid")?.trim() ?? "";

    if (!projectId || projectId <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!applicantUserid) {
      return c.json({ success: false, error: { message: "applicant_userid is required" } }, 400);
    }

    const rows = await c.env.DB.prepare(
      `SELECT *
         FROM reimbursement_envelope
        WHERE status = 'received'
          AND precheck_status = 'approved'
          AND batch_id IS NULL
          AND project_id = ?
          AND applicant_userid = ?
        ORDER BY updated_at DESC, id DESC`
    )
      .bind(projectId, applicantUserid)
      .all<ReimbursementEnvelope>();

    return c.json({
      success: true,
      data: rows.results ?? []
    });
  }
);

reimbursementRoutes.get(
  "/batch/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    const items = await c.env.DB.prepare(
      `SELECT bi.id as batch_item_id, bi.amount as batch_amount, bi.status as batch_item_status,
              e.*
       FROM reimbursement_batch_item bi
       JOIN reimbursement_envelope e ON e.id = bi.envelope_id
       WHERE bi.batch_id = ?
       ORDER BY bi.id ASC`
    )
      .bind(id)
      .all<
        ReimbursementEnvelope & {
          batch_item_id: number;
          batch_amount: number;
          batch_item_status: string;
        }
      >();

    const envelopeIds = Array.from(
      new Set((items.results ?? []).map((item) => item.id).filter((value) => Number.isFinite(value)))
    );

    let attachmentRows: EnvelopeAttachment[] = [];
    let reviewRows: Array<{
      envelope_id: number;
      risk_level: string;
      risk_hint: string | null;
      invoice_no: string | null;
      invoice_date: string | null;
      invoice_amount: number | null;
      source: string | null;
      confidence: number | null;
    }> = [];

    if (envelopeIds.length > 0) {
      const placeholders = envelopeIds.map(() => "?").join(", ");
      const attachmentResult = await c.env.DB.prepare(
        `SELECT *
           FROM envelope_attachment
          WHERE envelope_id IN (${placeholders})
            AND status = 'active'
          ORDER BY envelope_id ASC, id ASC`
      )
        .bind(...envelopeIds)
        .all<EnvelopeAttachment>();
      attachmentRows = attachmentResult.results ?? [];

      if (await supportsInvoiceReviewTable(c.env)) {
        const reviewResult = await c.env.DB.prepare(
          `SELECT rir.envelope_id, rir.risk_level, rir.risk_hint, rir.invoice_no,
                  rir.invoice_date, rir.invoice_amount, rir.source, rir.confidence
             FROM reimbursement_invoice_review rir
             JOIN (
               SELECT envelope_id, MAX(review_round) AS latest_round
                 FROM reimbursement_invoice_review
                WHERE envelope_id IN (${placeholders})
                GROUP BY envelope_id
             ) latest
               ON latest.envelope_id = rir.envelope_id
              AND latest.latest_round = rir.review_round
            WHERE rir.envelope_id IN (${placeholders})
            ORDER BY rir.envelope_id ASC, rir.id DESC`
        )
          .bind(...envelopeIds, ...envelopeIds)
          .all<{
            envelope_id: number;
            risk_level: string;
            risk_hint: string | null;
            invoice_no: string | null;
            invoice_date: string | null;
            invoice_amount: number | null;
            source: string | null;
            confidence: number | null;
          }>();
        reviewRows = reviewResult.results ?? [];
      }
    }

    const attachmentsByEnvelope = new Map<number, EnvelopeAttachment[]>();
    for (const row of attachmentRows) {
      const bucket = attachmentsByEnvelope.get(row.envelope_id) ?? [];
      bucket.push(row);
      attachmentsByEnvelope.set(row.envelope_id, bucket);
    }

    const reviewsByEnvelope = new Map<
      number,
      Array<{
        risk_level: string;
        risk_hint: string | null;
        invoice_no: string | null;
        invoice_date: string | null;
        invoice_amount: number | null;
        source: string | null;
        confidence: number | null;
      }>
    >();
    for (const row of reviewRows) {
      const bucket = reviewsByEnvelope.get(row.envelope_id) ?? [];
      bucket.push({
        risk_level: row.risk_level,
        risk_hint: row.risk_hint,
        invoice_no: row.invoice_no,
        invoice_date: row.invoice_date,
        invoice_amount: row.invoice_amount,
        source: row.source,
        confidence: row.confidence
      });
      reviewsByEnvelope.set(row.envelope_id, bucket);
    }

    const riskOrder = { high: 3, medium: 2, low: 1 } as const;
    const normalizeRisk = (value: string | null | undefined): "high" | "medium" | "low" | null => {
      if (value === "high" || value === "medium" || value === "low") return value;
      return null;
    };

    const enrichedItems = (items.results ?? []).map((item) => {
      const envelopeAttachments = attachmentsByEnvelope.get(item.id) ?? [];
      const envelopeReviews = reviewsByEnvelope.get(item.id) ?? [];
      const highestRisk = envelopeReviews.reduce<"high" | "medium" | "low" | null>((max, row) => {
        const current = normalizeRisk(row.risk_level);
        if (!current) return max;
        if (!max || riskOrder[current] > riskOrder[max]) return current;
        return max;
      }, null);
      const silentReview = parseStoredJson(item.silent_review_result);
      const reasonabilitySummary =
        (typeof silentReview?.ai_reasonability_summary === "string" &&
        (silentReview.ai_reasonability_summary as string).trim()) ||
        (typeof silentReview?.summary === "string" && (silentReview.summary as string).trim()) ||
        item.precheck_comment ||
        null;

      return {
        ...item,
        attachments: envelopeAttachments,
        ai_reasonability_summary: reasonabilitySummary,
        invoice_review_highest_risk: highestRisk,
        invoice_review_hints: envelopeReviews.slice(0, 3)
      };
    });

    const duplicateSummary = await c.env.DB.prepare(
      `SELECT d.risk_level, COUNT(*) as cnt
       FROM reimbursement_duplicate_check d
       JOIN reimbursement_batch_item bi ON bi.envelope_id = d.envelope_id
       WHERE bi.batch_id = ?
       GROUP BY d.risk_level`
    )
      .bind(id)
      .all<{ risk_level: string; cnt: number }>();

    const paymentEntity = batch.payment_entity_id
      ? await c.env.DB.prepare(
          "SELECT id, entity_code, entity_name FROM entity WHERE id = ?"
        )
          .bind(batch.payment_entity_id)
          .first<{ id: number; entity_code: string; entity_name: string }>()
      : null;

    const paymentBankAccount = batch.payment_entity_bank_account_id
      ? await c.env.DB.prepare(
          "SELECT id, entity_id, bank_name, bank_branch_no, account_no, account_name FROM entity_bank_account WHERE id = ?"
        )
          .bind(batch.payment_entity_bank_account_id)
          .first<{
            id: number;
            entity_id: number;
            bank_name: string;
            bank_branch_no: string | null;
            account_no: string;
            account_name: string;
          }>()
      : null;

    const payee = batch.payee_id
      ? await c.env.DB.prepare(
          "SELECT id, name, bank_name, bank_account, phone, type FROM payee WHERE id = ?"
        )
          .bind(batch.payee_id)
          .first<{
            id: number;
            name: string;
            bank_name: string;
            bank_account: string;
            phone: string | null;
            type: string;
          }>()
      : null;

    let paymentVouchers: ReimbursementPaymentVoucherInput[] = [];
    if (batch.payment_vouchers_json) {
      try {
        const parsed = JSON.parse(batch.payment_vouchers_json) as unknown;
        if (Array.isArray(parsed)) {
          paymentVouchers = parsed
            .map((item): ReimbursementPaymentVoucherInput | null => {
              if (!item || typeof item !== "object") return null;
              const row = item as {
                file_key?: unknown;
                file_name?: unknown;
                file_size?: unknown;
              };
              if (typeof row.file_key !== "string" || !row.file_key.trim()) return null;
              const normalized: ReimbursementPaymentVoucherInput = {
                file_key: row.file_key.trim()
              };
              if (typeof row.file_name === "string" && row.file_name.trim()) {
                normalized.file_name = row.file_name.trim();
              }
              if (typeof row.file_size === "number" && Number.isFinite(row.file_size)) {
                normalized.file_size = row.file_size;
              }
              return normalized;
            })
            .filter((item): item is ReimbursementPaymentVoucherInput => item !== null);
        }
      } catch {
        paymentVouchers = [];
      }
    }

    const approvalInstance = batch.approval_instance_id
      ? await c.env.DB.prepare(
          `SELECT ai.id, ai.instance_no, ai.status, ai.current_node_key, ai.current_round,
                  ai.submitted_at, ai.completed_at,
                  COALESCE(ani.node_name, ai.current_node_key) AS current_node_name
             FROM approval_instance ai
             LEFT JOIN approval_node_instance ani
               ON ani.instance_id = ai.id
              AND ani.node_key = ai.current_node_key
              AND ani.round = ai.current_round
            WHERE ai.id = ?`
        )
          .bind(batch.approval_instance_id)
          .first<{
            id: number;
            instance_no: string;
            status: string;
            current_node_key: string | null;
            current_round: number;
            submitted_at: string;
            completed_at: string | null;
            current_node_name: string | null;
          }>()
      : null;

    return c.json({
      success: true,
      data: {
        ...batch,
        items: enrichedItems,
        duplicate_summary: duplicateSummary.results ?? [],
        approval_instance: approvalInstance,
        payment_entity: paymentEntity,
        payment_bank_account: paymentBankAccount,
        payee,
        payment_vouchers: paymentVouchers
      }
    });
  }
);

reimbursementRoutes.post(
  "/batch",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateReimbursementBatchRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!body.applicant_userid?.trim()) {
      return c.json({ success: false, error: { message: "applicant_userid is required" } }, 400);
    }

    const payoutPlan = await resolveReimbursementPayoutPlan(c.env, body);
    if ("error" in payoutPlan) {
      return c.json({ success: false, error: { message: payoutPlan.error } }, 400);
    }

    const baseEnvelopeSql =
      body.envelope_ids && body.envelope_ids.length > 0
        ? `SELECT * FROM reimbursement_envelope
           WHERE status != 'deleted'
             AND id IN (${body.envelope_ids.map(() => "?").join(",")})`
        : `SELECT * FROM reimbursement_envelope
           WHERE status = 'received' AND precheck_status = 'approved'
             AND batch_id IS NULL
             AND approval_instance_id IS NULL
             AND project_id = ? AND applicant_userid = ?`;

    const envelopeQuery = c.env.DB.prepare(baseEnvelopeSql);
    const envelopes =
      body.envelope_ids && body.envelope_ids.length > 0
        ? await envelopeQuery.bind(...body.envelope_ids).all<ReimbursementEnvelope>()
        : await envelopeQuery
            .bind(body.project_id, body.applicant_userid.trim())
            .all<ReimbursementEnvelope>();

    const selected = (envelopes.results ?? []).filter(
      (item) =>
        item.project_id === body.project_id &&
        item.applicant_userid === body.applicant_userid.trim() &&
        item.batch_id === null &&
        item.approval_instance_id === null &&
        item.status === "received" &&
        item.precheck_status === "approved"
    );

    if (selected.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "No eligible envelopes. Require status=received, precheck_status=approved, same project/applicant, and not batched/submitted."
          }
        },
        400
      );
    }

    if (typeof body.payee_id === "number" && body.payee_id > 0) {
      const payeeRow = await c.env.DB.prepare(
        "SELECT id, type, status, linked_userid, created_by_userid FROM payee WHERE id = ?"
      )
        .bind(body.payee_id)
        .first<{
          id: number;
          type: string;
          status: string;
          linked_userid: string | null;
          created_by_userid: string;
        }>();
      if (!payeeRow || payeeRow.status !== "active") {
        return c.json(
          { success: false, error: { message: "payee_id not found or inactive" } },
          400
        );
      }
      if (payeeRow.type !== "internal") {
        return c.json(
          { success: false, error: { message: "payee_id must reference an internal payee" } },
          400
        );
      }
      if (
        payeeRow.linked_userid &&
        payeeRow.linked_userid !== body.applicant_userid.trim()
      ) {
        return c.json(
          {
            success: false,
            error: { message: "payee linked_userid does not match applicant_userid" }
          },
          400
        );
      }
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const actorKey = auth.sub;
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { id: number; batch_no: string; total_amount: number; item_count: number };
    }>(c.env.DB, `reimbursement:batch-create:${body.project_id}:${body.applicant_userid.trim()}`, actorKey, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 201 });
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Batch creation already in progress" } }, 409);
    }

    const now = nowIso();
    const batchNo = await generateSerial(c.env.DB, "RM", "reimbursement_batch", "batch_no");
    const totalAmount = selected.reduce((sum, item) => sum + (item.amount || 0), 0);

    let batchId = 0;
    try {
      await runInTransaction(c.env.DB, async () => {
        const insertBatch = await c.env.DB.prepare(
          `INSERT INTO reimbursement_batch
            (batch_no, project_id, applicant_userid, total_amount, item_count, status, ai_audit_status,
             payment_method, payment_entity_id, payment_entity_bank_account_id, payment_account,
             payee_id,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', 'none', ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            batchNo,
            body.project_id,
            body.applicant_userid.trim(),
            totalAmount,
            selected.length,
            payoutPlan.value.payment_method,
            payoutPlan.value.payment_entity_id,
            payoutPlan.value.payment_entity_bank_account_id,
            payoutPlan.value.payment_account,
            body.payee_id ?? null,
            now,
            now
          )
          .run();

        batchId = insertBatch.meta.last_row_id as number;

        for (const envelope of selected) {
          await c.env.DB.prepare(
            `INSERT INTO reimbursement_batch_item
              (batch_id, envelope_id, amount, status, created_at)
             VALUES (?, ?, ?, 'active', ?)`
          )
            .bind(batchId, envelope.id, envelope.amount, now)
            .run();

          const updateResult = await c.env.DB.prepare(
            `UPDATE reimbursement_envelope
                SET batch_id = ?, status = 'batched', updated_at = ?
              WHERE id = ?
                AND batch_id IS NULL
                AND status = 'received'
                AND precheck_status = 'approved'`
          )
            .bind(batchId, now, envelope.id)
            .run();

          if ((updateResult.meta.changes ?? 0) !== 1) {
            throw new Error(`Envelope ${envelope.id} is no longer eligible for batching`);
          }
        }
      });
    } catch (error) {
      await abandonIdempotentRequest(
        c.env.DB,
        `reimbursement:batch-create:${body.project_id}:${body.applicant_userid.trim()}`,
        actorKey,
        idempotencyKey
      );
      throw error;
    }

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_CREATED", "reimbursement_batch", {
      batch_id: batchId,
      batch_no: batchNo,
      project_id: body.project_id,
      applicant_userid: body.applicant_userid.trim(),
      item_count: selected.length,
      total_amount: totalAmount,
      payment_method: payoutPlan.value.payment_method,
      payment_entity_id: payoutPlan.value.payment_entity_id,
      payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.create",
      targetType: "reimbursement_batch",
      targetId: batchId,
      detail: {
        batch_no: batchNo,
        project_id: body.project_id,
        applicant_userid: body.applicant_userid.trim(),
        item_count: selected.length,
        total_amount: totalAmount,
        payment_method: payoutPlan.value.payment_method,
        payment_entity_id: payoutPlan.value.payment_entity_id,
        payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id
      }
    });

    const payload = {
      success: true,
      data: {
        id: batchId,
        batch_no: batchNo,
        total_amount: totalAmount,
        item_count: selected.length
      }
    };
    await completeIdempotentRequest(
      c.env.DB,
      `reimbursement:batch-create:${body.project_id}:${body.applicant_userid.trim()}`,
      actorKey,
      idempotencyKey,
      201,
      payload
    );

    return c.json(
      payload,
      201
    );
  }
);

reimbursementRoutes.post(
  "/batch/:id/trigger-audit",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    const items = await c.env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.envelope_uuid, e.invoice_no, e.amount, e.expense_date,
              e.category, e.description, e.precheck_status
       FROM reimbursement_batch_item bi
       JOIN reimbursement_envelope e ON e.id = bi.envelope_id
       WHERE bi.batch_id = ?
       ORDER BY bi.id ASC`
    )
      .bind(id)
      .all();

    const duplicates = await c.env.DB.prepare(
      `SELECT d.* FROM reimbursement_duplicate_check d
       JOIN reimbursement_batch_item bi ON bi.envelope_id = d.envelope_id
       WHERE bi.batch_id = ?
       ORDER BY d.id DESC`
    )
      .bind(id)
      .all();

    await c.env.DB.prepare(
      "UPDATE reimbursement_batch SET ai_audit_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    const task = await createTask(c.env, {
      task_type: "reimbursement_check",
      biz_type: "reimbursement_batch",
      biz_id: id,
      priority: 4,
      payload: {
        batch_id: id,
        batch_no: batch.batch_no,
        project_id: batch.project_id,
        applicant_userid: batch.applicant_userid,
        total_amount: batch.total_amount,
        item_count: batch.item_count,
        items: items.results ?? [],
        duplicate_checks: duplicates.results ?? []
      },
      timeout_seconds: 600
    });

    return c.json({ success: true, data: { task_id: task.id, ai_audit_status: "pending" } });
  }
);

reimbursementRoutes.get(
  "/batch/:id/audit-report",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    const task = await c.env.DB.prepare(
      `SELECT id, status, result_json FROM task_queue
       WHERE biz_type = 'reimbursement_batch' AND biz_id = ? AND task_type = 'reimbursement_check'
       ORDER BY id DESC LIMIT 1`
    )
      .bind(id)
      .first<{ id: number; status: string; result_json: string | null }>();

    const taskResult = parseTaskResult(task?.result_json ?? null);

    if (task?.status === "completed" && batch.ai_audit_status !== "completed") {
      await c.env.DB.prepare(
        "UPDATE reimbursement_batch SET ai_audit_status = 'completed', ai_audit_result = ?, updated_at = ? WHERE id = ?"
      )
        .bind(taskResult ? JSON.stringify(taskResult) : null, nowIso(), id)
        .run();
      batch.ai_audit_status = "completed";
      batch.ai_audit_result = taskResult ? JSON.stringify(taskResult) : null;
    }

    if ((task?.status === "failed" || task?.status === "timeout") && batch.ai_audit_status !== "failed") {
      await c.env.DB.prepare(
        "UPDATE reimbursement_batch SET ai_audit_status = 'failed', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), id)
        .run();
      batch.ai_audit_status = "failed";
    }

    let parsedResult: Record<string, unknown> | string | null = null;
    if (batch.ai_audit_result) {
      try {
        parsedResult = JSON.parse(batch.ai_audit_result) as Record<string, unknown>;
      } catch {
        parsedResult = batch.ai_audit_result;
      }
    }

    return c.json({
      success: true,
      data: {
        status: batch.ai_audit_status,
        task_status: task?.status ?? "none",
        task_id: task?.id ?? null,
        result: parsedResult ?? taskResult
      }
    });
  }
);

reimbursementRoutes.post(
  "/batch/:id/submit-approval",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitReimbursementBatchApprovalRequest;

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    if (batch.status !== "draft") {
      return c.json({ success: false, error: { message: "Only draft batch can submit approval" } }, 400);
    }

    const payoutPlan = await resolveReimbursementPayoutPlan(c.env, body, {
      payment_method: normalizePaymentMethodValue(batch.payment_method).normalized,
      payment_entity_id: batch.payment_entity_id,
      payment_entity_bank_account_id: batch.payment_entity_bank_account_id,
      payment_account: batch.payment_account
    });
    if ("error" in payoutPlan) {
      return c.json({ success: false, error: { message: payoutPlan.error } }, 400);
    }

    if (!payoutPlan.value.payment_method) {
      return c.json(
        {
          success: false,
          error: {
            message: "payment_method is required before approval submission"
          }
        },
        400
      );
    }

    let payeeIdUpdate: number | undefined;
    if (typeof body.payee_id === "number" && body.payee_id > 0) {
      const payeeRow = await c.env.DB.prepare(
        "SELECT id, type, status, linked_userid, created_by_userid FROM payee WHERE id = ?"
      )
        .bind(body.payee_id)
        .first<{
          id: number;
          type: string;
          status: string;
          linked_userid: string | null;
          created_by_userid: string;
        }>();
      if (!payeeRow || payeeRow.status !== "active") {
        return c.json(
          { success: false, error: { message: "payee_id not found or inactive" } },
          400
        );
      }
      if (payeeRow.type !== "internal") {
        return c.json(
          { success: false, error: { message: "payee_id must reference an internal payee" } },
          400
        );
      }
      if (
        payeeRow.linked_userid &&
        payeeRow.linked_userid !== batch.applicant_userid
      ) {
        return c.json(
          {
            success: false,
            error: { message: "payee linked_userid does not match batch applicant" }
          },
          400
        );
      }
      payeeIdUpdate = body.payee_id;
    }

    const requirePayee = (c.env.REIMBURSEMENT_REQUIRE_PAYEE ?? "false").toLowerCase() === "true";
    const effectivePayeeId = payeeIdUpdate ?? batch.payee_id ?? null;
    if (requirePayee && !effectivePayeeId) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "payee_id is required (REIMBURSEMENT_REQUIRE_PAYEE=true). Select an internal payee for the reimbursee."
          }
        },
        400
      );
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { approval_instance_id: number; instance_no: string; resubmitted?: boolean };
    }>(c.env.DB, `reimbursement:batch-submit-approval:${id}`, auth.sub, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload);
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Approval submission already in progress" } }, 409);
    }

    if (batch.approval_instance_id) {
      const existing = await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
        .bind(batch.approval_instance_id)
        .first<{ status: string }>();

      const decision = existing
        ? getExistingApprovalSubmissionDecision(existing.status)
        : "new";
      if (decision === "active") {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }

      if (decision === "resubmit") {
        try {
          await resubmitOp(c.env, batch.approval_instance_id, auth.sub, body.biz_summary);
          const now = nowIso();
          await runInTransaction(c.env.DB, async () => {
            await c.env.DB.prepare(
              `UPDATE reimbursement_batch
                  SET status = 'pending_approval',
                      payment_method = ?,
                      payment_entity_id = ?,
                      payment_entity_bank_account_id = ?,
                      payment_account = ?,
                      payee_id = COALESCE(?, payee_id),
                      updated_at = ?
                WHERE id = ?`
            )
              .bind(
                payoutPlan.value.payment_method,
                payoutPlan.value.payment_entity_id,
                payoutPlan.value.payment_entity_bank_account_id,
                payoutPlan.value.payment_account,
                payeeIdUpdate ?? null,
                now,
                id
              )
              .run();

            await c.env.DB.prepare(
              "UPDATE reimbursement_envelope SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE batch_id = ?"
            )
              .bind(batch.approval_instance_id, now, id)
              .run();
          });

          const payload = {
            success: true,
            data: {
              approval_instance_id: batch.approval_instance_id,
              instance_no: "",
              resubmitted: true
            }
          };
          await completeIdempotentRequest(
            c.env.DB,
            `reimbursement:batch-submit-approval:${id}`,
            auth.sub,
            idempotencyKey,
            200,
            payload
          );
          return c.json(payload);
        } catch (error) {
          await abandonIdempotentRequest(c.env.DB, `reimbursement:batch-submit-approval:${id}`, auth.sub, idempotencyKey);
          const message = error instanceof Error ? error.message : "Resubmit failed";
          return c.json({ success: false, error: { message } }, 400);
        }
      }
    }

    const batchItems = await c.env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description
       FROM reimbursement_batch_item bi
       JOIN reimbursement_envelope e ON e.id = bi.envelope_id
       WHERE bi.batch_id = ?
       ORDER BY bi.id ASC`
    )
      .bind(id)
      .all<
        Pick<
          ReimbursementEnvelope,
          "id" | "envelope_no" | "invoice_no" | "amount" | "category" | "description"
        >
      >();

    let instance: Awaited<ReturnType<typeof submitForApproval>>;

    const effectivePayeeIdForContext = payeeIdUpdate ?? batch.payee_id ?? null;
    let payeeSnapshot: {
      id: number;
      name: string;
      bank_name: string;
      bank_account: string;
      type: string;
    } | null = null;
    if (effectivePayeeIdForContext) {
      payeeSnapshot = await c.env.DB.prepare(
        "SELECT id, name, bank_name, bank_account, type FROM payee WHERE id = ?"
      )
        .bind(effectivePayeeIdForContext)
        .first();
    }

    try {
      instance = await submitForApproval(
        c.env,
        {
          biz_type: "reimbursement_batch",
          biz_id: id,
          biz_summary:
            body.biz_summary?.trim() ||
            `${batch.batch_no} | ${batch.item_count} envelopes | ${batch.total_amount}`,
          context: {
            amount: batch.total_amount,
            project_id: batch.project_id,
            biz_type: "reimbursement_batch",
            biz_id: id,
            batch: {
              batch_no: batch.batch_no,
              applicant_userid: batch.applicant_userid,
              total_amount: batch.total_amount,
              item_count: batch.item_count,
              status: batch.status,
              payment_method: payoutPlan.value.payment_method,
              payment_entity_id: payoutPlan.value.payment_entity_id,
              payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id,
              payment_account: payoutPlan.value.payment_account
            },
            payee: payeeSnapshot,
            items: (batchItems.results ?? []).map(item => ({
              envelope_id: item.id,
              envelope_no: item.envelope_no,
              invoice_no: item.invoice_no,
              amount: item.amount,
              category: item.category,
              description: item.description
            }))
          },
          instance_config: body.instance_config
        },
        auth.sub,
        createAiGateHandler()
      );

      const now = nowIso();

      await runInTransaction(c.env.DB, async () => {
        const batchUpdate = await c.env.DB.prepare(
          `UPDATE reimbursement_batch
              SET status = 'pending_approval',
                  approval_instance_id = ?,
                  payment_method = ?,
                  payment_entity_id = ?,
                  payment_entity_bank_account_id = ?,
                  payment_account = ?,
                  payee_id = COALESCE(?, payee_id),
                  updated_at = ?
             WHERE id = ? AND status = 'draft'`
        )
          .bind(
            instance.id,
            payoutPlan.value.payment_method,
            payoutPlan.value.payment_entity_id,
            payoutPlan.value.payment_entity_bank_account_id,
            payoutPlan.value.payment_account,
            payeeIdUpdate ?? null,
            now,
            id
          )
          .run();
        if ((batchUpdate.meta.changes ?? 0) !== 1) {
          throw new Error("Batch is no longer in draft status");
        }

        await c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE batch_id = ?"
        )
          .bind(instance.id, now, id)
          .run();
      });
    } catch (error) {
      await abandonIdempotentRequest(c.env.DB, `reimbursement:batch-submit-approval:${id}`, auth.sub, idempotencyKey);
      throw error;
    }

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_SUBMITTED", "reimbursement_batch", {
      batch_id: id,
      batch_no: batch.batch_no,
      approval_instance_id: instance.id,
      submitted_by: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.submit_approval",
      targetType: "reimbursement_batch",
      targetId: id,
      detail: {
        approval_instance_id: instance.id,
        batch_no: batch.batch_no,
        payment_method: payoutPlan.value.payment_method,
        payment_entity_id: payoutPlan.value.payment_entity_id,
        payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id
      }
    });

    const payload = {
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    };
    await completeIdempotentRequest(
      c.env.DB,
      `reimbursement:batch-submit-approval:${id}`,
      auth.sub,
      idempotencyKey,
      200,
      payload
    );

    return c.json(payload);
  }
);

reimbursementRoutes.post(
  "/batch/:id/mark-paid",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as MarkBatchPaidRequest;

    if (!body.paid_at?.trim()) {
      return c.json({ success: false, error: { message: "paid_at is required" } }, 400);
    }
    if (!body.payment_reference?.trim()) {
      return c.json({ success: false, error: { message: "payment_reference is required" } }, 400);
    }
    if (typeof body.payment_entity_id !== "number" || body.payment_entity_id <= 0) {
      return c.json({ success: false, error: { message: "payment_entity_id is required" } }, 400);
    }
    if (
      typeof body.payment_entity_bank_account_id !== "number" ||
      body.payment_entity_bank_account_id <= 0
    ) {
      return c.json(
        { success: false, error: { message: "payment_entity_bank_account_id is required" } },
        400
      );
    }

    const entity = await c.env.DB.prepare("SELECT id, entity_name FROM entity WHERE id = ? AND status = 'active'")
      .bind(body.payment_entity_id)
      .first<{ id: number; entity_name: string }>();
    if (!entity) {
      return c.json({ success: false, error: { message: "payment entity not found or inactive" } }, 400);
    }

    const bankAccount = await c.env.DB.prepare(
      "SELECT id, entity_id, bank_name, account_no FROM entity_bank_account WHERE id = ? AND status = 'active'"
    )
      .bind(body.payment_entity_bank_account_id)
      .first<{ id: number; entity_id: number; bank_name: string; account_no: string }>();
    if (!bankAccount) {
      return c.json(
        { success: false, error: { message: "payment bank account not found or inactive" } },
        400
      );
    }
    if (bankAccount.entity_id !== body.payment_entity_id) {
      return c.json(
        { success: false, error: { message: "payment bank account does not belong to payment entity" } },
        400
      );
    }

    const vouchers = normalizePaymentVoucherInputs(body.payment_vouchers);

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    if (batch.status !== "approved") {
      return c.json({ success: false, error: { message: "Only approved batch can be marked as paid" } }, 400);
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{ success: boolean }>(
      c.env.DB,
      `reimbursement:batch-mark-paid:${id}`,
      auth.sub,
      idempotencyKey
    );
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload);
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Payment registration already in progress" } }, 409);
    }

    const now = nowIso();
    const paidAt = body.paid_at.trim();
    const paymentReference = body.payment_reference.trim();
    const paymentAccountText = `${entity.entity_name} / ${bankAccount.bank_name} / ${bankAccount.account_no}`;
    try {
      await runInTransaction(c.env.DB, async () => {
        const updateBatch = await c.env.DB.prepare(
          `UPDATE reimbursement_batch SET
             status = 'paid',
             paid_at = ?,
             payment_reference = ?,
             payment_account = ?,
             payment_entity_id = ?,
             payment_entity_bank_account_id = ?,
             payment_vouchers_json = ?,
             updated_at = ?
           WHERE id = ? AND status = 'approved'`
        )
          .bind(
            paidAt,
            paymentReference,
            body.payment_account?.trim() || paymentAccountText,
            body.payment_entity_id,
            body.payment_entity_bank_account_id,
            vouchers.length > 0 ? JSON.stringify(vouchers) : null,
            now,
            id
          )
          .run();

        if ((updateBatch.meta.changes ?? 0) !== 1) {
          throw new Error("Batch is no longer approved");
        }

        await c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET status = 'paid', updated_at = ? WHERE batch_id = ?"
        )
          .bind(now, id)
          .run();
      });
    } catch (error) {
      await abandonIdempotentRequest(c.env.DB, `reimbursement:batch-mark-paid:${id}`, auth.sub, idempotencyKey);
      throw error;
    }

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_PAID", "reimbursement_batch", {
      batch_id: id,
      batch_no: batch.batch_no,
      total_amount: batch.total_amount,
      paid_at: paidAt,
      payment_reference: paymentReference,
      payment_entity_id: body.payment_entity_id,
      payment_entity_bank_account_id: body.payment_entity_bank_account_id,
      paid_by_userid: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.mark_paid",
      targetType: "reimbursement_batch",
      targetId: id,
      detail: {
        batch_no: batch.batch_no,
        total_amount: batch.total_amount,
        paid_at: paidAt,
        payment_reference: paymentReference,
        payment_entity_id: body.payment_entity_id,
        payment_entity_bank_account_id: body.payment_entity_bank_account_id
      }
    });

    const payload = { success: true };
    await completeIdempotentRequest(
      c.env.DB,
      `reimbursement:batch-mark-paid:${id}`,
      auth.sub,
      idempotencyKey,
      200,
      payload
    );

    return c.json(payload);
  }
);

reimbursementRoutes.put(
  "/batch/:id/payout-plan",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as UpdateReimbursementBatchPayoutPlanRequest;
    const now = nowIso();
    const isSuperAdmin = auth.roles.includes("super_admin");

    const hasPayoutMutation =
      body.payment_method !== undefined ||
      body.payment_entity_id !== undefined ||
      body.payment_entity_bank_account_id !== undefined ||
      body.payment_account !== undefined ||
      body.payee_id !== undefined;

    if (!hasPayoutMutation) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "At least one payout field is required (payment_method/payment_entity_id/payment_entity_bank_account_id/payment_account/payee_id)"
          }
        },
        400
      );
    }

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    let approvalStatus: string | null = null;
    let hasCurrentApproverTask = false;
    if (!isSuperAdmin && batch.status === "pending_approval" && batch.approval_instance_id) {
      const approval = await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
        .bind(batch.approval_instance_id)
        .first<{ status: string }>();
      approvalStatus = approval?.status ?? null;

      const approvalInProgress = approvalStatus ? isApprovalActive(approvalStatus) : false;
      if (approvalInProgress) {
        const approverTask = await c.env.DB.prepare(
          `SELECT id FROM approval_task
             WHERE instance_id = ?
               AND assignee_userid = ?
               AND status IN ('pending', 'in_progress')
             ORDER BY id DESC LIMIT 1`
        )
          .bind(batch.approval_instance_id, auth.sub)
          .first<{ id: number }>();
        hasCurrentApproverTask = Boolean(approverTask);
      }
    }

    const payoutAccess = canUpdateBatchPayoutPlan({
      isSuperAdmin,
      batchStatus: batch.status,
      approvalInstanceId: batch.approval_instance_id,
      approvalStatus,
      hasCurrentApproverTask
    });
    if (!payoutAccess.allowed) {
      return c.json(
        {
          success: false,
          error: { message: payoutAccess.message }
        },
        400
      );
    }

    if (body.payee_id !== undefined && !isSuperAdmin) {
      return c.json(
        { success: false, error: { message: "Only super_admin can update batch payee_id" } },
        403
      );
    }

    const payoutPlan = await resolveReimbursementPayoutPlan(c.env, body, {
      payment_method: normalizePaymentMethodValue(batch.payment_method).normalized,
      payment_entity_id: batch.payment_entity_id,
      payment_entity_bank_account_id: batch.payment_entity_bank_account_id,
      payment_account: batch.payment_account
    });
    if ("error" in payoutPlan) {
      return c.json({ success: false, error: { message: payoutPlan.error } }, 400);
    }

    let payeeId = batch.payee_id;
    if (body.payee_id !== undefined) {
      if (!Number.isInteger(body.payee_id) || body.payee_id <= 0) {
        return c.json({ success: false, error: { message: "payee_id must be a positive integer" } }, 400);
      }
      const payeeRow = await c.env.DB.prepare(
        "SELECT id, type, status, linked_userid, created_by_userid FROM payee WHERE id = ?"
      )
        .bind(body.payee_id)
        .first<{
          id: number;
          type: string;
          status: string;
          linked_userid: string | null;
          created_by_userid: string;
        }>();
      if (!payeeRow || payeeRow.status !== "active") {
        return c.json({ success: false, error: { message: "payee_id not found or inactive" } }, 400);
      }
      if (payeeRow.type !== "internal") {
        return c.json(
          { success: false, error: { message: "payee_id must reference an internal payee" } },
          400
        );
      }
      const payeeBelongsToApplicant = payeeRow.linked_userid
        ? payeeRow.linked_userid === batch.applicant_userid
        : payeeRow.created_by_userid === batch.applicant_userid;
      if (!payeeBelongsToApplicant) {
        return c.json(
          { success: false, error: { message: "payee linked_userid does not match batch applicant" } },
          400
        );
      }
      payeeId = payeeRow.id;
    }

    await c.env.DB.prepare(
      `UPDATE reimbursement_batch
          SET payment_method = ?,
              payment_entity_id = ?,
              payment_entity_bank_account_id = ?,
              payment_account = ?,
              payee_id = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(
        payoutPlan.value.payment_method,
        payoutPlan.value.payment_entity_id,
        payoutPlan.value.payment_entity_bank_account_id,
        payoutPlan.value.payment_account,
        payeeId,
        now,
        id
      )
      .run();

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.update_payout_plan",
      targetType: "reimbursement_batch",
      targetId: id,
      detail: {
        payment_method: payoutPlan.value.payment_method,
        payment_entity_id: payoutPlan.value.payment_entity_id,
        payment_entity_bank_account_id: payoutPlan.value.payment_entity_bank_account_id,
        payment_account: payoutPlan.value.payment_account,
        payee_id: payeeId
      }
    });

    return c.json({ success: true, data: { ...payoutPlan.value, payee_id: payeeId } });
  }
);

reimbursementRoutes.put(
  "/batch/:id/payment-vouchers",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body =
      (await c.req.json().catch(() => ({}))) as UpdateReimbursementBatchPaymentVouchersRequest;

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();
    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    const vouchers = normalizePaymentVoucherInputs(body.payment_vouchers);

    await c.env.DB.prepare(
      `UPDATE reimbursement_batch
          SET payment_vouchers_json = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(vouchers.length > 0 ? JSON.stringify(vouchers) : null, nowIso(), id)
      .run();

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.update_payment_vouchers",
      targetType: "reimbursement_batch",
      targetId: id,
      detail: {
        voucher_count: vouchers.length
      }
    });

    return c.json({ success: true, data: { payment_vouchers: vouchers } });
  }
);

reimbursementRoutes.put(
  "/batch/:id/items/:envelopeId/basic-info",
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const envelopeId = Number(c.req.param("envelopeId"));
    const body =
      (await c.req.json().catch(() => ({}))) as UpdateReimbursementBatchItemBasicInfoRequest;

    const hasBasicMutation =
      body.invoice_no !== undefined ||
      body.expense_date !== undefined ||
      body.amount !== undefined ||
      body.category !== undefined ||
      body.description !== undefined;
    if (!hasBasicMutation) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "At least one basic field is required (invoice_no/expense_date/amount/category/description)"
          }
        },
        400
      );
    }

    if (body.amount !== undefined && (typeof body.amount !== "number" || body.amount < 0)) {
      return c.json({ success: false, error: { message: "amount must be a non-negative number" } }, 400);
    }

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();
    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    const boundItem = await c.env.DB.prepare(
      `SELECT bi.id AS batch_item_id, e.id, e.project_id, e.applicant_userid, e.invoice_no,
              e.expense_date, e.amount, e.category, e.description
         FROM reimbursement_batch_item bi
         JOIN reimbursement_envelope e ON e.id = bi.envelope_id
        WHERE bi.batch_id = ?
          AND bi.envelope_id = ?
          AND bi.status = 'active'
        LIMIT 1`
    )
      .bind(id, envelopeId)
      .first<{
        batch_item_id: number;
        id: number;
        project_id: number;
        applicant_userid: string;
        invoice_no: string | null;
        expense_date: string | null;
        amount: number;
        category: string | null;
        description: string | null;
      }>();

    if (!boundItem) {
      return c.json({ success: false, error: { message: "Envelope is not part of this batch" } }, 404);
    }

    const nextInvoiceNo = body.invoice_no === undefined ? boundItem.invoice_no : body.invoice_no?.trim() || null;
    const nextExpenseDate =
      body.expense_date === undefined ? boundItem.expense_date : body.expense_date?.trim() || null;
    const nextAmount = body.amount === undefined ? boundItem.amount : body.amount;
    const nextCategory = body.category === undefined ? boundItem.category : body.category?.trim() || null;
    const nextDescription =
      body.description === undefined ? boundItem.description : body.description?.trim() || null;

    const now = nowIso();
    await runInTransaction(c.env.DB, async () => {
      await c.env.DB.prepare(
        `UPDATE reimbursement_envelope
            SET invoice_unique_no = ?,
                invoice_no = ?,
                expense_date = ?,
                amount = ?,
                category = ?,
                description = ?,
                updated_at = ?
          WHERE id = ?`
      )
        .bind(
          sanitizeInvoiceUniqueNo(nextInvoiceNo),
          nextInvoiceNo,
          nextExpenseDate,
          nextAmount,
          nextCategory,
          nextDescription,
          now,
          envelopeId
        )
        .run();

      await c.env.DB.prepare(
        `UPDATE reimbursement_batch_item
            SET amount = ?
          WHERE batch_id = ? AND envelope_id = ?`
      )
        .bind(nextAmount, id, envelopeId)
        .run();

      const totalRow = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*) AS item_count
           FROM reimbursement_batch_item
          WHERE batch_id = ?
            AND status = 'active'`
      )
        .bind(id)
        .first<{ total_amount: number; item_count: number }>();

      await c.env.DB.prepare(
        `UPDATE reimbursement_batch
            SET total_amount = ?,
                item_count = ?,
                updated_at = ?
          WHERE id = ?`
      )
        .bind(totalRow?.total_amount ?? 0, totalRow?.item_count ?? 0, now, id)
        .run();
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.batch.update_item_basic_info",
      targetType: "reimbursement_batch",
      targetId: id,
      detail: {
        envelope_id: envelopeId,
        invoice_no: nextInvoiceNo,
        expense_date: nextExpenseDate,
        amount: nextAmount,
        category: nextCategory
      }
    });

    return c.json({
      success: true,
      data: {
        envelope_id: envelopeId,
        invoice_no: nextInvoiceNo,
        expense_date: nextExpenseDate,
        amount: nextAmount,
        category: nextCategory,
        description: nextDescription
      }
    });
  }
);

type ReusableElectronicDraft = {
  id: number;
  envelope_no: string;
  envelope_uuid: string;
};

/**
 * Returns the envelope only when it is a reusable, in-place-updatable
 * electronic draft owned by the caller (or accessible to an office role).
 * Any other case (missing / wrong channel / already submitted / not owned)
 * returns null so the caller falls back to creating a fresh envelope —
 * distinct reimbursement records are never silently merged.
 */
export const resolveReusableElectronicDraft = async (
  db: D1Database,
  envelopeId: number | undefined,
  auth: { sub: string; roles: string[] }
): Promise<ReusableElectronicDraft | null> => {
  if (!envelopeId || envelopeId <= 0) return null;
  const envelope = await db
    .prepare(
      `SELECT id, envelope_no, envelope_uuid, applicant_userid, channel, status
         FROM reimbursement_envelope WHERE id = ?`
    )
    .bind(envelopeId)
    .first<{
      id: number;
      envelope_no: string;
      envelope_uuid: string;
      applicant_userid: string;
      channel: string;
      status: string;
    }>();
  if (!envelope) return null;
  if (envelope.channel !== "electronic") return null;
  if (envelope.status !== "draft" && envelope.status !== "unregistered") return null;
  if (!hasOfficeRole(auth.roles) && envelope.applicant_userid !== auth.sub) return null;
  return {
    id: envelope.id,
    envelope_no: envelope.envelope_no,
    envelope_uuid: envelope.envelope_uuid
  };
};

reimbursementRoutes.post(
  "/electronic-upload",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as ElectronicUploadRequest;
    const idempotencyKey = c.req.header("Idempotency-Key");

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!body.file_key?.trim()) {
      return c.json({ success: false, error: { message: "file_key is required" } }, 400);
    }

    const idempotencyScope = `reimbursement:electronic-upload:${body.project_id}:${body.file_key}`;
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { id: number; envelope_no: string; envelope_uuid: string; ocr_task_id: number | null };
    }>(c.env.DB, idempotencyScope, auth.sub, idempotencyKey);

    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 201 });
    }
    if (idempotency.kind === "pending") {
      return c.json(
        { success: false, error: { message: "Electronic upload already in progress" } },
        409
      );
    }

    try {
      const now = nowIso();

      // In-place replace: when the caller passes one of their own unsubmitted
      // electronic drafts, swap its invoice attachment instead of creating a
      // new envelope. This is what stops re-uploads on an active draft from
      // spawning duplicate drafts. resolveReusableElectronicDraft is the safety
      // gate — anything not the caller's own electronic draft returns null and
      // falls through to create-new below.
      const reusableDraft = await resolveReusableElectronicDraft(c.env.DB, body.envelope_id, auth);
      if (reusableDraft) {
        await c.env.DB.prepare(
          "UPDATE envelope_attachment SET status = 'deleted' WHERE envelope_id = ? AND status = 'active'"
        )
          .bind(reusableDraft.id)
          .run();

        await insertAttachments(c.env.DB, reusableDraft.id, [
          {
            attachment_type: "invoice",
            file_key: body.file_key,
            file_name: body.file_name,
            file_size: body.file_size,
            invoice_no: body.invoice_no,
            amount: body.amount,
            issue_date: body.issue_date
          }
        ]);

        await c.env.DB.prepare(
          `UPDATE reimbursement_envelope SET
             invoice_unique_no = ?, invoice_no = ?, expense_date = ?, amount = ?,
             description = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(
            sanitizeInvoiceUniqueNo(body.invoice_no),
            body.invoice_no ?? null,
            body.issue_date ?? null,
            body.amount ?? 0,
            body.description ?? null,
            now,
            reusableDraft.id
          )
          .run();

        const reusePayload = {
          success: true as const,
          data: {
            id: reusableDraft.id,
            envelope_no: reusableDraft.envelope_no,
            envelope_uuid: reusableDraft.envelope_uuid,
            ocr_task_id: null
          }
        };

        await completeIdempotentRequest(
          c.env.DB,
          idempotencyScope,
          auth.sub,
          idempotencyKey,
          200,
          reusePayload
        );

        return c.json(reusePayload, 200);
      }

      const envelopeUuid = crypto.randomUUID();
      const envelopeNo = envelopeUuid;

      const insertResult = await c.env.DB.prepare(
        `INSERT INTO reimbursement_envelope
          (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
           invoice_unique_no, invoice_no, expense_date, amount, description,
           status, precheck_status, verification_status, ocr_status,
           duplicate_check_status, received_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'electronic', ?, ?, ?, ?, ?, 'draft', 'none', 'pending', 'none', 'none', NULL, ?, ?)`
      )
        .bind(
          envelopeNo,
          envelopeUuid,
          body.project_id,
          body.applicant_userid ?? auth.sub,
          sanitizeInvoiceUniqueNo(body.invoice_no),
          body.invoice_no ?? null,
          body.issue_date ?? null,
          body.amount ?? 0,
          body.description ?? null,
          now,
          now
        )
        .run();

      const envelopeId = insertResult.meta.last_row_id as number;

      await insertAttachments(c.env.DB, envelopeId, [
        {
          attachment_type: "invoice",
          file_key: body.file_key,
          file_name: body.file_name,
          file_size: body.file_size,
          invoice_no: body.invoice_no,
          amount: body.amount,
          issue_date: body.issue_date
        }
      ]);

      const payload = {
        success: true as const,
        data: {
          id: envelopeId,
          envelope_no: envelopeNo,
          envelope_uuid: envelopeUuid,
          ocr_task_id: null
        }
      };

      await completeIdempotentRequest(
        c.env.DB,
        idempotencyScope,
        auth.sub,
        idempotencyKey,
        201,
        payload
      );

      return c.json(payload, 201);
    } catch (err) {
      await abandonIdempotentRequest(c.env.DB, idempotencyScope, auth.sub, idempotencyKey);
      throw err;
    }
  }
);

reimbursementRoutes.get("/:id/ocr-status", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");
  const envelope = await assertEnvelopeAccess(c.env, id, auth);

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  let latestReviewRound = 0;
  if (await supportsInvoiceReviewTable(c.env)) {
    try {
      const reviewRoundRow = await c.env.DB.prepare(
        "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
      )
        .bind(id)
        .first<{ max_round: number | null }>();
      latestReviewRound = Number(reviewRoundRow?.max_round ?? 0);
    } catch (error) {
      if (!isMissingInvoiceReviewTableError(error)) {
        throw error;
      }
      latestReviewRound = 0;
    }
  }
  if (latestReviewRound > 0) {
    await syncEnvelopeAuditState(c.env, id);
    const latestEnvelope = await c.env.DB.prepare(
      "SELECT ocr_status, ocr_result_json FROM reimbursement_envelope WHERE id = ?"
    )
      .bind(id)
      .first<{ ocr_status: string; ocr_result_json: string | null }>();
    const duplicateRow = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM reimbursement_duplicate_check WHERE envelope_id = ?"
    )
      .bind(id)
      .first<{ cnt: number }>();
    const latestTask = await c.env.DB.prepare(
      `SELECT task_id FROM reimbursement_invoice_review
       WHERE envelope_id = ? AND review_round = ?
       ORDER BY id DESC LIMIT 1`
    )
      .bind(id, latestReviewRound)
      .first<{ task_id: number | null }>();

    return c.json({
      success: true,
      data: {
        status: latestEnvelope?.ocr_status ?? envelope.ocr_status,
        task_id: latestTask?.task_id ?? envelope.ocr_task_id,
        result: filterTaskResultForViewer(auth, parseStoredJson(latestEnvelope?.ocr_result_json ?? envelope.ocr_result_json)),
        duplicate_count: duplicateRow?.cnt ?? 0
      }
    });
  }

  if (!envelope.ocr_task_id) {
    return c.json({
      success: true,
      data: {
        status: envelope.ocr_status,
        task_id: null,
        result: null,
        duplicate_count: 0
      }
    });
  }

  const task = await c.env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
    .bind(envelope.ocr_task_id)
    .first<{ status: string; result_json: string | null }>();
  const result = parseTaskResult(task?.result_json ?? null);

  let duplicateCount = 0;

  if (task?.status === "completed" && envelope.ocr_status !== "completed") {
    const hints = extractInvoiceRecognitionHints(result);

    const nextStatus =
      envelope.status === "received"
        ? "received"
        : envelope.status === "draft" || envelope.status === "unregistered"
          ? envelope.status
          : "submitted";

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         ocr_status = 'completed',
         ocr_result_json = ?,
         ocr_invoice_unique_no_hint = ?,
         ocr_invoice_no_hint = ?,
         ocr_expense_date_hint = ?,
         status = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        hints.result_json,
        hints.invoice_unique_no,
        hints.invoice_no,
        hints.expense_date,
        nextStatus,
        nowIso(),
        id
      )
      .run();

    duplicateCount = await applyDuplicateChecks(c.env, id, hints);
  }

  if ((task?.status === "failed" || task?.status === "timeout") && envelope.ocr_status !== "failed") {
    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET ocr_status = 'failed', duplicate_check_status = 'failed', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();
  }

  if (task?.status === "completed" && duplicateCount === 0) {
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM reimbursement_duplicate_check WHERE envelope_id = ?"
    )
      .bind(id)
      .first<{ cnt: number }>();
    duplicateCount = row?.cnt ?? 0;
  }

  return c.json({
    success: true,
    data: {
      status:
        task?.status === "completed"
          ? "completed"
          : task?.status === "failed" || task?.status === "timeout"
            ? "failed"
            : envelope.ocr_status,
      task_id: envelope.ocr_task_id,
      result: filterTaskResultForViewer(auth, result),
      duplicate_count: duplicateCount
    }
  });
});

reimbursementRoutes.post(
  "/:id/trigger-anomaly-check",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const idempotencyKey = c.req.header("Idempotency-Key");
    const body = (await c.req.json().catch(() => ({}))) as {
      rerun_full?: boolean;
      reason?: string;
    };
    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { task_id: number | null; precheck_status: string; rerun_full?: boolean; review_round?: number };
    }>(
      c.env.DB,
      `reimbursement:rerun-silent-review:${id}`,
      auth.sub,
      idempotencyKey
    );
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 200 });
    }
    if (idempotency.kind === "pending") {
      return c.json(
        { success: false, error: { message: "Silent review rerun already in progress" } },
        409
      );
    }

    try {
      await enqueueEnvelopeAiAudit(c.env, id, {
        forceRerun: body.rerun_full !== false,
        triggeredBy: auth.sub,
        reason: body.reason?.trim() || "manual_office_silent_review"
      });

      const latestTask = await c.env.DB.prepare(
        `SELECT id FROM task_queue
         WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
         ORDER BY id DESC LIMIT 1`
      )
        .bind(id)
        .first<{ id: number }>();

      let latestReviewRound = 0;
      if (await supportsInvoiceReviewTable(c.env)) {
        try {
          const roundRow = await c.env.DB.prepare(
            "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
          )
            .bind(id)
            .first<{ max_round: number | null }>();
          latestReviewRound = Number(roundRow?.max_round ?? 0);
        } catch (error) {
          if (!isMissingInvoiceReviewTableError(error)) {
            throw error;
          }
          latestReviewRound = 0;
        }
      }

      await c.env.DB.prepare(
        "UPDATE reimbursement_envelope SET precheck_status = 'pending', duplicate_check_status = 'pending', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), id)
        .run();

      const payload = {
        success: true,
        data: {
          task_id: latestTask?.id ?? null,
          precheck_status: "pending",
          rerun_full: body.rerun_full !== false,
          review_round: latestReviewRound || undefined
        }
      };
      await completeIdempotentRequest(
        c.env.DB,
        `reimbursement:rerun-silent-review:${id}`,
        auth.sub,
        idempotencyKey,
        200,
        payload
      );
      return c.json(payload);
    } catch (error) {
      await abandonIdempotentRequest(
        c.env.DB,
        `reimbursement:rerun-silent-review:${id}`,
        auth.sub,
        idempotencyKey
      );
      throw error;
    }
  }
);

reimbursementRoutes.get("/:id/anomaly-status", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");

  const envelope = await assertEnvelopeAccess(c.env, id, auth);

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  const task = await c.env.DB.prepare(
    `SELECT id, status, result_json FROM task_queue
     WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
     ORDER BY id DESC LIMIT 1`
  )
    .bind(id)
    .first<{ id: number; status: string; result_json: string | null }>();

  return c.json({
    success: true,
    data: {
      task_id: task?.id ?? null,
      status: task?.status ?? "none",
      precheck_status: envelope.precheck_status,
      result: filterTaskResultForViewer(auth, parseTaskResult(task?.result_json ?? null))
    }
  });
});

reimbursementRoutes.post(
  "/:id/precheck",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as PrecheckEnvelopeRequest;

    if (!["approved", "supplement", "rejected"].includes(body.action)) {
      return c.json(
        { success: false, error: { message: "action must be approved/supplement/rejected" } },
        400
      );
    }

    const envelope = await c.env.DB.prepare(
      `SELECT id, status, duplicate_check_status, duplicate_override_requested, applicant_userid,
              channel, ocr_result_json, ocr_invoice_unique_no_hint
         FROM reimbursement_envelope
        WHERE id = ? AND status != 'deleted'`
    )
      .bind(id)
      .first<{
        id: number;
        status: string;
        duplicate_check_status: string;
        duplicate_override_requested: number;
        applicant_userid: string;
        channel: string;
        ocr_result_json: string | null;
        ocr_invoice_unique_no_hint: string | null;
      }>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const canSelfAudit = auth.roles.includes("super_admin") || auth.roles.includes("finance");
    if (envelope.applicant_userid === auth.sub && !canSelfAudit) {
      return c.json(
        { success: false, error: { message: "Applicant cannot precheck their own reimbursement envelope" } },
        403
      );
    }

    if (body.action === "approved") {
      if (envelope.duplicate_check_status !== "completed") {
        const latestAuditTask = await c.env.DB.prepare(
          `SELECT id, status FROM task_queue
           WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
           ORDER BY id DESC LIMIT 1`
        )
          .bind(id)
          .first<{ id: number; status: string }>();

        const runningStatuses = new Set(["pending", "assigned", "running"]);
        const hasRunningAudit =
          latestAuditTask?.status && runningStatuses.has(latestAuditTask.status);

        if (!hasRunningAudit) {
          const latestAttachment = await c.env.DB.prepare(
            `SELECT file_key FROM envelope_attachment
             WHERE envelope_id = ? AND status = 'active'
             ORDER BY id DESC LIMIT 1`
          )
            .bind(id)
            .first<{ file_key: string | null }>();
          await enqueueEnvelopeAiAudit(c.env, id, {
            file_key: latestAttachment?.file_key ?? null
          });
        }

        return c.json(
          {
            success: false,
            error: { message: "Duplicate audit is mandatory before precheck approval" },
            data: {
              wait_for_audit: true,
              audit_triggered: !hasRunningAudit,
              task_id: latestAuditTask?.id ?? null
            }
          },
          409
        );
      }
      const duplicateRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM reimbursement_duplicate_check WHERE envelope_id = ?"
      )
        .bind(id)
        .first<{ cnt: number }>();
      const duplicateCount = duplicateRow?.cnt ?? 0;
      if (duplicateCount > 0 && envelope.duplicate_override_requested !== 1) {
        return c.json(
          {
            success: false,
            error: {
              message: "Duplicate risk exists. Applicant insist-submit is required before office can approve precheck"
            }
          },
          400
        );
      }

      const einvoice = detectEInvoiceInPhysical({
        channel: envelope.channel,
        ocrResultJson: envelope.ocr_result_json,
        invoiceUniqueNoHint: envelope.ocr_invoice_unique_no_hint
      });
      if (einvoice.detected) {
        const overrideReason =
          typeof body.override_einvoice_reason === "string"
            ? body.override_einvoice_reason.trim()
            : "";
        const canOverride =
          auth.roles.includes("super_admin") || auth.roles.includes("finance");
        if (!overrideReason || !canOverride) {
          return c.json(
            {
              success: false,
              error: {
                message:
                  "Electronic invoice detected in a physical envelope. Reject the precheck and ask the applicant to resubmit via the electronic channel, or override with a reason (finance/super_admin only)."
              },
              data: {
                einvoice_in_physical: true,
                matched_invoice_nos: einvoice.matchedNumbers
              }
            },
            400
          );
        }
        await writeAuditLog(c.env.DB, {
          actorUserId: auth.sub,
          actorRoles: auth.roles,
          action: "reimbursement.envelope.precheck_einvoice_override",
          targetType: "reimbursement_envelope",
          targetId: id,
          detail: {
            reason: overrideReason,
            matched_invoice_nos: einvoice.matchedNumbers
          }
        });
      }
    }

    if (envelope.status === "cancelled") {
      return c.json(
        {
          success: false,
          error: { message: "Cancelled envelope cannot be prechecked" }
        },
        400
      );
    }

    const nextStatus = body.action === "approved" ? "received" : "submitted";

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         precheck_status = ?,
         precheck_comment = ?,
         status = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(body.action, body.comment ?? null, nextStatus, nowIso(), id)
      .run();

    return c.json({
      success: true,
      data: { id, precheck_status: body.action, status: nextStatus }
    });
  }
);

reimbursementRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");
  await syncEnvelopeAuditState(c.env, id);
  const envelope = await assertEnvelopeAccess(c.env, id, auth);

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  const attachments = await c.env.DB.prepare(
    "SELECT * FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id DESC"
  )
    .bind(id)
    .all<EnvelopeAttachment>();

  const duplicates = await c.env.DB.prepare(
    "SELECT * FROM reimbursement_duplicate_check WHERE envelope_id = ? ORDER BY id DESC"
  )
    .bind(id)
    .all<ReimbursementDuplicateCheck>();

  const batch = envelope.batch_id
    ? await c.env.DB.prepare(
        "SELECT id, batch_no, project_id, applicant_userid, total_amount, item_count, status FROM reimbursement_batch WHERE id = ?"
      )
        .bind(envelope.batch_id)
        .first()
    : null;

  return c.json({
    success: true,
    data: {
      ...envelope,
      attachments: attachments.results ?? [],
      duplicate_checks: duplicates.results ?? [],
      batch
    }
  });
});

reimbursementRoutes.get("/resolve/by-uuid", async (c) => {
  const auth = c.get("auth");
  const envelopeUuid = c.req.query("envelope_uuid")?.trim();
  if (!envelopeUuid) {
    return c.json({ success: false, error: { message: "envelope_uuid is required" } }, 400);
  }

  const envelope = await c.env.DB.prepare(
    "SELECT id, envelope_no, envelope_uuid, status, applicant_userid FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
  )
    .bind(envelopeUuid)
    .first<
      Pick<
        ReimbursementEnvelope,
        "id" | "envelope_no" | "envelope_uuid" | "status" | "applicant_userid"
      >
    >();

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  const isUnassignedEnvelope =
    envelope.applicant_userid === UNASSIGNED_APPLICANT || envelope.status === "unregistered";
  if (!hasOfficeRole(auth.roles) && envelope.applicant_userid !== auth.sub && !isUnassignedEnvelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  return c.json({
    success: true,
    data: {
      ...envelope,
      registered: envelope.applicant_userid !== UNASSIGNED_APPLICANT && envelope.status !== "unregistered"
    }
  });
});

reimbursementRoutes.post(
  "/:id/rebind-uuid",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as RebindEnvelopeUuidRequest;
    const nextUuid = body.envelope_uuid?.trim();
    const reason = body.reason?.trim();

    if (!nextUuid) {
      return c.json({ success: false, error: { message: "envelope_uuid is required" } }, 400);
    }
    if (!isValidUuid(nextUuid)) {
      return c.json({ success: false, error: { message: "envelope_uuid must be a valid UUID" } }, 400);
    }
    if (!reason) {
      return c.json({ success: false, error: { message: "reason is required" } }, 400);
    }

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }
    if (envelope.channel !== "physical") {
      return c.json({ success: false, error: { message: "Only physical envelopes support UUID rebind" } }, 400);
    }
    if (!["draft", "submitted", "received", "unregistered"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${envelope.status} cannot rebind UUID` }
        },
        400
      );
    }

    if (nextUuid === envelope.envelope_uuid) {
      return c.json({
        success: true,
        data: {
          id: envelope.id,
          envelope_uuid: envelope.envelope_uuid,
          envelope_no: envelope.envelope_no,
          unchanged: true
        }
      });
    }

    const occupied = await c.env.DB.prepare(
      "SELECT id, status, applicant_userid FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
    )
      .bind(nextUuid)
      .first<{ id: number; status: string; applicant_userid: string }>();

    let swappedPlaceholderId: number | null = null;
    const now = nowIso();

    if (occupied && occupied.id !== envelope.id) {
      const canSwapPlaceholder =
        (occupied.status === "unregistered" || occupied.applicant_userid === UNASSIGNED_APPLICANT) &&
        !["batched", "pending_approval", "approved", "paid"].includes(occupied.status);
      if (!canSwapPlaceholder) {
        return c.json(
          {
            success: false,
            error: { message: "Target UUID is already occupied by an active envelope" }
          },
          409
        );
      }

      const occupiedAttachmentRow = await c.env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM envelope_attachment WHERE envelope_id = ? AND status = 'active'"
      )
        .bind(occupied.id)
        .first<{ cnt: number }>();
      if ((occupiedAttachmentRow?.cnt ?? 0) > 0) {
        return c.json(
          {
            success: false,
            error: { message: "Target UUID is attached to an envelope with active attachments" }
          },
          409
        );
      }

      const tempUuid = crypto.randomUUID();
      await runInTransaction(c.env.DB, async () => {
        await c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        )
          .bind(tempUuid, tempUuid, now, occupied.id)
          .run();

        await c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        )
          .bind(nextUuid, nextUuid, now, envelope.id)
          .run();

        await c.env.DB.prepare(
          "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
        )
          .bind(envelope.envelope_uuid, envelope.envelope_uuid, now, occupied.id)
          .run();
      });
      swappedPlaceholderId = occupied.id;
    } else {
      await c.env.DB.prepare(
        "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?"
      )
        .bind(nextUuid, nextUuid, now, envelope.id)
        .run();
    }

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_UUID_REBOUND", "reimbursement_envelope", {
      envelope_id: envelope.id,
      old_uuid: envelope.envelope_uuid,
      new_uuid: nextUuid,
      swapped_placeholder_id: swappedPlaceholderId,
      reason,
      rebound_by: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.envelope.rebind_uuid",
      targetType: "reimbursement_envelope",
      targetId: envelope.id,
      detail: {
        old_uuid: envelope.envelope_uuid,
        new_uuid: nextUuid,
        swapped_placeholder_id: swappedPlaceholderId,
        reason
      }
    });

    return c.json({
      success: true,
      data: {
        id: envelope.id,
        envelope_uuid: nextUuid,
        envelope_no: nextUuid,
        swapped_placeholder_id: swappedPlaceholderId
      }
    });
  }
);

reimbursementRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateEnvelopeRequest;
    const idempotencyKey = c.req.header("Idempotency-Key");

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }

    const now = nowIso();
    const requestedApplicant = body.applicant_userid ?? auth.sub;
    const requestedChannel = body.channel ?? "physical";
    const preferredEnvelopeUuid = body.preferred_envelope_uuid?.trim();
    const generatedEnvelopeUuid = crypto.randomUUID();

    if (!validChannelSet.has(requestedChannel)) {
      return c.json({ success: false, error: { message: "Invalid reimbursement channel" } }, 400);
    }

    if (requestedChannel === "electronic" && preferredEnvelopeUuid) {
      return c.json(
        {
          success: false,
          error: { message: "Electronic reimbursement cannot bind preferred envelope UUID" }
        },
        400
      );
    }

    if (requestedChannel === "physical" && !preferredEnvelopeUuid) {
      return c.json(
        {
          success: false,
          error: { message: "Physical reimbursement requires envelope UUID input or scan before create" }
        },
        400
      );
    }
    if (requestedChannel === "physical" && !isValidUuid(preferredEnvelopeUuid)) {
      return c.json(
        {
          success: false,
          error: { message: "Physical reimbursement UUID must be a valid UUID format" }
        },
        400
      );
    }
    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );

    let existingEnvelope: Pick<
      ReimbursementEnvelope,
      "id" | "status" | "applicant_userid" | "channel" | "envelope_uuid"
    > | null = null;

    if (preferredEnvelopeUuid) {
      existingEnvelope = await c.env.DB.prepare(
        "SELECT * FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
      )
        .bind(preferredEnvelopeUuid)
        .first<ReimbursementEnvelope>();
    }

    const decision = decideCreateRouteBranch({
      authSub: auth.sub,
      isPrivileged,
      requestedApplicant,
      requestedChannel,
      preferredEnvelopeUuid,
      generatedEnvelopeUuid,
      unassignedApplicant: UNASSIGNED_APPLICANT,
      existingEnvelope: existingEnvelope ?? undefined
    });

    if (decision.kind === "error") {
      return c.json({ success: false, error: { message: decision.message } }, decision.status);
    }

    // Idempotency guard: the web client sends an Idempotency-Key and its HTTP
    // layer transparently re-sends the same POST on network/timeout fallback
    // (utils/http retryWithRelay). Without this guard a create that already
    // succeeded server-side but timed out client-side produces a duplicate
    // draft envelope. Keyed per actor so replays return the original payload.
    const idempotencyScope = `reimbursement:create:${auth.sub}`;
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: { id: number; envelope_no: string; envelope_uuid: string };
    }>(c.env.DB, idempotencyScope, auth.sub, idempotencyKey);

    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 201 });
    }
    if (idempotency.kind === "pending") {
      return c.json(
        { success: false, error: { message: "Reimbursement create already in progress" } },
        409
      );
    }

    try {
      if (decision.kind === "bind-existing") {
        await c.env.DB.prepare(
          `UPDATE reimbursement_envelope SET
             envelope_no = ?,
             project_id = COALESCE(?, project_id),
             applicant_userid = ?,
             channel = ?,
             invoice_unique_no = COALESCE(?, invoice_unique_no),
             invoice_no = COALESCE(?, invoice_no),
             expense_date = COALESCE(?, expense_date),
             amount = COALESCE(?, amount),
             category = COALESCE(?, category),
             description = COALESCE(?, description),
             status = ?,
             updated_at = ?
           WHERE id = ?`
        )
          .bind(
            decision.envelopeNo,
            body.project_id ?? null,
            decision.applicantToPersist,
            decision.channelToPersist,
            sanitizeInvoiceUniqueNo(body.invoice_no),
            body.invoice_no ?? null,
            body.expense_date ?? null,
            body.amount ?? null,
            body.category ?? null,
            body.description ?? null,
            decision.nextStatus,
            now,
            decision.envelopeId
          )
          .run();

        await insertAttachments(c.env.DB, decision.envelopeId, body.attachments);

        await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_CREATED", "reimbursement_envelope", {
          envelope_id: decision.envelopeId,
          envelope_no: decision.envelopeNo,
          envelope_uuid: decision.envelopeUuid,
          created_by: auth.sub,
          bound_existing: true
        });

        const payload = {
          success: true as const,
          data: {
            id: decision.envelopeId,
            envelope_no: decision.envelopeNo,
            envelope_uuid: decision.envelopeUuid
          }
        };
        await completeIdempotentRequest(
          c.env.DB,
          idempotencyScope,
          auth.sub,
          idempotencyKey,
          201,
          payload
        );
        return c.json(payload, 201);
      }

      const envelopeUuid = decision.envelopeUuid;
      const envelopeNo = decision.envelopeNo;

      const result = await c.env.DB.prepare(
        `INSERT INTO reimbursement_envelope
          (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
           invoice_unique_no, invoice_no, expense_date, amount, category, description,
           status, precheck_status, verification_status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', 'pending', ?, ?)`
      )
        .bind(
          envelopeNo,
          envelopeUuid,
          body.project_id,
          requestedApplicant,
          requestedChannel,
          sanitizeInvoiceUniqueNo(body.invoice_no),
          body.invoice_no ?? null,
          body.expense_date ?? null,
          body.amount ?? 0,
          body.category ?? null,
          body.description ?? null,
          now,
          now
        )
        .run();

      const envelopeId = result.meta.last_row_id as number;
      await insertAttachments(c.env.DB, envelopeId, body.attachments);

      await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_CREATED", "reimbursement_envelope", {
        envelope_id: envelopeId,
        envelope_no: envelopeNo,
        envelope_uuid: envelopeUuid,
        created_by: auth.sub
      });

      const payload = {
        success: true as const,
        data: { id: envelopeId, envelope_no: envelopeNo, envelope_uuid: envelopeUuid }
      };
      await completeIdempotentRequest(
        c.env.DB,
        idempotencyScope,
        auth.sub,
        idempotencyKey,
        201,
        payload
      );
      return c.json(payload, 201);
    } catch (err) {
      await abandonIdempotentRequest(c.env.DB, idempotencyScope, auth.sub, idempotencyKey);
      throw err;
    }
  }
);

reimbursementRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as UpdateEnvelopeRequest;

    const existing = await c.env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!existing || existing.status === "deleted") {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );

    if (!isPrivileged && existing.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    const immutableStatuses = ["batched", "pending_approval", "approved", "paid"];
    const isReceivedLocked = existing.status === "received" && !isPrivileged;
    if (immutableStatuses.includes(existing.status) || isReceivedLocked) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${existing.status} cannot be modified` }
        },
        400
      );
    }

    if (body.channel && !validChannelSet.has(body.channel)) {
      return c.json({ success: false, error: { message: "Invalid reimbursement channel" } }, 400);
    }

    if (body.channel && body.channel !== existing.channel) {
      return c.json(
        {
          success: false,
          error: { message: "Envelope channel cannot be changed after creation" }
        },
        400
      );
    }

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         project_id = COALESCE(?, project_id),
         applicant_userid = COALESCE(?, applicant_userid),
         channel = COALESCE(?, channel),
         invoice_unique_no = COALESCE(?, invoice_unique_no),
         invoice_no = COALESCE(?, invoice_no),
         expense_date = COALESCE(?, expense_date),
         amount = COALESCE(?, amount),
         category = COALESCE(?, category),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.project_id ?? null,
        body.applicant_userid ?? null,
        body.channel ?? null,
        sanitizeInvoiceUniqueNo(body.invoice_no),
        body.invoice_no ?? null,
        body.expense_date ?? null,
        body.amount ?? null,
        body.category ?? null,
        body.description ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    if (body.attachments && body.attachments.length > 0) {
      await insertAttachments(c.env.DB, id, body.attachments);
      const latestFileKey = body.attachments.find(item => item.file_key?.trim())?.file_key ?? null;
      await enqueueEnvelopeAiAudit(c.env, id, { file_key: latestFileKey });
    }

    return c.json({ success: true });
  }
);

reimbursementRoutes.post(
  "/:id/attachments/:attachmentId/delete",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));
    const auth = c.get("auth");

    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return c.json({ success: false, error: { message: "attachmentId is required" } }, 400);
    }

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );
    if (!isPrivileged && envelope.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    if (!["draft", "unregistered"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Attachments can only be removed before submit. Current status: ${envelope.status}` }
        },
        400
      );
    }

    const attachment = await c.env.DB.prepare(
      "SELECT id, file_key, status FROM envelope_attachment WHERE id = ? AND envelope_id = ?"
    )
      .bind(attachmentId, id)
      .first<{ id: number; file_key: string; status: string }>();

    if (!attachment || attachment.status !== "active") {
      return c.json({ success: false, error: { message: "Attachment not found" } }, 404);
    }

    await c.env.DB.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?")
      .bind(attachmentId)
      .run();

    return c.json({ success: true, data: { id, attachment_id: attachmentId } });
  }
);

reimbursementRoutes.post(
  "/batch-generate",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as BatchGenerateEnvelopeRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!body.count || body.count < 1 || body.count > 200) {
      return c.json({ success: false, error: { message: "count must be between 1 and 200" } }, 400);
    }

    const now = nowIso();
    const generated: { id: number; envelope_no: string; envelope_uuid: string }[] = [];

    for (let i = 0; i < body.count; i += 1) {
      const envelopeUuid = crypto.randomUUID();
      const envelopeNo = envelopeUuid;

      const result = await c.env.DB.prepare(
        `INSERT INTO reimbursement_envelope
          (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
           status, precheck_status, verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'physical', 'unregistered', 'none', 'pending', ?, ?)`
      )
        .bind(envelopeNo, envelopeUuid, body.project_id, UNASSIGNED_APPLICANT, now, now)
        .run();

      generated.push({
        id: result.meta.last_row_id as number,
        envelope_no: envelopeNo,
        envelope_uuid: envelopeUuid
      });
    }

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_BATCH_GENERATED", "reimbursement_envelope", {
      project_id: body.project_id,
      count: body.count,
      generated_by: auth.sub
    });

    return c.json({ success: true, data: generated }, 201);
  }
);

reimbursementRoutes.post("/scan", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as ScanEnvelopeRequest;

  if (!body.envelope_uuid?.trim()) {
    return c.json({ success: false, error: { message: "envelope_uuid is required" } }, 400);
  }

  const envelope = await c.env.DB.prepare(
    "SELECT * FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
  )
    .bind(body.envelope_uuid.trim())
    .first<ReimbursementEnvelope>();

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  const now = nowIso();

  if (["batched", "pending_approval", "approved", "paid", "deleted"].includes(envelope.status)) {
    return c.json(
      {
        success: false,
        error: { message: `Envelope in status ${envelope.status} cannot be scanned for registration` }
      },
      400
    );
  }

  const shouldBindApplicant =
    envelope.applicant_userid === UNASSIGNED_APPLICANT || envelope.status === "unregistered";
  const isPrivileged = auth.roles.some((role) =>
    ["super_admin", "manager", "site_manager", "finance"].includes(role)
  );

  if (!shouldBindApplicant && !isPrivileged && envelope.applicant_userid !== auth.sub) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  await c.env.DB.prepare(
    `UPDATE reimbursement_envelope SET
       project_id = COALESCE(?, project_id),
       applicant_userid = CASE WHEN ? THEN ? ELSE applicant_userid END,
       invoice_unique_no = COALESCE(?, invoice_unique_no),
       invoice_no = COALESCE(?, invoice_no),
       expense_date = COALESCE(?, expense_date),
       amount = COALESCE(?, amount),
       category = COALESCE(?, category),
       description = COALESCE(?, description),
       status = CASE WHEN status = 'unregistered' THEN 'draft' ELSE status END,
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.project_id ?? null,
      shouldBindApplicant ? 1 : 0,
      auth.sub,
      sanitizeInvoiceUniqueNo(body.invoice_no),
      body.invoice_no ?? null,
      body.expense_date ?? null,
      body.amount ?? null,
      body.category ?? null,
      body.description ?? null,
      now,
      envelope.id
    )
    .run();

  if (body.attachments && body.attachments.length > 0) {
    await insertAttachments(c.env.DB, envelope.id, body.attachments);
  }

  await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_SCANNED", "reimbursement_envelope", {
    envelope_id: envelope.id,
    envelope_uuid: envelope.envelope_uuid,
    scanned_by: auth.sub
  });

  const latest = await c.env.DB.prepare(
    "SELECT id, status, applicant_userid FROM reimbursement_envelope WHERE id = ?"
  )
    .bind(envelope.id)
    .first<{ id: number; status: string; applicant_userid: string }>();

  return c.json({
    success: true,
    data: {
      id: envelope.id,
      status: latest?.status ?? envelope.status,
      applicant_userid: latest?.applicant_userid ?? envelope.applicant_userid,
      registered: shouldBindApplicant
    }
  });
});

reimbursementRoutes.post(
  "/:id/submit",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitEnvelopeRequest;

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );
    if (!isPrivileged && envelope.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    if (![
      "draft",
      "submitted",
      "unregistered"
    ].includes(envelope.status)) {
      return c.json(
        { success: false, error: { message: `Envelope in status ${envelope.status} cannot submit` } },
        400
      );
    }

    if (envelope.applicant_userid === UNASSIGNED_APPLICANT) {
      return c.json({ success: false, error: { message: "Envelope not registered to applicant yet" } }, 400);
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{ success: boolean; data: { id: number; status: string; already_submitted?: boolean } }>(
      c.env.DB,
      `reimbursement:submit:${id}`,
      auth.sub,
      idempotencyKey
    );
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 200 });
    }
    if (idempotency.kind === "pending") {
      return c.json(
        { success: false, error: { message: "Submission already in progress" } },
        409
      );
    }

    if (envelope.status === "submitted") {
      const payload = {
        success: true,
        data: {
          id,
          status: "submitted",
          already_submitted: true
        }
      };
      await completeIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey, 200, payload);
      return c.json(payload);
    }

    if (envelope.channel === "physical" && !isValidUuid(envelope.envelope_uuid)) {
      await abandonIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey);
      return c.json(
        {
          success: false,
          error: {
            message: "Physical envelope must be bound with a valid scanned UUID before submit"
          }
        },
        400
      );
    }

    const attachmentRow = await c.env.DB.prepare(
      "SELECT file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
    )
      .bind(id)
      .first<{ file_key: string | null }>();

    if (!attachmentRow?.file_key) {
      await abandonIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey);
      return c.json({ success: false, error: { message: "At least one attachment is required before submit" } }, 400);
    }

    const duplicateCount = await applyDuplicateChecks(c.env, id);
    if (duplicateCount > 0 && body.force_submit !== true) {
      await abandonIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey);
      return c.json(
        {
          success: false,
          error: {
            message:
              "Duplicate audit found risks. Applicant must explicitly insist submit before office can continue precheck"
          },
          data: { duplicate_count: duplicateCount, require_force_submit: true }
        },
        409
      );
    }

    const now = nowIso();
    const submitResult = await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         status = 'submitted',
         duplicate_override_requested = ?,
         duplicate_override_reason = ?,
         submitted_at = COALESCE(submitted_at, ?),
         updated_at = ?
       WHERE id = ?
         AND status IN ('draft', 'unregistered')`
    )
      .bind(
        body.force_submit === true ? 1 : 0,
        body.force_submit === true ? body.force_submit_reason?.trim() ?? null : null,
        now,
        now,
        id
      )
      .run();

    if ((submitResult.meta.changes ?? 0) === 0) {
      const latest = await c.env.DB.prepare(
        "SELECT status FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
      )
        .bind(id)
        .first<{ status: string }>();

      if (latest?.status === "submitted") {
        const payload = {
          success: true,
          data: {
            id,
            status: "submitted",
            already_submitted: true
          }
        };
        await completeIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey, 200, payload);
        return c.json(payload);
      }

      await abandonIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey);
      return c.json(
        {
          success: false,
          error: {
            message: `Envelope in status ${latest?.status ?? "unknown"} cannot submit`
          }
        },
        400
      );
    }

    await enqueueEnvelopeAiAudit(c.env, id, {
      file_key: attachmentRow.file_key,
      forceRerun: false,
      triggeredBy: auth.sub,
      reason: "submit_auto_silent_review"
    });

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_SCANNED", "reimbursement_envelope", {
      envelope_id: id,
      envelope_uuid: envelope.envelope_uuid,
      submitted_by: auth.sub
    });

    const payload = { success: true, data: { id, status: "submitted" } };
    await completeIdempotentRequest(c.env.DB, `reimbursement:submit:${id}`, auth.sub, idempotencyKey, 200, payload);
    return c.json(payload);
  }
);

reimbursementRoutes.post(
  "/:id/void",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    if (envelope.status === "cancelled") {
      return c.json(
        { success: false, error: { message: "Envelope is already cancelled" } },
        400
      );
    }

    if (["batched", "pending_approval", "approved", "paid"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: {
            message: `Envelope in status ${envelope.status} cannot be cancelled directly`
          }
        },
        400
      );
    }

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'cancelled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_CANCELLED", "reimbursement_envelope", {
      envelope_id: id,
      envelope_uuid: envelope.envelope_uuid,
      previous_status: envelope.status,
      cancelled_by: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.envelope.void",
      targetType: "reimbursement_envelope",
      targetId: id,
      detail: {
        envelope_uuid: envelope.envelope_uuid,
        previous_status: envelope.status
      }
    });

    return c.json({ success: true, data: { id, status: "cancelled" } });
  }
);

reimbursementRoutes.post(
  "/:id/split",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as SplitEnvelopeRequest;

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const ownedAttachments = await c.env.DB.prepare(
      "SELECT id FROM envelope_attachment WHERE envelope_id = ? AND status = 'active'"
    )
      .bind(id)
      .all<{ id: number }>();

    const attachmentIds = (body.attachment_ids ?? []).map((value) => Number(value));
    const decision = decideSplitEnvelope({
      envelope: {
        status: envelope.status,
        batch_id: envelope.batch_id,
        approval_instance_id: envelope.approval_instance_id,
        amount: envelope.amount
      },
      newProjectId: Number(body.new_envelope?.project_id),
      newAmount: Number(body.new_envelope?.amount),
      originalAmount: Number(body.original_amount),
      attachmentIds,
      ownedActiveAttachmentIds: (ownedAttachments.results ?? []).map((row) => row.id)
    });

    if (!decision.allowed) {
      return c.json({ success: false, error: { message: decision.message } }, 400);
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    const idempotency = await beginIdempotentRequest<{
      success: boolean;
      data: {
        new_envelope: { id: number; envelope_no: string; envelope_uuid: string };
        original: { id: number; amount: number };
        amount_delta: number;
      };
    }>(c.env.DB, `reimbursement:split:${id}`, auth.sub, idempotencyKey);
    if (idempotency.kind === "replay") {
      return c.json(idempotency.payload, { status: idempotency.statusCode as 201 });
    }
    if (idempotency.kind === "pending") {
      return c.json({ success: false, error: { message: "Split already in progress" } }, 409);
    }

    const now = nowIso();
    const newUuid = crypto.randomUUID();
    let newId = 0;

    try {
      await runInTransaction(c.env.DB, async () => {
        // 并发闸门：原单 UPDATE 必须最先执行且独立成功，否则视为并发冲突直接中止。
        // 此时尚未写入任何新数据，失败时无需补偿。
        // 相比原校验额外增加 approval_instance_id IS NULL，与 decideSplitEnvelope 的
        // 前置检查保持一致，避免 SELECT 与 UPDATE 之间的 TOCTOU 窗口。
        const updated = await c.env.DB.prepare(
          `UPDATE reimbursement_envelope
              SET amount = ?, precheck_status = 'none', updated_at = ?
            WHERE id = ?
              AND batch_id IS NULL
              AND approval_instance_id IS NULL
              AND status = ?`
        )
          .bind(Number(body.original_amount), now, id, envelope.status)
          .run();
        if ((updated.meta.changes ?? 0) !== 1) {
          throw new Error("Envelope changed during split, aborted");
        }

        try {
          const insert = await c.env.DB.prepare(
            `INSERT INTO reimbursement_envelope
               (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
                expense_date, amount, category, description,
                status, precheck_status, verification_status, verification_note,
                split_from_envelope_id, split_reason,
                submitted_at, received_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              newUuid,
              newUuid,
              Number(body.new_envelope.project_id),
              envelope.applicant_userid,
              envelope.channel,
              body.new_envelope.expense_date ?? null,
              Number(body.new_envelope.amount),
              body.new_envelope.category ?? null,
              body.new_envelope.description ?? null,
              envelope.status,
              envelope.verification_status,
              envelope.verification_note,
              id,
              body.reason ?? null,
              envelope.submitted_at,
              envelope.received_at,
              now,
              now
            )
            .run();
          newId = insert.meta.last_row_id as number;

          if (attachmentIds.length > 0) {
            const placeholders = attachmentIds.map(() => "?").join(", ");
            const moved = await c.env.DB.prepare(
              `UPDATE envelope_attachment SET envelope_id = ?
                WHERE id IN (${placeholders}) AND envelope_id = ? AND status = 'active'`
            )
              .bind(newId, ...attachmentIds, id)
              .run();
            if ((moved.meta.changes ?? 0) !== attachmentIds.length) {
              throw new Error("Attachment transfer mismatch, split aborted");
            }
          }
        } catch (innerError) {
          // D1 生产环境不支持 SQL 事务，runInTransaction 会降级为非事务执行，
          // 因此这里必须显式补偿，否则会留下孤儿信封与错位的附件。
          // 补偿顺序与写入顺序相反；每步都吞掉自身异常，确保原始错误能抛出。
          if (newId > 0) {
            try {
              // 把已转移的附件全部移回原单（新信封此刻不可能有其他附件）
              await c.env.DB.prepare(
                "UPDATE envelope_attachment SET envelope_id = ? WHERE envelope_id = ?"
              )
                .bind(id, newId)
                .run();
              // 新信封刚创建、无任何外部引用，可安全硬删
              await c.env.DB.prepare("DELETE FROM reimbursement_envelope WHERE id = ?")
                .bind(newId)
                .run();
            } catch (compensationError) {
              console.error("Split compensation failed", compensationError);
            }
            newId = 0;
          }
          try {
            // 还原原单金额与复核状态
            await c.env.DB.prepare(
              "UPDATE reimbursement_envelope SET amount = ?, precheck_status = ?, updated_at = ? WHERE id = ?"
            )
              .bind(envelope.amount, envelope.precheck_status, nowIso(), id)
              .run();
          } catch (compensationError) {
            console.error("Split compensation failed", compensationError);
          }
          throw innerError;
        }
      });
    } catch (error) {
      await abandonIdempotentRequest(
        c.env.DB,
        `reimbursement:split:${id}`,
        auth.sub,
        idempotencyKey
      );
      throw error;
    }

    // 拆单后自动核查：两边各自重新静默审查（票据识别+重复校验+合理性）
    await enqueueEnvelopeAiAudit(c.env, id, {
      forceRerun: true,
      triggeredBy: auth.sub,
      reason: "envelope_split_source"
    });
    await enqueueEnvelopeAiAudit(c.env, newId, {
      forceRerun: true,
      triggeredBy: auth.sub,
      reason: "envelope_split_child"
    });

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_SPLIT", "reimbursement_envelope", {
      source_envelope_id: id,
      new_envelope_id: newId,
      new_envelope_uuid: newUuid,
      moved_attachment_ids: attachmentIds,
      operator: auth.sub
    });

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: id,
      detail: {
        new_envelope_id: newId,
        new_envelope_uuid: newUuid,
        new_project_id: Number(body.new_envelope.project_id),
        new_amount: Number(body.new_envelope.amount),
        original_amount: Number(body.original_amount),
        moved_attachment_ids: attachmentIds,
        reason: body.reason ?? null,
        amount_delta: decision.amountDelta
      }
    });

    const payload = {
      success: true,
      data: {
        new_envelope: { id: newId, envelope_no: newUuid, envelope_uuid: newUuid },
        original: { id, amount: Number(body.original_amount) },
        amount_delta: decision.amountDelta
      }
    };
    await completeIdempotentRequest(
      c.env.DB,
      `reimbursement:split:${id}`,
      auth.sub,
      idempotencyKey,
      201,
      payload
    );
    return c.json(payload, 201);
  }
);

reimbursementRoutes.post(
  "/verify",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as VerifyEnvelopeRequest;

    if (!body.envelope_id && !body.envelope_uuid) {
      return c.json(
        { success: false, error: { message: "envelope_id or envelope_uuid is required" } },
        400
      );
    }
    if (body.result !== "verified" && body.result !== "mismatch") {
      return c.json({ success: false, error: { message: "result must be verified or mismatch" } }, 400);
    }

    const envelope = body.envelope_id
      ? await c.env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")
          .bind(body.envelope_id)
          .first<ReimbursementEnvelope>()
      : await c.env.DB.prepare(
          "SELECT * FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
        )
          .bind(body.envelope_uuid ?? "")
          .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const canSelfAudit = auth.roles.includes("super_admin") || auth.roles.includes("finance");
    if (envelope.applicant_userid === auth.sub && !canSelfAudit) {
      return c.json(
        { success: false, error: { message: "Applicant cannot verify their own reimbursement envelope" } },
        403
      );
    }

    if (!["submitted", "received"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${envelope.status} cannot be verified` }
        },
        400
      );
    }

    const now = nowIso();
    const status = body.result === "verified" ? "received" : "submitted";

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         verification_status = ?,
         verification_note = ?,
         status = ?,
         received_at = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(body.result, body.note ?? null, status, body.result === "verified" ? now : null, now, envelope.id)
      .run();

    return c.json({
      success: true,
      data: {
        id: envelope.id,
        verification_status: body.result,
        status
      }
    });
  }
);

reimbursementRoutes.post(
  "/:id/generate-pdf",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const project = await c.env.DB.prepare("SELECT project_name FROM project WHERE id = ?")
      .bind(envelope.project_id)
      .first<{ project_name: string }>();

    const task = await createTask(c.env, {
      task_type: "file_generate",
      biz_type: "reimbursement_envelope",
      biz_id: id,
      priority: 5,
      payload: {
        envelope_id: id,
        envelope_no: envelope.envelope_no,
        envelope_uuid: envelope.envelope_uuid,
        project_id: envelope.project_id,
        project_name: project?.project_name ?? String(envelope.project_id),
        applicant_userid: envelope.applicant_userid,
        amount: envelope.amount,
        category: envelope.category,
        description: envelope.description,
        created_at: envelope.created_at,
        submitted_at: envelope.submitted_at,
        received_at: envelope.received_at
      },
      timeout_seconds: 300
    });

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET pdf_status = 'pending', pdf_task_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(task.id, nowIso(), id)
      .run();

    return c.json({ success: true, data: { task_id: task.id, pdf_status: "pending" } });
  }
);

reimbursementRoutes.get("/:id/pdf-status", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");
  const permittedEnvelope = await assertEnvelopeAccess(c.env, id, auth);

  const envelope = permittedEnvelope
    ? await c.env.DB.prepare(
        `SELECT pdf_task_id, pdf_status, pdf_file_key
           FROM reimbursement_envelope
          WHERE id = ? AND status != 'deleted'`
      )
        .bind(id)
        .first<{ pdf_task_id: number | null; pdf_status: string; pdf_file_key: string | null }>()
    : null;

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  if (!envelope.pdf_task_id) {
    return c.json({
      success: true,
      data: {
        status: envelope.pdf_status,
        task_id: null,
        file_key: envelope.pdf_file_key,
        result: null
      }
    });
  }

  const task = await c.env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
    .bind(envelope.pdf_task_id)
    .first<{ status: string; result_json: string | null }>();

  const result = parseTaskResult(task?.result_json ?? null);
  const outputFileKey =
    typeof result?.file_key === "string"
      ? result.file_key
      : typeof result?.file_name === "string"
        ? result.file_name
        : envelope.pdf_file_key;

  if (task?.status === "completed" && envelope.pdf_status !== "completed") {
    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET pdf_status = 'completed', pdf_file_key = COALESCE(?, pdf_file_key), updated_at = ? WHERE id = ?"
    )
      .bind(outputFileKey ?? null, nowIso(), id)
      .run();
  }

  if ((task?.status === "failed" || task?.status === "timeout") && envelope.pdf_status !== "failed") {
    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET pdf_status = 'failed', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();
  }

  return c.json({
    success: true,
    data: {
      status:
        task?.status === "completed"
          ? "completed"
          : task?.status === "failed" || task?.status === "timeout"
            ? "failed"
            : envelope.pdf_status,
      task_id: envelope.pdf_task_id,
      file_key: outputFileKey,
      result
    }
  });
});
