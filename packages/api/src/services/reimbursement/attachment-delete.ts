import type { Env } from "../../types/env";
import type { EnvelopeAttachment, ReimbursementEnvelope } from "../../types/reimbursement";
import { buildAttachmentViews, type AttachmentReviewState } from "./attachment-state";
import { loadCurrentReviewRows } from "./duplicate-checks";
import { refreshInvoiceReviewRows } from "./review-pipeline";

// 删除报销附件时同步扣减申报金额。谁能删由路由判断，这里只算金额、写库。

export const PRE_SUBMIT_STATUSES = ["draft", "unregistered"];
/** 办公室还能删发票的状态，另外要求还没成批、没送审。 */
export const OFFICE_DELETABLE_STATUSES = ["submitted", "received"];

const roundMoney = (value: number): number => Number(value.toFixed(2));

export interface DeletionTarget {
  fileName: string | null;
  state: AttachmentReviewState;
  /** 和票面合计口径一致：只有识别出金额（recognized）的才扣，其余为 0。 */
  deductedAmount: number;
}

/** 找到要删的附件并算出要扣的金额；附件不存在或已删除时返回 null。 */
export const loadDeletionTarget = async (
  env: Env,
  envelope: Pick<ReimbursementEnvelope, "id" | "status">,
  attachmentId: number
): Promise<DeletionTarget | null> => {
  // 识别任务刚完成、还没同步时先拉回结果，扣的金额才和页面上看到的一致
  try {
    await refreshInvoiceReviewRows(env, envelope.id);
  } catch (error) {
    console.error("Reimbursement review refresh before delete failed", {
      envelope_id: envelope.id,
      error
    });
  }

  const attachments = await env.DB.prepare(
    "SELECT * FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id ASC"
  )
    .bind(envelope.id)
    .all<EnvelopeAttachment>();
  const views = buildAttachmentViews({
    attachments: attachments.results ?? [],
    reviews: await loadCurrentReviewRows(env, envelope.id),
    duplicates: [],
    anomalies: [],
    envelopeStatus: envelope.status
  });
  const view = views.find((item) => item.attachment_id === attachmentId);
  if (!view) return null;

  return {
    fileName: view.file_name,
    state: view.state,
    deductedAmount: view.state === "recognized" ? roundMoney(view.amount ?? 0) : 0
  };
};

export type DeleteAttachmentOutcome =
  | { ok: true; amountBefore: number; amountAfter: number; precheckReset: boolean }
  | { ok: false; reason: "not_found" | "conflict" };

interface EnvelopeAmountRow {
  amount: number | null;
  precheck_status: string;
}

const readEnvelopeAmount = (env: Env, envelopeId: number) =>
  env.DB.prepare("SELECT amount, precheck_status FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<EnvelopeAmountRow>();

/**
 * 删附件并扣申报金额。D1 不支持事务，所以：
 * 1. 先删附件，条件里带上信封状态，删成功（changes = 1）的请求才去扣钱，连点两次不会扣两次；
 * 2. 再按相对值扣金额（并发删两张也不会互相覆盖），最少扣到 0，已复核通过的退回待复核。
 *    草稿没存申报金额（为 0）时仍是 0，页面按票面合计显示；
 * 3. 第 2 步失败或信封状态已变，就把附件恢复，返回 conflict。
 */
export const deleteAttachmentWithDeduction = async (
  env: Env,
  input: {
    envelopeId: number;
    attachmentId: number;
    deductedAmount: number;
    /** 校验权限时信封的状态；写库时状态变了就不删。 */
    expectedStatus: string;
  }
): Promise<DeleteAttachmentOutcome> => {
  const { envelopeId, attachmentId, deductedAmount, expectedStatus } = input;
  const envelopeGuard = "status = ? AND batch_id IS NULL AND approval_instance_id IS NULL";

  const deleted = await env.DB.prepare(
    `UPDATE envelope_attachment SET status = 'deleted'
      WHERE id = ? AND envelope_id = ? AND status = 'active'
        AND EXISTS (SELECT 1 FROM reimbursement_envelope WHERE id = ? AND ${envelopeGuard})`
  )
    .bind(attachmentId, envelopeId, envelopeId, expectedStatus)
    .run();

  if ((deleted.meta.changes ?? 0) === 0) {
    const stillActive = await env.DB.prepare(
      "SELECT id FROM envelope_attachment WHERE id = ? AND envelope_id = ? AND status = 'active'"
    )
      .bind(attachmentId, envelopeId)
      .first<{ id: number }>();
    return { ok: false, reason: stillActive ? "conflict" : "not_found" };
  }

  const before = await readEnvelopeAmount(env, envelopeId);

  const restoreAttachment = () =>
    env.DB.prepare(
      "UPDATE envelope_attachment SET status = 'active' WHERE id = ? AND envelope_id = ? AND status = 'deleted'"
    )
      .bind(attachmentId, envelopeId)
      .run();

  let updatedCount = 0;
  try {
    const updated = await env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         amount = MAX(0, ROUND(COALESCE(amount, 0) - ?, 2)),
         precheck_status = CASE WHEN precheck_status = 'approved' THEN 'pending' ELSE precheck_status END,
         updated_at = ?
       WHERE id = ? AND ${envelopeGuard}`
    )
      .bind(deductedAmount, new Date().toISOString(), envelopeId, expectedStatus)
      .run();
    updatedCount = updated.meta.changes ?? 0;
  } catch (error) {
    await restoreAttachment();
    throw error;
  }

  if (updatedCount === 0) {
    await restoreAttachment();
    return { ok: false, reason: "conflict" };
  }

  const after = await readEnvelopeAmount(env, envelopeId);
  return {
    ok: true,
    amountBefore: before?.amount ?? 0,
    amountAfter: after?.amount ?? 0,
    precheckReset: before?.precheck_status === "approved" && after?.precheck_status === "pending"
  };
};

/** 把这张报销当成「重复对象」的其他报销。删掉重复发票后要重新查重，它们的提醒才会消失。 */
export const listEnvelopesMatchingAsDuplicate = async (
  env: Env,
  envelopeId: number
): Promise<number[]> => {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT envelope_id FROM reimbursement_duplicate_check
      WHERE matched_envelope_id = ? AND envelope_id != ?
      ORDER BY envelope_id DESC
      LIMIT 10`
  )
    .bind(envelopeId, envelopeId)
    .all<{ envelope_id: number }>();
  return (rows.results ?? []).map((row) => row.envelope_id);
};
