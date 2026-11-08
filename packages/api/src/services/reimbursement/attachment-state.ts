import type { EnvelopeAttachment, ReimbursementDuplicateCheck } from "../../types/reimbursement";
import { resolveMergedLabel } from "./merged-invoice";
import { parseStoredJson, type InvoiceReviewRow } from "./review-helpers";

// 每个附件的识别状态和整单合计。网页和小程序都读这里算好的结果，不在客户端各算一遍。

export type AttachmentReviewState =
  | "recognizing"
  | "recognized"
  | "not_invoice"
  | "no_amount"
  | "failed"
  | "not_recognized";

export interface AttachmentDuplicateView {
  match_type: string;
  risk_level: string;
  summary: string | null;
  matched_envelope_id: number | null;
}

export interface AttachmentReviewView {
  attachment_id: number;
  file_key: string;
  file_name: string | null;
  file_size: number | null;
  state: AttachmentReviewState;
  /** 销售方，没有用文件名，再没有用「附件 {id}」 */
  display_name: string;
  amount: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  raw_text_summary: string | null;
  duplicates: AttachmentDuplicateView[];
  attention: string | null;
  /** 文件里合并了多张发票时是「含 11 张发票」，否则是 null。金额照常计入合计，但没法逐张查重。 */
  merged_label: string | null;
}

export interface ReviewTotals {
  attachment_count: number;
  recognized_count: number;
  recognizing_count: number;
  failed_count: number;
  no_amount_count: number;
  not_invoice_count: number;
  extracted_total: number;
  declared_amount: number;
  /** 所有附件都是 recognized */
  complete: boolean;
  /** extracted_total - declared_amount，保留两位；complete 为 false 时是 null */
  delta: number | null;
  /** complete 且 |delta| > 0.01 */
  mismatch: boolean;
}

export interface AttachmentAnomalyInput {
  attachment_id: number | null;
  level: string;
  reason: string;
}

const IN_FLIGHT_TASK_STATUSES = new Set(["pending", "assigned", "running"]);
/** 这些状态的单还在识别流程里；已过 received 的历史单没有识别行就是没识别过。 */
const RECOGNITION_ACTIVE_STATUSES = new Set(["draft", "unregistered", "submitted", "received"]);
const ATTENTION_LEVELS = new Set(["medium", "high"]);
const MISMATCH_TOLERANCE = 0.01;

const roundMoney = (value: number): number => Number(value.toFixed(2));

const readText = (extraction: Record<string, unknown> | null, field: string): string | null => {
  const value = extraction?.[field];
  if (typeof value !== "string") return null;
  return value.trim() || null;
};

const positiveAmount = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const resolveCompletedState = (
  amount: number | null,
  documentType: string | null
): AttachmentReviewState => {
  if (amount !== null) return "recognized";
  // 没有 document_type 的历史数据不猜测，按没读到金额算
  if (documentType && documentType !== "invoice") return "not_invoice";
  return "no_amount";
};

const resolveState = (
  row: InvoiceReviewRow | undefined,
  amount: number | null,
  documentType: string | null,
  envelopeStatus: string
): AttachmentReviewState => {
  if (!row) return RECOGNITION_ACTIVE_STATUSES.has(envelopeStatus) ? "recognizing" : "not_recognized";
  if (IN_FLIGHT_TASK_STATUSES.has(row.task_status)) return "recognizing";
  if (row.task_status === "completed") return resolveCompletedState(amount, documentType);
  return "failed";
};

const duplicateAttachmentIds = (duplicate: ReimbursementDuplicateCheck): number[] => {
  const evidence = parseStoredJson(duplicate.evidence_json);
  return [evidence?.attachment_id, evidence?.other_attachment_id].filter(
    (value): value is number => typeof value === "number"
  );
};

export const buildAttachmentViews = (input: {
  attachments: EnvelopeAttachment[];
  reviews: InvoiceReviewRow[];
  duplicates: ReimbursementDuplicateCheck[];
  anomalies: AttachmentAnomalyInput[];
  envelopeStatus: string;
}): AttachmentReviewView[] => {
  const positiveRounds = input.reviews.map((row) => row.review_round).filter((round) => round > 0);
  const currentRound = positiveRounds.length > 0 ? Math.max(...positiveRounds) : 0;

  const latestRowByAttachment = input.reviews
    .filter((row) => row.review_round === currentRound)
    .reduce((rows, row) => {
      const existing = rows.get(row.attachment_id);
      return !existing || row.id > existing.id ? new Map(rows).set(row.attachment_id, row) : rows;
    }, new Map<number, InvoiceReviewRow>());

  return input.attachments.map((attachment) => {
    const row = latestRowByAttachment.get(attachment.id);
    const extraction = parseStoredJson(row?.extraction_json ?? null);
    const amount = positiveAmount(row?.invoice_amount);
    const sellerName = readText(extraction, "seller_name");
    const attention = input.anomalies.find(
      (item) => item.attachment_id === attachment.id && ATTENTION_LEVELS.has(item.level)
    );

    return {
      attachment_id: attachment.id,
      file_key: attachment.file_key,
      file_name: attachment.file_name,
      file_size: attachment.file_size,
      state: resolveState(row, amount, readText(extraction, "document_type"), input.envelopeStatus),
      display_name: sellerName ?? attachment.file_name ?? `附件 ${attachment.id}`,
      amount,
      invoice_no: row?.invoice_no ?? null,
      invoice_date: row?.invoice_date ?? null,
      seller_name: sellerName,
      raw_text_summary: readText(extraction, "raw_text_summary"),
      duplicates: input.duplicates
        .filter((duplicate) => duplicateAttachmentIds(duplicate).includes(attachment.id))
        .map((duplicate) => ({
          match_type: duplicate.match_type,
          risk_level: duplicate.risk_level,
          summary: duplicate.summary,
          matched_envelope_id: duplicate.matched_envelope_id
        })),
      attention: attention?.reason ?? null,
      merged_label: row?.task_status === "completed" ? resolveMergedLabel(extraction) : null
    };
  });
};

export const computeReviewTotals = (views: AttachmentReviewView[], declaredAmount: number): ReviewTotals => {
  const countOf = (state: AttachmentReviewState) => views.filter((view) => view.state === state).length;
  const recognized = views.filter((view) => view.state === "recognized");
  const extractedTotal = roundMoney(recognized.reduce((sum, view) => sum + (view.amount ?? 0), 0));
  const complete = views.length > 0 && recognized.length === views.length;
  const delta = complete ? roundMoney(extractedTotal - declaredAmount) : null;

  return {
    attachment_count: views.length,
    recognized_count: recognized.length,
    recognizing_count: countOf("recognizing"),
    failed_count: countOf("failed"),
    no_amount_count: countOf("no_amount"),
    not_invoice_count: countOf("not_invoice"),
    extracted_total: extractedTotal,
    declared_amount: declaredAmount,
    complete,
    delta,
    mismatch: delta !== null && Math.abs(delta) > MISMATCH_TOLERANCE
  };
};
