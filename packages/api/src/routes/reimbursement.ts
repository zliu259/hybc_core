import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createTask } from "../services/ai-slot";
import { publishEvent } from "../services/event-bus";
import { submitForApproval } from "../services/approval/engine";
import { generateSerial } from "../services/serial";
import type { Env } from "../types/env";
import type {
  BatchGenerateEnvelopeRequest,
  CreateReimbursementBatchRequest,
  CreateEnvelopeRequest,
  ElectronicUploadRequest,
  EnvelopeAttachment,
  PrecheckEnvelopeRequest,
  ReimbursementBatch,
  ReimbursementDuplicateCheck,
  ReimbursementEnvelope,
  ScanEnvelopeRequest,
  SubmitReimbursementBatchApprovalRequest,
  UpdateEnvelopeRequest,
  VerifyEnvelopeRequest
} from "../types/reimbursement";

const nowIso = () => new Date().toISOString();

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

const applyDuplicateChecks = async (env: Env, envelopeId: number): Promise<number> => {
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

  if (envelope.invoice_no?.trim()) {
    const rows = await env.DB.prepare(
      `SELECT id, project_id, invoice_no FROM reimbursement_envelope
       WHERE id != ? AND status != 'deleted' AND invoice_no = ?`
    )
      .bind(envelopeId, envelope.invoice_no.trim())
      .all<{ id: number; project_id: number; invoice_no: string }>();

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
          row.invoice_no,
          matchType,
          1,
          matchType === "exact" ? "发票号完全重复" : "发票号跨项目重复",
          JSON.stringify({ matched_envelope_id: row.id, invoice_no: row.invoice_no }),
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
      .bind(envelopeId, envelope.amount, envelope.expense_date, envelope.expense_date)
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

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET duplicate_check_status = 'completed', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), envelopeId)
    .run();

  return count;
};

export const reimbursementRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

reimbursementRoutes.use("*", authMiddleware);

reimbursementRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const projectId = c.req.query("project_id");
  const applicantUserid = c.req.query("applicant_userid");
  const channel = c.req.query("channel");
  const keyword = c.req.query("keyword");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM reimbursement_envelope WHERE status != 'deleted'";
  let countSql = "SELECT COUNT(*) as total FROM reimbursement_envelope WHERE status != 'deleted'";
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
  if (channel) {
    sql += " AND channel = ?";
    countSql += " AND channel = ?";
    params.push(channel);
  }
  if (keyword) {
    sql += " AND (envelope_no LIKE ? OR envelope_uuid LIKE ? OR IFNULL(invoice_no, '') LIKE ? OR IFNULL(description, '') LIKE ?)";
    countSql += " AND (envelope_no LIKE ? OR envelope_uuid LIKE ? OR IFNULL(invoice_no, '') LIKE ? OR IFNULL(description, '') LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  sql += " ORDER BY id DESC LIMIT ? OFFSET ?";

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
  requireRoles(["super_admin", "manager", "site_manager"]),
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
  requireRoles(["super_admin", "manager", "site_manager"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
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
  "/batch/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
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
      .all();

    const duplicateSummary = await c.env.DB.prepare(
      `SELECT d.risk_level, COUNT(*) as cnt
       FROM reimbursement_duplicate_check d
       JOIN reimbursement_batch_item bi ON bi.envelope_id = d.envelope_id
       WHERE bi.batch_id = ?
       GROUP BY d.risk_level`
    )
      .bind(id)
      .all<{ risk_level: string; cnt: number }>();

    return c.json({
      success: true,
      data: {
        ...batch,
        items: items.results ?? [],
        duplicate_summary: duplicateSummary.results ?? []
      }
    });
  }
);

reimbursementRoutes.post(
  "/batch",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const body = (await c.req.json()) as CreateReimbursementBatchRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!body.applicant_userid?.trim()) {
      return c.json({ success: false, error: { message: "applicant_userid is required" } }, 400);
    }

    const baseEnvelopeSql =
      body.envelope_ids && body.envelope_ids.length > 0
        ? `SELECT * FROM reimbursement_envelope
           WHERE status != 'deleted'
             AND id IN (${body.envelope_ids.map(() => "?").join(",")})`
        : `SELECT * FROM reimbursement_envelope
           WHERE status = 'received' AND precheck_status = 'approved'
             AND batch_id IS NULL AND project_id = ? AND applicant_userid = ?`;

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
        item.status === "received" &&
        item.precheck_status === "approved"
    );

    if (selected.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "No eligible envelopes. Require status=received, precheck_status=approved, same project/applicant, and not batched."
          }
        },
        400
      );
    }

    const now = nowIso();
    const batchNo = await generateSerial(c.env.DB, "RM", "reimbursement_batch", "batch_no");
    const totalAmount = selected.reduce((sum, item) => sum + (item.amount || 0), 0);

    const insertBatch = await c.env.DB.prepare(
      `INSERT INTO reimbursement_batch
        (batch_no, project_id, applicant_userid, total_amount, item_count, status, ai_audit_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', 'none', ?, ?)`
    )
      .bind(
        batchNo,
        body.project_id,
        body.applicant_userid.trim(),
        totalAmount,
        selected.length,
        now,
        now
      )
      .run();

    const batchId = insertBatch.meta.last_row_id as number;

    for (const envelope of selected) {
      await c.env.DB.prepare(
        `INSERT INTO reimbursement_batch_item
          (batch_id, envelope_id, amount, status, created_at)
         VALUES (?, ?, ?, 'active', ?)`
      )
        .bind(batchId, envelope.id, envelope.amount, now)
        .run();

      await c.env.DB.prepare(
        "UPDATE reimbursement_envelope SET batch_id = ?, status = 'batched', updated_at = ? WHERE id = ?"
      )
        .bind(batchId, now, envelope.id)
        .run();
    }

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_CREATED", "reimbursement_batch", {
      batch_id: batchId,
      batch_no: batchNo,
      project_id: body.project_id,
      applicant_userid: body.applicant_userid.trim(),
      item_count: selected.length,
      total_amount: totalAmount
    });

    return c.json(
      {
        success: true,
        data: {
          id: batchId,
          batch_no: batchNo,
          total_amount: totalAmount,
          item_count: selected.length
        }
      },
      201
    );
  }
);

reimbursementRoutes.post(
  "/batch/:id/trigger-audit",
  requireRoles(["super_admin", "manager", "site_manager"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager"]),
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

    if (batch.approval_instance_id) {
      const existing = await c.env.DB.prepare("SELECT status FROM approval_instance WHERE id = ?")
        .bind(batch.approval_instance_id)
        .first<{ status: string }>();

      if (existing && (existing.status === "pending" || existing.status === "in_progress")) {
        return c.json(
          { success: false, error: { message: "Approval instance already in progress" } },
          400
        );
      }
    }

    const instance = await submitForApproval(
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
          biz_id: id
        },
        instance_config: body.instance_config
      },
      auth.sub
    );

    const now = nowIso();

    await c.env.DB.prepare(
      "UPDATE reimbursement_batch SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(instance.id, now, id)
      .run();

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'pending_approval', approval_instance_id = ?, updated_at = ? WHERE batch_id = ?"
    )
      .bind(instance.id, now, id)
      .run();

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_SUBMITTED", "reimbursement_batch", {
      batch_id: id,
      batch_no: batch.batch_no,
      approval_instance_id: instance.id,
      submitted_by: auth.sub
    });

    return c.json({
      success: true,
      data: { approval_instance_id: instance.id, instance_no: instance.instance_no }
    });
  }
);

reimbursementRoutes.post(
  "/batch/:id/mark-paid",
  requireRoles(["super_admin", "manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const batch = await c.env.DB.prepare("SELECT * FROM reimbursement_batch WHERE id = ?")
      .bind(id)
      .first<ReimbursementBatch>();

    if (!batch) {
      return c.json({ success: false, error: { message: "Batch not found" } }, 404);
    }

    if (batch.status !== "approved") {
      return c.json({ success: false, error: { message: "Only approved batch can be marked as paid" } }, 400);
    }

    const now = nowIso();
    await c.env.DB.prepare("UPDATE reimbursement_batch SET status = 'paid', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'paid', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, id)
      .run();

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_PAID", "reimbursement_batch", {
      batch_id: id,
      batch_no: batch.batch_no,
      total_amount: batch.total_amount
    });

    return c.json({ success: true });
  }
);

reimbursementRoutes.post(
  "/electronic-upload",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as ElectronicUploadRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }
    if (!body.file_key?.trim()) {
      return c.json({ success: false, error: { message: "file_key is required" } }, 400);
    }

    const now = nowIso();
    const envelopeNo = await generateSerial(
      c.env.DB,
      "RM",
      "reimbursement_envelope",
      "envelope_no"
    );
    const envelopeUuid = crypto.randomUUID();

    const insertResult = await c.env.DB.prepare(
      `INSERT INTO reimbursement_envelope
        (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
         invoice_no, expense_date, amount, description,
         status, precheck_status, verification_status, ocr_status,
         duplicate_check_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'electronic', ?, ?, ?, ?, 'submitted', 'none', 'pending', 'pending', 'pending', ?, ?)`
    )
      .bind(
        envelopeNo,
        envelopeUuid,
        body.project_id,
        body.applicant_userid ?? auth.sub,
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

    const ocrTask = await createTask(c.env, {
      task_type: "ocr_extract",
      biz_type: "reimbursement_envelope",
      biz_id: envelopeId,
      priority: 4,
      payload: {
        envelope_id: envelopeId,
        file_key: body.file_key,
        file_name: body.file_name,
        project_id: body.project_id
      },
      timeout_seconds: 300
    });

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(ocrTask.id, nowIso(), envelopeId)
      .run();

    return c.json(
      {
        success: true,
        data: {
          id: envelopeId,
          envelope_no: envelopeNo,
          envelope_uuid: envelopeUuid,
          ocr_task_id: ocrTask.id
        }
      },
      201
    );
  }
);

reimbursementRoutes.get("/:id/ocr-status", async (c) => {
  const id = Number(c.req.param("id"));
  const envelope = await c.env.DB.prepare(
    "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<ReimbursementEnvelope>();

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
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
    const invoiceNo =
      typeof result?.invoice_no === "string"
        ? result.invoice_no
        : typeof result?.invoice_number === "string"
          ? result.invoice_number
          : envelope.invoice_no;
    const amount =
      typeof result?.amount === "number"
        ? result.amount
        : typeof result?.total_amount === "number"
          ? result.total_amount
          : envelope.amount;
    const issueDate =
      typeof result?.issue_date === "string"
        ? result.issue_date
        : typeof result?.date === "string"
          ? result.date
          : envelope.expense_date;

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         ocr_status = 'completed',
         invoice_no = COALESCE(?, invoice_no),
         amount = COALESCE(?, amount),
         expense_date = COALESCE(?, expense_date),
         status = 'submitted',
         updated_at = ?
       WHERE id = ?`
    )
      .bind(invoiceNo ?? null, amount ?? null, issueDate ?? null, nowIso(), id)
      .run();

    duplicateCount = await applyDuplicateChecks(c.env, id);
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
      result,
      duplicate_count: duplicateCount
    }
  });
});

reimbursementRoutes.post(
  "/:id/trigger-anomaly-check",
  requireRoles(["super_admin", "manager", "site_manager"]),
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

    const duplicateCount = await applyDuplicateChecks(c.env, id);

    const task = await createTask(c.env, {
      task_type: "reimbursement_anomaly",
      biz_type: "reimbursement_envelope",
      biz_id: id,
      priority: 4,
      payload: {
        envelope_id: id,
        amount: envelope.amount,
        duplicate_count: duplicateCount,
        project_id: envelope.project_id,
        applicant_userid: envelope.applicant_userid
      },
      timeout_seconds: 300
    });

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET precheck_status = 'pending', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true, data: { task_id: task.id, precheck_status: "pending" } });
  }
);

reimbursementRoutes.get("/:id/anomaly-status", async (c) => {
  const id = Number(c.req.param("id"));

  const envelope = await c.env.DB.prepare(
    "SELECT id, precheck_status FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<{ id: number; precheck_status: string }>();

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
      result: parseTaskResult(task?.result_json ?? null)
    }
  });
});

reimbursementRoutes.post(
  "/:id/precheck",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as PrecheckEnvelopeRequest;

    if (!["approved", "supplement", "rejected"].includes(body.action)) {
      return c.json(
        { success: false, error: { message: "action must be approved/supplement/rejected" } },
        400
      );
    }

    const envelope = await c.env.DB.prepare(
      "SELECT id, status FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<{ id: number; status: string }>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
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
  const envelope = await c.env.DB.prepare(
    "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<ReimbursementEnvelope>();

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

reimbursementRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateEnvelopeRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }

    const now = nowIso();
    const envelopeNo = await generateSerial(
      c.env.DB,
      "RM",
      "reimbursement_envelope",
      "envelope_no"
    );
    const envelopeUuid = crypto.randomUUID();

    const result = await c.env.DB.prepare(
      `INSERT INTO reimbursement_envelope
        (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
         invoice_no, expense_date, amount, category, description,
         status, precheck_status, verification_status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', 'pending', ?, ?)`
    )
      .bind(
        envelopeNo,
        envelopeUuid,
        body.project_id,
        body.applicant_userid ?? auth.sub,
        body.channel ?? "physical",
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

    return c.json(
      {
        success: true,
        data: { id: envelopeId, envelope_no: envelopeNo, envelope_uuid: envelopeUuid }
      },
      201
    );
  }
);

reimbursementRoutes.put(
  "/:id",
  requireRoles(["super_admin", "manager", "site_manager", "operator"]),
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
      ["super_admin", "manager", "site_manager"].includes(role)
    );

    if (!isPrivileged && existing.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    if (["received", "batched", "pending_approval", "approved", "paid"].includes(existing.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${existing.status} cannot be modified` }
        },
        400
      );
    }

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         project_id = COALESCE(?, project_id),
         applicant_userid = COALESCE(?, applicant_userid),
         channel = COALESCE(?, channel),
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
    }

    return c.json({ success: true });
  }
);

reimbursementRoutes.post(
  "/batch-generate",
  requireRoles(["super_admin", "manager", "site_manager"]),
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
      const envelopeNo = await generateSerial(
        c.env.DB,
        "RM",
        "reimbursement_envelope",
        "envelope_no"
      );
      const envelopeUuid = crypto.randomUUID();

      const result = await c.env.DB.prepare(
        `INSERT INTO reimbursement_envelope
          (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
           status, precheck_status, verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'physical', 'draft', 'none', 'pending', ?, ?)`
      )
        .bind(envelopeNo, envelopeUuid, body.project_id, body.applicant_userid ?? auth.sub, now, now)
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

  await c.env.DB.prepare(
    `UPDATE reimbursement_envelope SET
       project_id = COALESCE(?, project_id),
       applicant_userid = COALESCE(?, applicant_userid),
       invoice_no = COALESCE(?, invoice_no),
       expense_date = COALESCE(?, expense_date),
       amount = COALESCE(?, amount),
       category = COALESCE(?, category),
       description = COALESCE(?, description),
       status = 'submitted',
       submitted_at = ?,
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.project_id ?? null,
      envelope.applicant_userid || auth.sub,
      body.invoice_no ?? null,
      body.expense_date ?? null,
      body.amount ?? null,
      body.category ?? null,
      body.description ?? null,
      now,
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

  return c.json({ success: true, data: { id: envelope.id, status: "submitted" } });
});

reimbursementRoutes.post(
  "/verify",
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
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
  requireRoles(["super_admin", "manager", "site_manager"]),
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
  const envelope = await c.env.DB.prepare(
    "SELECT pdf_task_id, pdf_status, pdf_file_key FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
  )
    .bind(id)
    .first<{ pdf_task_id: number | null; pdf_status: string; pdf_file_key: string | null }>();

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
