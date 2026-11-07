import { Hono, type Context } from "hono";

import type { AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { wakeRunner } from "../services/cron-jobs";
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

reimbursementAttachmentRoutes.post(
  "/:id/attachments/:attachmentId/delete",
  requireRoles(ALL_ROLES),
  async (c) => {
    const id = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));
    const auth = c.get("auth");

    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return fail(c, 400, "attachmentId is required");
    }

    const envelope = await loadEnvelope(c.env, id);
    if (!envelope) return fail(c, 404, "Envelope not found");

    if (!hasOfficeRole(auth.roles) && envelope.applicant_userid !== auth.sub) {
      return fail(c, 403, "Forbidden");
    }

    if (!["draft", "unregistered"].includes(envelope.status) && !isReturned(envelope)) {
      return fail(c, 400, `Attachments can only be removed before submit. Current status: ${envelope.status}`);
    }

    const result = await c.env.DB.prepare(
      "UPDATE envelope_attachment SET status = 'deleted' WHERE id = ? AND envelope_id = ? AND status = 'active'"
    )
      .bind(attachmentId, id)
      .run();
    if ((result.meta.changes ?? 0) === 0) return fail(c, 404, "Attachment not found");

    // 合计和结论要跟着变。同步失败时打开详情页还会再同步一次。
    try {
      await syncEnvelopeAuditState(c.env, id);
    } catch (error) {
      console.error("Reimbursement sync after attachment delete failed", { envelope_id: id, error });
    }

    return c.json({ success: true, data: { id, attachment_id: attachmentId } });
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
