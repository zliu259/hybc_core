import { Hono, type Context } from "hono";

import type { AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit-log";
import { wakeRunner } from "../services/cron-jobs";
import {
  deleteAttachmentWithDeduction,
  listEnvelopesMatchingAsDuplicate,
  loadDeletionTarget,
  OFFICE_DELETABLE_STATUSES,
  PRE_SUBMIT_STATUSES
} from "../services/reimbursement/attachment-delete";
import {
  bindEnvelopeAttachments,
  validateNewAttachments,
  type NewAttachmentInput
} from "../services/reimbursement/attachment-rules";
import {
  ensureInvoiceReviews,
  retryFailedReview,
  syncEnvelopeAuditState
} from "../services/reimbursement/review-pipeline";
import type { Env } from "../types/env";
import type { ReimbursementEnvelope } from "../types/reimbursement";

// 附件的增、删、单张重新识别。权限规则见设计文档第 5 节，路由只判断能不能做，不替代 guidance。

type AppContext = Context<{ Bindings: Env; Variables: AuthVariables }>;

const OFFICE_ROLES = ["super_admin", "manager", "site_manager", "finance"] as const;
const ALL_ROLES = [...OFFICE_ROLES, "operator" as const];
const RETURNED_PRECHECK_STATUSES = ["supplement", "rejected"];
/** 和复核一致：办公室角色不能处理自己的单，财务和超管除外。 */
const SELF_AUDIT_ROLES = ["super_admin", "finance"];
const MAX_DELETE_REASON_LENGTH = 200;

const hasOfficeRole = (roles: string[]): boolean =>
  roles.some((role) => (OFFICE_ROLES as readonly string[]).includes(role));

const fail = (c: AppContext, status: 400 | 403 | 404, message: string) =>
  c.json({ success: false, error: { message } }, status);

const loadEnvelope = (env: Env, id: number) =>
  env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")
    .bind(id)
    .first<ReimbursementEnvelope>();

/** 响应不必等 runner 醒来；vitest 直接 app.request 时没有 executionCtx。 */
const wakeRunnerInBackground = (c: AppContext): void => {
  const wake = wakeRunner(c.env);
  try {
    c.executionCtx.waitUntil(wake);
  } catch {
    void wake;
  }
};

const isReturned = (envelope: ReimbursementEnvelope): boolean =>
  envelope.status === "submitted" && RETURNED_PRECHECK_STATUSES.includes(envelope.precheck_status);

export const reimbursementAttachmentRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

reimbursementAttachmentRoutes.post("/:id/attachments", requireRoles(ALL_ROLES), async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { attachments?: NewAttachmentInput[] };

  if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
    return fail(c, 400, "没有要添加的附件");
  }

  const envelope = await loadEnvelope(c.env, id);
  if (!envelope) return fail(c, 404, "Envelope not found");

  const isOffice = hasOfficeRole(auth.roles);
  if (!isOffice && envelope.applicant_userid !== auth.sub) return fail(c, 403, "Forbidden");

  const editableStatuses = isOffice
    ? ["draft", "unregistered", "submitted", "received"]
    : ["draft", "unregistered", "submitted"];
  if (!editableStatuses.includes(envelope.status) || envelope.batch_id) {
    return fail(c, 400, "这张报销现在不能添加附件");
  }

  const validation = await validateNewAttachments(c.env, id, body.attachments);
  if (!validation.ok) return fail(c, 400, validation.message);

  const attachmentIds = await bindEnvelopeAttachments(
    c.env,
    id,
    validation.attachments.map((item) => ({ ...item, attachment_type: "invoice" }))
  );

  // 已复核通过的单内容变了要重新复核，同时退出成批候选。被退回的单等申请人点重新提交。
  if (envelope.precheck_status === "approved") {
    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET precheck_status = 'pending', updated_at = ? WHERE id = ? AND precheck_status = 'approved'"
    )
      .bind(new Date().toISOString(), id)
      .run();
  }

  // 附件已经绑定好。识别任务建不成时由 Cron 补，不让这次请求失败。
  try {
    const reviews = await ensureInvoiceReviews(c.env, id);
    if (reviews.created > 0) wakeRunnerInBackground(c);
  } catch (error) {
    console.error("Reimbursement attachment review create failed", { envelope_id: id, error });
  }

  return c.json({ success: true, data: { attachment_ids: attachmentIds } });
});

type DeletePermission =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; message: string };

/**
 * 提交前和被退回时，申请人和办公室都能删；已提交、已签收还没成批的，办公室能删（比如重复发票）。
 * 办公室删自己的单和复核一样，只有财务和超管可以。
 */
const resolveDeletePermission = (
  envelope: ReimbursementEnvelope,
  auth: { sub: string; roles: string[] }
): DeletePermission => {
  const isOffice = hasOfficeRole(auth.roles);
  const isApplicant = envelope.applicant_userid === auth.sub;
  if (!isOffice && !isApplicant) return { allowed: false, status: 403, message: "Forbidden" };
  if (envelope.batch_id || envelope.approval_instance_id) {
    return { allowed: false, status: 400, message: "这张报销已经成批或送审，不能再删发票" };
  }
  if (PRE_SUBMIT_STATUSES.includes(envelope.status) || isReturned(envelope)) return { allowed: true };
  if (!isOffice || !OFFICE_DELETABLE_STATUSES.includes(envelope.status)) {
    return { allowed: false, status: 400, message: "这张报销现在不能删发票" };
  }
  const canSelfAudit = auth.roles.some((role) => SELF_AUDIT_ROLES.includes(role));
  if (isApplicant && !canSelfAudit) {
    return { allowed: false, status: 403, message: "不能删自己报销里的发票，请其他办公室同事处理" };
  }
  return { allowed: true };
};

/** 删掉重复发票后，把它当成重复对象的报销重新查重，提醒才会消失。失败不影响这次删除，打开那张详情时还会再查。 */
const resyncMatchedEnvelopes = async (env: Env, envelopeId: number): Promise<void> => {
  try {
    const matchedIds = await listEnvelopesMatchingAsDuplicate(env, envelopeId);
    for (const matchedId of matchedIds) {
      await syncEnvelopeAuditState(env, matchedId);
    }
  } catch (error) {
    console.error("Reimbursement resync of matched envelopes failed", { envelope_id: envelopeId, error });
  }
};

reimbursementAttachmentRoutes.post(
  "/:id/attachments/:attachmentId/delete",
  requireRoles(ALL_ROLES),
  async (c) => {
    const id = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };

    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return fail(c, 400, "attachmentId is required");
    }
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
      return fail(c, 400, "reason must be a string");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    if (reason && reason.length > MAX_DELETE_REASON_LENGTH) {
      return fail(c, 400, `删除原因不能超过 ${MAX_DELETE_REASON_LENGTH} 字`);
    }

    const envelope = await loadEnvelope(c.env, id);
    if (!envelope) return fail(c, 404, "Envelope not found");

    const permission = resolveDeletePermission(envelope, auth);
    if (!permission.allowed) return fail(c, permission.status, permission.message);

    const target = await loadDeletionTarget(c.env, envelope, attachmentId);
    if (!target) return fail(c, 404, "Attachment not found");

    const outcome = await deleteAttachmentWithDeduction(c.env, {
      envelopeId: id,
      attachmentId,
      deductedAmount: target.deductedAmount,
      expectedStatus: envelope.status
    });
    if (!outcome.ok) {
      return outcome.reason === "not_found"
        ? fail(c, 404, "Attachment not found")
        : c.json({ success: false, error: { message: "这张报销刚有变化，请刷新后再试" } }, 409);
    }

    // 合计和结论要跟着变。同步失败时打开详情页还会再同步一次。
    try {
      await syncEnvelopeAuditState(c.env, id);
    } catch (error) {
      console.error("Reimbursement sync after attachment delete failed", { envelope_id: id, error });
    }
    await resyncMatchedEnvelopes(c.env, id);

    // 提交后的删除会改申报金额，记下是谁删的、为什么。草稿里申请人自己删不记。
    if (!PRE_SUBMIT_STATUSES.includes(envelope.status)) {
      try {
        await writeAuditLog(c.env.DB, {
          actorUserId: auth.sub,
          actorRoles: auth.roles,
          action: "reimbursement.envelope.attachment_delete",
          targetType: "reimbursement_envelope",
          targetId: id,
          detail: {
            attachment_id: attachmentId,
            file_name: target.fileName,
            recognition_state: target.state,
            deducted_amount: target.deductedAmount,
            amount_before: outcome.amountBefore,
            amount_after: outcome.amountAfter,
            precheck_reset: outcome.precheckReset,
            envelope_status: envelope.status,
            reason
          }
        });
      } catch (error) {
        console.error("Reimbursement attachment delete audit failed", { envelope_id: id, attachment_id: attachmentId, error });
      }
    }

    return c.json({
      success: true,
      data: {
        id,
        attachment_id: attachmentId,
        deducted_amount: target.deductedAmount,
        amount: outcome.amountAfter,
        precheck_reset: outcome.precheckReset
      }
    });
  }
);

reimbursementAttachmentRoutes.post(
  "/:id/attachments/:attachmentId/rerecognize",
  requireRoles(ALL_ROLES),
  async (c) => {
    const id = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));
    const auth = c.get("auth");

    const envelope = await loadEnvelope(c.env, id);
    if (!envelope) return fail(c, 404, "Envelope not found");

    const isOffice = hasOfficeRole(auth.roles);
    const isApplicant = envelope.applicant_userid === auth.sub;
    if (!isOffice && !isApplicant) return fail(c, 403, "Forbidden");

    if (envelope.precheck_status === "approved") {
      return fail(c, 400, "已复核通过的报销不能重新识别");
    }

    const isApplicantEditable = ["draft", "unregistered"].includes(envelope.status) || isReturned(envelope);
    if (!isOffice && !isApplicantEditable) return fail(c, 403, "Forbidden");
    if (isOffice && !isApplicantEditable && !["submitted", "received"].includes(envelope.status)) {
      return fail(c, 400, "这张报销现在不能重新识别");
    }

    const attachment = await c.env.DB.prepare(
      "SELECT id FROM envelope_attachment WHERE id = ? AND envelope_id = ? AND status = 'active'"
    )
      .bind(attachmentId, id)
      .first<{ id: number }>();
    if (!attachment) return fail(c, 404, "Attachment not found");

    const taskId = await retryFailedReview(c.env, id, attachmentId);
    if (taskId === null) return fail(c, 400, "只有没读出来的附件可以重新识别");

    try {
      await syncEnvelopeAuditState(c.env, id);
    } catch (error) {
      console.error("Reimbursement sync after rerecognize failed", { envelope_id: id, error });
    }
    wakeRunnerInBackground(c);

    return c.json({ success: true, data: { task_id: taskId } });
  }
);
