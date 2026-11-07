import { detectEInvoiceInPhysical } from "../../routes/reimbursement-einvoice-guard";
import { isBlockingRiskLevel } from "../../routes/reimbursement-duplicate-scan";
import type { Env } from "../../types/env";
import type {
  EnvelopeAttachment,
  ReimbursementDuplicateCheck,
  ReimbursementEnvelope
} from "../../types/reimbursement";
import { normalizeAnomalyResult } from "./anomaly-result";
import {
  buildAttachmentViews,
  computeReviewTotals,
  type AttachmentReviewView,
  type ReviewTotals
} from "./attachment-state";
import { loadCurrentReviewRows } from "./duplicate-checks";
import { buildEnvelopeGuidance, type EnvelopeGuidance } from "./guidance";
import { parseStoredJson } from "./review-helpers";

// GET /:id 新增的三个字段。旧前端读取的字段不动，所以接口和前端不用同时上线。

export interface EnvelopeReviewView {
  guidance: EnvelopeGuidance;
  attachment_views: AttachmentReviewView[];
  review_totals: ReviewTotals;
}

const readAnomalies = (silentReviewResult: string | null) => {
  const aiReasonability = parseStoredJson(silentReviewResult)?.ai_reasonability;
  return normalizeAnomalyResult(
    typeof aiReasonability === "object" && aiReasonability !== null
      ? (aiReasonability as Record<string, unknown>)
      : null
  ).anomalies;
};

const countWholeEnvelopeDuplicates = (duplicates: ReimbursementDuplicateCheck[]): number =>
  duplicates.filter(
    (duplicate) =>
      isBlockingRiskLevel(duplicate.risk_level) &&
      typeof parseStoredJson(duplicate.evidence_json)?.attachment_id !== "number"
  ).length;

export const buildEnvelopeReviewView = async (
  env: Env,
  input: {
    envelope: ReimbursementEnvelope;
    attachments: EnvelopeAttachment[];
    duplicates: ReimbursementDuplicateCheck[];
    batchStatus: string | null;
    canOfficeAudit: boolean;
  }
): Promise<EnvelopeReviewView> => {
  const { envelope, canOfficeAudit } = input;
  const views = buildAttachmentViews({
    attachments: input.attachments,
    reviews: await loadCurrentReviewRows(env, envelope.id),
    duplicates: input.duplicates,
    // 留意是给办公室的提醒，申请人看不到
    anomalies: canOfficeAudit ? readAnomalies(envelope.silent_review_result) : [],
    envelopeStatus: envelope.status
  });
  const totals = computeReviewTotals(views, envelope.amount || 0);

  return {
    guidance: buildEnvelopeGuidance({
      envelope,
      views,
      totals,
      envelopeDuplicateCount: countWholeEnvelopeDuplicates(input.duplicates),
      einvoiceDetected: detectEInvoiceInPhysical({
        channel: envelope.channel,
        ocrResultJson: envelope.ocr_result_json,
        invoiceUniqueNoHint: envelope.ocr_invoice_unique_no_hint
      }).detected,
      batchStatus: input.batchStatus,
      canOfficeAudit
    }),
    attachment_views: views,
    review_totals: totals
  };
};
