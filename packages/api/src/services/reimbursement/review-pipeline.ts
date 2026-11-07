import { pickBuyerNameFromReviews, readInvoiceExtractionText } from "../../routes/reimbursement-invoice-title-policy";
import { syncEnvelopeInvoiceTitle } from "../../routes/reimbursement-invoice-title-sync";
import type { Env } from "../../types/env";
import type { ReimbursementEnvelope } from "../../types/reimbursement";
import { createTask, createTaskWithCompanions } from "../ai-slot";
import { applyDuplicateChecks, applyInvoiceReviewDuplicateChecks } from "./duplicate-checks";
import {
  extractInvoiceRecognitionHints,
  isMissingInvoiceReviewTableError,
  normalizeHintValue,
  normalizeInvoiceDate,
  normalizeInvoiceNo,
  parseQrInvoiceHints,
  parseStoredJson,
  parseTaskResult,
  sha256Hex,
  supportsInvoiceReviewTable,
  toAmountValue,
  type InvoiceReviewRow
} from "./review-helpers";

const nowIso = () => new Date().toISOString();

/**
 * 当前轮次里，每个有效附件没有识别行就建。任务和识别行一起写入，重复调用安全。
 * 已有行（包括 failed）不重建：失败的由人点重新识别。
 */
export const ensureInvoiceReviews = async (
  env: Env,
  envelopeId: number,
  options?: { forceNewRound?: boolean }
): Promise<{ round: number; created: number; latestTaskId: number | null }> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();
  if (!envelope || envelope.status === "deleted" || envelope.status === "cancelled") {
    return { round: 0, created: 0, latestTaskId: null };
  }

  const latestRoundRow = await env.DB.prepare(
    "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
  )
    .bind(envelopeId)
    .first<{ max_round: number | null }>();
  const latestRound = Math.max(Number(latestRoundRow?.max_round ?? 0), 0);
  const round = options?.forceNewRound ? latestRound + 1 : Math.max(latestRound, 1);

  const attachmentRows = await env.DB.prepare(
    `SELECT id, file_key, file_name
       FROM envelope_attachment
      WHERE envelope_id = ? AND status = 'active'
      ORDER BY id ASC`
  )
    .bind(envelopeId)
    .all<{ id: number; file_key: string | null; file_name: string | null }>();
  const attachments = (attachmentRows.results ?? []).filter((item) => item.file_key?.trim());

  const existingRows = await env.DB.prepare(
    `SELECT attachment_id, task_id
       FROM reimbursement_invoice_review
      WHERE envelope_id = ? AND review_round = ?`
  )
    .bind(envelopeId, round)
    .all<{ attachment_id: number; task_id: number | null }>();
  const existingAttachmentIds = new Set((existingRows.results ?? []).map((row) => row.attachment_id));

  const existingTaskIds = (existingRows.results ?? [])
    .map((row) => row.task_id)
    .filter((taskId): taskId is number => taskId !== null);
  let created = 0;
  let latestTaskId: number | null = existingTaskIds.length > 0 ? Math.max(...existingTaskIds) : null;

  for (const attachment of attachments) {
    if (existingAttachmentIds.has(attachment.id)) continue;

    const task = await createTaskWithCompanions(
      env,
      {
        task_type: "ocr_extract",
        biz_type: "reimbursement_envelope",
        biz_id: envelopeId,
        priority: envelope.channel === "electronic" ? 5 : 4,
        payload: {
          envelope_id: envelopeId,
          attachment_id: attachment.id,
          file_key: attachment.file_key,
          file_name: attachment.file_name,
          channel: envelope.channel,
          project_id: envelope.project_id
        },
        timeout_seconds: 300
      },
      (taskCode) => {
        const now = nowIso();
        return [
          env.DB.prepare(
            `INSERT INTO reimbursement_invoice_review
              (envelope_id, attachment_id, review_round, channel, task_id, task_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, (SELECT id FROM task_queue WHERE task_code = ?), 'pending', ?, ?)`
          ).bind(envelopeId, attachment.id, round, envelope.channel, taskCode, now, now)
        ];
      }
    );
    if (!task) continue;
    created += 1;
    latestTaskId = task.id;
  }

  if (created > 0) {
    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(latestTaskId, nowIso(), envelopeId)
      .run();
  }

  return { round, created, latestTaskId };
};

export const enqueueEnvelopeAiAudit = async (
  env: Env,
  envelopeId: number,
  options?: { file_key?: string | null; forceRerun?: boolean; triggeredBy?: string | null; reason?: string | null }
) => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") return;

  const duplicateScan = await applyDuplicateChecks(env, envelopeId);
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
      duplicate_count: duplicateScan.total,
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
      await ensureInvoiceReviews(env, envelopeId, { forceNewRound: options?.forceRerun === true });
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

export const syncEnvelopeAuditState = async (env: Env, envelopeId: number): Promise<void> => {
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
          risk_hint: row.risk_hint,
          buyer_name: readInvoiceExtractionText(row.extraction_json, "buyer_name"),
          seller_name: readInvoiceExtractionText(row.extraction_json, "seller_name")
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

    await syncEnvelopeInvoiceTitle(env.DB, {
      envelopeId,
      currentStatus: envelope.status,
      currentEntityId: envelope.invoice_title_entity_id ?? null,
      currentName: envelope.invoice_title_name ?? null,
      currentSource: envelope.invoice_title_source ?? null,
      buyerName: pickBuyerNameFromReviews(completedRows, bestRow ?? null),
      pendingCount,
      completedCount: completedRows.length
    });
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

      const fallbackBuyerName =
        typeof ocrResult?.buyer_name === "string" && ocrResult.buyer_name.trim()
          ? ocrResult.buyer_name.trim()
          : null;
      // 单任务回退路径只在有抬头时写入，从不清空（该路径每个旧信封最多跑一次）
      if (fallbackBuyerName) {
        await syncEnvelopeInvoiceTitle(env.DB, {
          envelopeId,
          currentStatus: envelope.status,
          currentEntityId: envelope.invoice_title_entity_id ?? null,
          currentName: envelope.invoice_title_name ?? null,
          currentSource: envelope.invoice_title_source ?? null,
          buyerName: fallbackBuyerName,
          pendingCount: 0,
          completedCount: 1
        });
      }
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
