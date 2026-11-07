import type { Env } from "../../types/env";
import { ensureInvoiceReviews, syncEnvelopeAuditState } from "./review-pipeline";

// Cron 对账：提交请求和队列都可能中断，这里补上缺失的识别任务，并同步任务已结束但识别行没更新的单。
// 更老的草稿不补，避免替废弃草稿跑 AI。

const DEFAULT_LIMIT = 10;
const DRAFT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const findEnvelopesMissingReviews = async (env: Env, limit: number): Promise<number[]> => {
  const draftSince = new Date(Date.now() - DRAFT_LOOKBACK_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT DISTINCT e.id FROM reimbursement_envelope e
       JOIN envelope_attachment a ON a.envelope_id = e.id AND a.status = 'active'
      WHERE e.batch_id IS NULL AND e.precheck_status != 'approved'
        AND a.file_key IS NOT NULL AND TRIM(a.file_key) != ''
        AND (e.status IN ('submitted', 'received')
             OR (e.status IN ('draft', 'unregistered') AND a.created_at >= ?))
        AND NOT EXISTS (
          SELECT 1 FROM reimbursement_invoice_review r
           WHERE r.attachment_id = a.id AND r.envelope_id = e.id
             AND r.review_round = (
               SELECT MAX(review_round) FROM reimbursement_invoice_review WHERE envelope_id = e.id
             ))
      LIMIT ?`
  )
    .bind(draftSince, limit)
    .all<{ id: number }>();
  return (rows.results ?? []).map((row) => row.id);
};

const findEnvelopesToSync = async (env: Env, limit: number): Promise<number[]> => {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT r.envelope_id FROM reimbursement_invoice_review r
       JOIN task_queue t ON t.id = r.task_id
       JOIN reimbursement_envelope e ON e.id = r.envelope_id
      WHERE e.status NOT IN ('cancelled', 'deleted')
        AND r.review_round = (
          SELECT MAX(review_round) FROM reimbursement_invoice_review WHERE envelope_id = r.envelope_id
        )
        AND ((r.task_status IN ('pending', 'assigned', 'running')
              AND (t.status IN ('completed', 'failed')
                   OR (t.status = 'timeout' AND t.retry_count >= t.max_retries)))
             OR (r.task_status = 'failed' AND t.status = 'completed'))
      LIMIT ?`
  )
    .bind(limit)
    .all<{ envelope_id: number }>();
  return (rows.results ?? []).map((row) => row.envelope_id);
};

/** 永不抛出，一单出错不影响其他单。ensured 和 synced 都是实际处理成功的单数。 */
export const reconcileReimbursementReviews = async (
  env: Env,
  limit: number = DEFAULT_LIMIT
): Promise<{ ensured: number; synced: number }> => {
  let ensured = 0;
  let synced = 0;

  try {
    for (const envelopeId of await findEnvelopesMissingReviews(env, limit)) {
      try {
        const result = await ensureInvoiceReviews(env, envelopeId);
        await syncEnvelopeAuditState(env, envelopeId);
        if (result.created > 0) ensured += 1;
      } catch (error) {
        console.error("Reimbursement review ensure failed", { envelope_id: envelopeId, error });
      }
    }
  } catch (error) {
    console.error("Reimbursement review reconcile query failed", error);
  }

  try {
    for (const envelopeId of await findEnvelopesToSync(env, limit)) {
      try {
        await syncEnvelopeAuditState(env, envelopeId);
        synced += 1;
      } catch (error) {
        console.error("Reimbursement review sync failed", { envelope_id: envelopeId, error });
      }
    }
  } catch (error) {
    console.error("Reimbursement review sync query failed", error);
  }

  return { ensured, synced };
};
