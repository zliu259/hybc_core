import { pickBuyerNameFromReviews, readInvoiceExtractionText } from "../../routes/reimbursement-invoice-title-policy";
import { syncEnvelopeInvoiceTitle } from "../../routes/reimbursement-invoice-title-sync";
import type { CreateTaskRequest } from "../../types/ai";
import type { Env } from "../../types/env";
import type { EnvelopeAttachment, ReimbursementEnvelope } from "../../types/reimbursement";
import { createTask, createTaskWithCompanions } from "../ai-slot";
import { buildAttachmentViews, computeReviewTotals } from "./attachment-state";
import { normalizeAnomalyResult } from "./anomaly-result";
import {
  applyDuplicateChecks,
  applyInvoiceReviewDuplicateChecks,
  loadCurrentReviewRows,
  pickBestReviewRow
} from "./duplicate-checks";
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

const ANOMALY_REVIEW_STATUSES = new Set(["submitted", "received"]);

const buildOcrTaskRequest = (
  envelope: ReimbursementEnvelope,
  attachment: { id: number; file_key: string | null; file_name: string | null }
): CreateTaskRequest => ({
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
      buildOcrTaskRequest(envelope, attachment),
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

/**
 * 只重跑这一张没读出来的附件，更新原识别行，不开新轮。不是 failed 就返回 null。
 * 先把行抢占成 pending 防止连点建两个任务；建任务失败时旧任务仍是 failed，下次同步会把行改回去。
 */
export const retryFailedReview = async (
  env: Env,
  envelopeId: number,
  attachmentId: number
): Promise<number | null> => {
  await refreshInvoiceReviewRows(env, envelopeId);

  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();
  const attachment = await env.DB.prepare(
    "SELECT id, file_key, file_name FROM envelope_attachment WHERE id = ? AND envelope_id = ? AND status = 'active'"
  )
    .bind(attachmentId, envelopeId)
    .first<{ id: number; file_key: string | null; file_name: string | null }>();
  const row = (await loadCurrentReviewRows(env, envelopeId)).find((item) => item.attachment_id === attachmentId);
  if (!envelope || !attachment || !row || row.task_status !== "failed") return null;

  const claimed = await env.DB.prepare(
    "UPDATE reimbursement_invoice_review SET task_status = 'pending', updated_at = ? WHERE id = ? AND task_status = 'failed'"
  )
    .bind(nowIso(), row.id)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return null;

  const task = await createTaskWithCompanions(env, buildOcrTaskRequest(envelope, attachment), (taskCode) => [
    env.DB.prepare(
      `UPDATE reimbursement_invoice_review SET
         task_id = (SELECT id FROM task_queue WHERE task_code = ?),
         task_status = 'pending',
         risk_level = 'low',
         risk_hint = NULL,
         updated_at = ?
       WHERE id = ?`
    ).bind(taskCode, nowIso(), row.id)
  ]);
  if (!task) return null;

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
  )
    .bind(task.id, nowIso(), envelopeId)
    .run();
  return task.id;
};

/**
 * 费用合理性审查。只在已提交、所有附件识别结束、至少一张成功时才建，全部失败时没有内容可审。
 * 用附件和识别任务算指纹：和最新一次相同就不重复建，增删附件或重新识别后才重跑。
 * force 是办公室手动重跑，跳过这些条件。
 */
export const ensureAnomalyReview = async (
  env: Env,
  envelopeId: number,
  options?: { force?: boolean; triggeredBy?: string | null; reason?: string | null }
): Promise<number | null> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();
  if (!envelope || envelope.status === "deleted" || envelope.status === "cancelled") return null;
  const force = options?.force === true;
  if (!force && !ANOMALY_REVIEW_STATUSES.has(envelope.status)) return null;

  const attachmentRows = await env.DB.prepare(
    "SELECT * FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id ASC"
  )
    .bind(envelopeId)
    .all<EnvelopeAttachment>();
  const attachments = attachmentRows.results ?? [];
  const rows = await loadCurrentReviewRows(env, envelopeId);
  const views = buildAttachmentViews({
    attachments,
    reviews: rows,
    duplicates: [],
    anomalies: [],
    envelopeStatus: envelope.status
  });

  if (!force) {
    const allFinished = views.every((view) => view.state !== "recognizing");
    if (!allFinished || !rows.some((row) => row.task_status === "completed")) return null;
  }

  const fingerprint = rows
    .map((row) => `${row.attachment_id}:${row.task_id}`)
    .sort()
    .join(",");
  const latest = await env.DB.prepare(
    `SELECT payload_json FROM task_queue
      WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
      ORDER BY id DESC LIMIT 1`
  )
    .bind(envelopeId)
    .first<{ payload_json: string | null }>();
  if (!force && parseStoredJson(latest?.payload_json ?? null)?.review_fingerprint === fingerprint) {
    return null;
  }

  const duplicateChecks = await env.DB.prepare(
    `SELECT matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json
       FROM reimbursement_duplicate_check
      WHERE envelope_id = ?
      ORDER BY id DESC`
  )
    .bind(envelopeId)
    .all<Record<string, unknown>>();
  const rowByAttachment = new Map(rows.map((row) => [row.attachment_id, row]));

  const task = await createTask(env, {
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
      review_fingerprint: fingerprint,
      rerun: force,
      amount: envelope.amount,
      duplicate_count: duplicateChecks.results?.length ?? 0,
      project_id: envelope.project_id,
      applicant_userid: envelope.applicant_userid,
      category: envelope.category,
      description: envelope.description,
      channel: envelope.channel,
      attachments: attachments.map((item) => ({
        attachment_type: item.attachment_type,
        file_key: item.file_key,
        file_name: item.file_name,
        file_size: item.file_size,
        invoice_no: item.invoice_no,
        amount: item.amount,
        issue_date: item.issue_date
      })),
      invoices: views.map((view) => {
        const extraction = rowByAttachment.get(view.attachment_id)?.extraction_json ?? null;
        return {
          attachment_id: view.attachment_id,
          file_name: view.file_name,
          seller_name: view.seller_name,
          buyer_name: readInvoiceExtractionText(extraction, "buyer_name"),
          invoice_no: view.invoice_no,
          invoice_date: view.invoice_date,
          amount: view.amount,
          document_type: readInvoiceExtractionText(extraction, "document_type")
        };
      }),
      duplicate_checks: duplicateChecks.results ?? []
    },
    timeout_seconds: 300
  });
  return task.id;
};

/** 全部重新识别：清空结论、开新一轮。合理性审查在这一轮识别结束后由同步自动建。 */
export const restartEnvelopeReview = async (env: Env, envelopeId: number): Promise<void> => {
  await env.DB.prepare(
    `UPDATE reimbursement_envelope SET
       precheck_status = 'pending',
       duplicate_check_status = 'pending',
       silent_review_result = NULL,
       updated_at = ?
     WHERE id = ?`
  )
    .bind(nowIso(), envelopeId)
    .run();
  await ensureInvoiceReviews(env, envelopeId, { forceNewRound: true });
};

/**
 * 把任务结果写回当前轮次的识别行。不只看进行中的行：failed 行的任务可能后来完成或被重新排队。
 * 提交请求也用它，所以这里只读写识别行，不碰信封。
 */
export const refreshInvoiceReviewRows = async (env: Env, envelopeId: number): Promise<void> => {
  const roundRow = await env.DB.prepare(
    "SELECT MAX(review_round) AS max_round FROM reimbursement_invoice_review WHERE envelope_id = ?"
  )
    .bind(envelopeId)
    .first<{ max_round: number | null }>();
  const round = Number(roundRow?.max_round ?? 0);
  if (round <= 0) return;

  const reviewRows = await env.DB.prepare(
    `SELECT id, attachment_id, review_round, task_id, task_status, extraction_json,
            qr_text, qr_hash, invoice_unique_no, invoice_no, invoice_date, invoice_amount,
            source, risk_level, risk_hint
       FROM reimbursement_invoice_review
      WHERE envelope_id = ? AND review_round = ?
      ORDER BY id ASC`
  )
    .bind(envelopeId, round)
    .all<InvoiceReviewRow>();

  for (const row of reviewRows.results ?? []) {
    if (!row.task_id) continue;
    if (row.task_status === "completed") continue;
    const task = await env.DB.prepare(
      "SELECT status, result_json, retry_count, max_retries FROM task_queue WHERE id = ?"
    )
      .bind(row.task_id)
      .first<{ status: string; result_json: string | null; retry_count: number; max_retries: number }>();
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
    } else if (task.status === "failed" || (task.status === "timeout" && task.retry_count >= task.max_retries)) {
      if (row.task_status !== "failed") {
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
      }
    } else {
      // 有重试额度的 timeout 会被 Cron 重新排队，按还在识别算
      const nextStatus = task.status === "timeout" ? "pending" : task.status;
      if (row.task_status !== nextStatus) {
        await env.DB.prepare(
          "UPDATE reimbursement_invoice_review SET task_status = ?, updated_at = ? WHERE id = ?"
        )
          .bind(nextStatus, nowIso(), row.id)
          .run();
      }
    }
  }
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
    await refreshInvoiceReviewRows(env, envelopeId);

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

    const attachmentRows = await env.DB.prepare(
      "SELECT * FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id ASC"
    )
      .bind(envelopeId)
      .all<EnvelopeAttachment>();
    const attachments = attachmentRows.results ?? [];
    const activeAttachmentIds = new Set(attachments.map((attachment) => attachment.id));

    const totals = computeReviewTotals(
      buildAttachmentViews({
        attachments,
        reviews: syncedRows.results ?? [],
        duplicates: [],
        anomalies: [],
        envelopeStatus: envelope.status
      }),
      envelope.amount || 0
    );

    const rows = (syncedRows.results ?? []).filter((row) => activeAttachmentIds.has(row.attachment_id));
    const pendingCount = totals.recognizing_count;
    const completedRows = rows.filter((row) => row.task_status === "completed");
    const failedCount = totals.failed_count;
    const ocrStatus =
      attachments.length === 0 ? "none" : pendingCount > 0 ? "pending" : completedRows.length > 0 ? "completed" : "failed";
    const bestRow = pickBestReviewRow(completedRows) ?? rows[0];

    const extractedTotal = totals.extracted_total;
    const amountDelta = Number(((envelope.amount || 0) - extractedTotal).toFixed(2));
    const amountMismatch = totals.mismatch;

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
          extracted_total: extractedTotal,
          delta: amountDelta,
          mismatch: amountMismatch
        }
      })
    };

    await applyDuplicateChecks(env, envelopeId, { ...hints, attachment_id: bestRow?.attachment_id ?? null });
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
         silent_review_result = ?,
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
          // 其余字段每次覆盖，只有 AI 合理性结果（ai_reasonability*）沿用已有内容
          ...(parseStoredJson(envelope.silent_review_result ?? null) ?? {}),
          review_round: latestReviewRound,
          channel: envelope.channel,
          strategy:
            envelope.channel === "electronic"
              ? "电子发票二维码优先提取+历史比对+费用合理性AI辅助"
              : "实体票据OCR/Vision双通道识别+冗余安全兜底",
          summary: amountMismatch
            ? "检测到票据合计与申报金额不一致，请办公室优先复核金额与票据明细"
            : pendingCount > 0
              ? "票据仍在识别，完成后自动更新"
              : totals.complete
                ? "静默审查已完成，建议结合AI建议与附件原件进行确认"
                : "部分票据没有读出金额，请办公室按原件核对",
          invoice_review: {
            total: attachments.length,
            completed: completedRows.length,
            failed: failedCount,
            pending: pendingCount
          },
          amount_consistency: {
            declared_amount: envelope.amount,
            extracted_total: extractedTotal,
            delta: amountDelta,
            mismatch: amountMismatch,
            conclusion: amountMismatch
              ? "票据合计与申报金额存在差异，需办公室人工复核"
              : totals.complete
                ? "票据合计与申报金额一致"
                : "票据还没有全部读出金额，暂不比较"
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
           duplicate_check_status = 'completed',
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

  if (!hasReviewRows && ["pending", "failed"].includes(envelope.duplicate_check_status)) {
    // 没有附件就没有要等的识别，否则复核通过会一直等下去
    const activeAttachment = await env.DB.prepare(
      "SELECT 1 AS found FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' LIMIT 1"
    )
      .bind(envelopeId)
      .first<{ found: number }>();
    if (!activeAttachment) {
      await env.DB.prepare(
        "UPDATE reimbursement_envelope SET duplicate_check_status = 'completed', updated_at = ? WHERE id = ?"
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
    const rawResult = parseTaskResult(anomalyTask.result_json ?? null);
    const normalizedResult = normalizeAnomalyResult(rawResult);
    const latestSilentReviewRow = await env.DB.prepare(
      "SELECT silent_review_result FROM reimbursement_envelope WHERE id = ?"
    )
      .bind(envelopeId)
      .first<{ silent_review_result: string | null }>();
    const existingSilentReview = parseStoredJson(latestSilentReviewRow?.silent_review_result ?? null);
    const mergedSilentReview = {
      ...(existingSilentReview ?? {}),
      ai_reasonability: { ...(rawResult ?? {}), ...normalizedResult },
      ai_reasonability_summary: normalizedResult.summary
    };
    await env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         silent_review_result = ?,
         precheck_status = CASE WHEN precheck_status = 'none' THEN 'pending' ELSE precheck_status END,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(JSON.stringify(mergedSilentReview), nowIso(), envelopeId)
      .run();
  }

  // AI 故障不能挡住同步和办公室：建不成就等下一次同步
  try {
    await ensureAnomalyReview(env, envelopeId);
  } catch (error) {
    console.error("Reimbursement anomaly review create failed", { envelope_id: envelopeId, error });
  }
};
