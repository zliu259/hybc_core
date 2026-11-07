import {
  classifyFuzzyDuplicate,
  isBlockingRiskLevel,
  type DuplicateScanResult
} from "../../routes/reimbursement-duplicate-scan";
import type { Env } from "../../types/env";
import type { ReimbursementEnvelope } from "../../types/reimbursement";
import { UNASSIGNED_APPLICANT, type InvoiceReviewRow } from "./review-helpers";

const nowIso = () => new Date().toISOString();

export const applyInvoiceReviewDuplicateChecks = async (
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

export const applyDuplicateChecks = async (
  env: Env,
  envelopeId: number,
  hints?: {
    invoice_unique_no?: string | null;
    invoice_no?: string | null;
    expense_date?: string | null;
  }
): Promise<DuplicateScanResult> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") {
    return { total: 0, blocking: 0 };
  }

  await env.DB.prepare("DELETE FROM reimbursement_duplicate_check WHERE envelope_id = ?")
    .bind(envelopeId)
    .run();

  const now = nowIso();
  let total = 0;
  let blocking = 0;

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
      total += 1;
      blocking += 1;
    }
  }

  if (envelope.amount > 0 && envelope.applicant_userid !== UNASSIGNED_APPLICANT) {
    const fuzzyRows = await env.DB.prepare(
      `SELECT id, project_id, invoice_no, amount, expense_date FROM reimbursement_envelope
       WHERE id != ? AND status NOT IN ('deleted', 'cancelled')
         AND applicant_userid = ?
         AND ABS(amount - ?) <= 1
         AND (
           expense_date IS NULL OR ? IS NULL OR ABS(julianday(expense_date) - julianday(?)) <= 7
         )
       ORDER BY updated_at DESC
       LIMIT 10`
    )
      .bind(envelopeId, envelope.applicant_userid, envelope.amount, expenseDate, expenseDate)
      .all<{
        id: number;
        project_id: number;
        invoice_no: string | null;
        amount: number;
        expense_date: string | null;
      }>();

    for (const row of fuzzyRows.results ?? []) {
      const classification = classifyFuzzyDuplicate(expenseDate ?? null, row.expense_date);
      await env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, 'fuzzy', ?, ?, ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.id,
          row.invoice_no,
          classification.match_score,
          classification.risk_level,
          classification.summary,
          JSON.stringify({
            matched_envelope_id: row.id,
            amount: row.amount,
            expense_date: row.expense_date
          }),
          now
        )
        .run();
      total += 1;
      if (isBlockingRiskLevel(classification.risk_level)) {
        blocking += 1;
      }
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
      total += 1;
      blocking += 1;
    }
  }

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET duplicate_check_status = 'completed', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), envelopeId)
    .run();

  return { total, blocking };
};
