import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { publishEvent } from "../services/event-bus";
import { submitForApproval } from "../services/approval/engine";
import { generateSerial } from "../services/serial";
import { decideCreateRouteBranch } from "./reimbursement-create-policy";
import type { Env } from "../types/env";
import { reimbursementChannels } from "../types/reimbursement";
import type {
  BatchGenerateEnvelopeRequest,
  CreateReimbursementBatchRequest,
  CreateEnvelopeRequest,
  ElectronicUploadRequest,
  EnvelopeAttachment,
  MarkBatchPaidRequest,
  PrecheckEnvelopeRequest,
  ReimbursementBatch,
  ReimbursementDuplicateCheck,
  ReimbursementEnvelope,
  ReimbursementPaymentVoucherInput,
  ScanEnvelopeRequest,
  SubmitEnvelopeRequest,
  SubmitReimbursementBatchApprovalRequest,
  UpdateEnvelopeRequest,
  VerifyEnvelopeRequest
} from "../types/reimbursement";

const nowIso = () => new Date().toISOString();
const UNASSIGNED_APPLICANT = "__UNASSIGNED__";
const validChannelSet = new Set<string>(reimbursementChannels);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value: string | null | undefined): boolean => {
  const trimmed = String(value || "").trim();
  return Boolean(trimmed && UUID_REGEX.test(trimmed));
};

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

const extractInvoiceUniqueNo = (payload: Record<string, unknown> | null): string | null => {
  if (!payload) return null;
  const candidates = [payload.invoice_unique_no, payload.invoice_number, payload.fphm, payload.invoice_no];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();
      if (normalized) return normalized;
    }
  }
  return null;
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

  const invoiceUniqueNo = envelope.invoice_unique_no?.trim();
  const invoiceNo = envelope.invoice_no?.trim();
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

const enqueueEnvelopeAiAudit = async (
  env: Env,
  envelopeId: number,
  options?: { file_key?: string | null }
) => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") return;

  const duplicateCount = await applyDuplicateChecks(env, envelopeId);
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
      amount: envelope.amount,
      duplicate_count: duplicateCount,
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
    "UPDATE reimbursement_envelope SET precheck_status = 'pending', duplicate_check_status = 'pending', updated_at = ? WHERE id = ?"
  )
    .bind(now, envelopeId)
    .run();

  const fileKey = options?.file_key?.trim();
  const allAttachmentKeys = Array.from(
    new Set(
      (attachments.results ?? [])
        .map(item => item.file_key?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  const preferredKey = fileKey || allAttachmentKeys[allAttachmentKeys.length - 1];
  if (!preferredKey) return;

  const ocrTask = await createTask(env, {
    task_type: "ocr_extract",
    biz_type: "reimbursement_envelope",
    biz_id: envelopeId,
    priority: 4,
    payload: {
      envelope_id: envelopeId,
      file_key: preferredKey,
      project_id: envelope.project_id
    },
    timeout_seconds: 300
  });

  await env.DB.prepare(
    "UPDATE reimbursement_envelope SET ocr_task_id = ?, ocr_status = 'pending', updated_at = ? WHERE id = ?"
  )
    .bind(ocrTask.id, nowIso(), envelopeId)
    .run();
};

const syncEnvelopeAuditState = async (env: Env, envelopeId: number): Promise<void> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();
  if (!envelope) return;

  if (envelope.ocr_task_id) {
    const ocrTask = await env.DB.prepare("SELECT status, result_json FROM task_queue WHERE id = ?")
      .bind(envelope.ocr_task_id)
      .first<{ status: string; result_json: string | null }>();
    const ocrResult = parseTaskResult(ocrTask?.result_json ?? null);

    if (ocrTask?.status === "completed" && envelope.ocr_status !== "completed") {
      const invoiceUniqueNo = extractInvoiceUniqueNo(ocrResult);
      const invoiceNo =
        typeof ocrResult?.invoice_no === "string"
          ? ocrResult.invoice_no
          : typeof ocrResult?.invoice_number === "string"
            ? ocrResult.invoice_number
            : envelope.invoice_no;
      const issueDate =
        typeof ocrResult?.issue_date === "string"
          ? ocrResult.issue_date
          : typeof ocrResult?.date === "string"
            ? ocrResult.date
            : envelope.expense_date;
      const nextStatus =
        envelope.status === "received"
          ? "received"
          : envelope.status === "draft" || envelope.status === "unregistered"
            ? envelope.status
            : "submitted";

      await env.DB.prepare(
        `UPDATE reimbursement_envelope SET
           ocr_status = 'completed',
           invoice_unique_no = COALESCE(?, invoice_unique_no),
           invoice_no = COALESCE(?, invoice_no),
           expense_date = COALESCE(?, expense_date),
           status = ?,
           updated_at = ?
         WHERE id = ?`
      )
        .bind(invoiceUniqueNo, invoiceNo ?? null, issueDate ?? null, nextStatus, nowIso(), envelopeId)
        .run();

      await applyDuplicateChecks(env, envelopeId);
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
    `SELECT status FROM task_queue
     WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
     ORDER BY id DESC LIMIT 1`
  )
    .bind(envelopeId)
    .first<{ status: string }>();

  if (anomalyTask?.status === "completed") {
    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET duplicate_check_status = 'completed', precheck_status = CASE WHEN precheck_status = 'none' THEN 'pending' ELSE precheck_status END, updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), envelopeId)
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

export const reimbursementRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

reimbursementRoutes.use("*", authMiddleware);

reimbursementRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const status = c.req.query("status");
  const projectId = c.req.query("project_id");
  const creatorId = c.req.query("creator_id");
  const applicantUserid = c.req.query("applicant_userid");
  const applicantFilter = creatorId
    ? creatorId === "me"
      ? auth.sub
      : creatorId
    : applicantUserid;
  const channel = c.req.query("channel");
  const keyword = c.req.query("keyword");
  const legacyDataId = c.req.query("legacy_data_id");
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
  if (applicantFilter) {
    sql += " AND applicant_userid = ?";
    countSql += " AND applicant_userid = ?";
    params.push(applicantFilter);
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
  if (legacyDataId) {
    sql += " AND legacy_data_id = ?";
    countSql += " AND legacy_data_id = ?";
    params.push(legacyDataId);
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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

    const batchItems = await c.env.DB.prepare(
      `SELECT e.id, e.envelope_no, e.invoice_no, e.amount, e.category, e.description
       FROM reimbursement_batch_item bi
       JOIN reimbursement_envelope e ON e.id = bi.envelope_id
       WHERE bi.batch_id = ?
       ORDER BY bi.id ASC`
    )
      .bind(id)
      .all<
        Pick<
          ReimbursementEnvelope,
          "id" | "envelope_no" | "invoice_no" | "amount" | "category" | "description"
        >
      >();

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
          biz_id: id,
          batch: {
            batch_no: batch.batch_no,
            applicant_userid: batch.applicant_userid,
            total_amount: batch.total_amount,
            item_count: batch.item_count,
            status: batch.status
          },
          items: (batchItems.results ?? []).map(item => ({
            envelope_id: item.id,
            envelope_no: item.envelope_no,
            invoice_no: item.invoice_no,
            amount: item.amount,
            category: item.category,
            description: item.description
          }))
        },
        instance_config: body.instance_config
      },
      auth.sub,
      createAiGateHandler()
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
  requireRoles(["super_admin", "manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as MarkBatchPaidRequest;

    if (!body.paid_at?.trim()) {
      return c.json({ success: false, error: { message: "paid_at is required" } }, 400);
    }
    if (!body.payment_reference?.trim()) {
      return c.json({ success: false, error: { message: "payment_reference is required" } }, 400);
    }
    if (typeof body.payment_entity_id !== "number" || body.payment_entity_id <= 0) {
      return c.json({ success: false, error: { message: "payment_entity_id is required" } }, 400);
    }
    if (
      typeof body.payment_entity_bank_account_id !== "number" ||
      body.payment_entity_bank_account_id <= 0
    ) {
      return c.json(
        { success: false, error: { message: "payment_entity_bank_account_id is required" } },
        400
      );
    }

    const entity = await c.env.DB.prepare("SELECT id, entity_name FROM entity WHERE id = ? AND status = 'active'")
      .bind(body.payment_entity_id)
      .first<{ id: number; entity_name: string }>();
    if (!entity) {
      return c.json({ success: false, error: { message: "payment entity not found or inactive" } }, 400);
    }

    const bankAccount = await c.env.DB.prepare(
      "SELECT id, entity_id, bank_name, account_no FROM entity_bank_account WHERE id = ? AND status = 'active'"
    )
      .bind(body.payment_entity_bank_account_id)
      .first<{ id: number; entity_id: number; bank_name: string; account_no: string }>();
    if (!bankAccount) {
      return c.json(
        { success: false, error: { message: "payment bank account not found or inactive" } },
        400
      );
    }
    if (bankAccount.entity_id !== body.payment_entity_id) {
      return c.json(
        { success: false, error: { message: "payment bank account does not belong to payment entity" } },
        400
      );
    }

    const vouchers = Array.isArray(body.payment_vouchers)
      ? body.payment_vouchers
          .map((item): ReimbursementPaymentVoucherInput | null => {
            if (!item || typeof item.file_key !== "string" || !item.file_key.trim()) return null;
            return {
              file_key: item.file_key.trim(),
              file_name: item.file_name?.trim() || undefined,
              file_size: item.file_size
            };
          })
          .filter((item): item is ReimbursementPaymentVoucherInput => Boolean(item))
      : [];

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
    const paymentAccountText = `${entity.entity_name} / ${bankAccount.bank_name} / ${bankAccount.account_no}`;
    await c.env.DB.prepare(
      `UPDATE reimbursement_batch SET
         status = 'paid',
         paid_at = ?,
         payment_reference = ?,
         payment_account = ?,
         payment_entity_id = ?,
         payment_entity_bank_account_id = ?,
         payment_vouchers_json = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.paid_at.trim(),
        body.payment_reference.trim(),
        body.payment_account?.trim() || paymentAccountText,
        body.payment_entity_id,
        body.payment_entity_bank_account_id,
        vouchers.length > 0 ? JSON.stringify(vouchers) : null,
        now,
        id
      )
      .run();

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'paid', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, id)
      .run();

    await publishEvent(c.env, "REIMBURSEMENT_BATCH_PAID", "reimbursement_batch", {
      batch_id: id,
      batch_no: batch.batch_no,
      total_amount: batch.total_amount,
      paid_at: body.paid_at.trim(),
      payment_reference: body.payment_reference.trim(),
      payment_entity_id: body.payment_entity_id,
      payment_entity_bank_account_id: body.payment_entity_bank_account_id,
      paid_by_userid: auth.sub
    });

    return c.json({ success: true });
  }
);

reimbursementRoutes.post(
  "/electronic-upload",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
    const envelopeUuid = crypto.randomUUID();
    const envelopeNo = envelopeUuid;

    const insertResult = await c.env.DB.prepare(
      `INSERT INTO reimbursement_envelope
        (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
         invoice_unique_no, invoice_no, expense_date, amount, description,
         status, precheck_status, verification_status, ocr_status,
         duplicate_check_status, received_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'electronic', ?, ?, ?, ?, ?, 'draft', 'none', 'pending', 'none', 'none', NULL, ?, ?)`
    )
      .bind(
        envelopeNo,
        envelopeUuid,
        body.project_id,
        body.applicant_userid ?? auth.sub,
        body.invoice_no ?? null,
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

    await enqueueEnvelopeAiAudit(c.env, envelopeId, {
      file_key: body.file_key
    });

    const latest = await c.env.DB.prepare("SELECT ocr_task_id FROM reimbursement_envelope WHERE id = ?")
      .bind(envelopeId)
      .first<{ ocr_task_id: number | null }>();

    return c.json(
      {
        success: true,
        data: {
          id: envelopeId,
          envelope_no: envelopeNo,
          envelope_uuid: envelopeUuid,
          ocr_task_id: latest?.ocr_task_id ?? null
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
    const invoiceUniqueNo = extractInvoiceUniqueNo(result);
    const invoiceNo =
      typeof result?.invoice_no === "string"
        ? result.invoice_no
        : typeof result?.invoice_number === "string"
          ? result.invoice_number
          : envelope.invoice_no;
    const issueDate =
      typeof result?.issue_date === "string"
        ? result.issue_date
        : typeof result?.date === "string"
          ? result.date
          : envelope.expense_date;

    const nextStatus =
      envelope.status === "received"
        ? "received"
        : envelope.status === "draft" || envelope.status === "unregistered"
          ? envelope.status
          : "submitted";

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         ocr_status = 'completed',
         invoice_unique_no = COALESCE(?, invoice_unique_no),
         invoice_no = COALESCE(?, invoice_no),
         expense_date = COALESCE(?, expense_date),
         status = ?,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(invoiceUniqueNo, invoiceNo ?? null, issueDate ?? null, nextStatus, nowIso(), id)
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as PrecheckEnvelopeRequest;

    if (!["approved", "supplement", "rejected"].includes(body.action)) {
      return c.json(
        { success: false, error: { message: "action must be approved/supplement/rejected" } },
        400
      );
    }

    const envelope = await c.env.DB.prepare(
      `SELECT id, status, duplicate_check_status, duplicate_override_requested, applicant_userid
         FROM reimbursement_envelope
        WHERE id = ? AND status != 'deleted'`
    )
      .bind(id)
      .first<{
        id: number;
        status: string;
        duplicate_check_status: string;
        duplicate_override_requested: number;
        applicant_userid: string;
      }>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const canSelfAudit = auth.roles.includes("super_admin") || auth.roles.includes("finance");
    if (envelope.applicant_userid === auth.sub && !canSelfAudit) {
      return c.json(
        { success: false, error: { message: "Applicant cannot precheck their own reimbursement envelope" } },
        403
      );
    }

    if (body.action === "approved") {
      if (envelope.duplicate_check_status !== "completed") {
        const latestAuditTask = await c.env.DB.prepare(
          `SELECT id, status FROM task_queue
           WHERE biz_type = 'reimbursement_envelope' AND biz_id = ? AND task_type = 'reimbursement_anomaly'
           ORDER BY id DESC LIMIT 1`
        )
          .bind(id)
          .first<{ id: number; status: string }>();

        const runningStatuses = new Set(["pending", "assigned", "running"]);
        const hasRunningAudit =
          latestAuditTask?.status && runningStatuses.has(latestAuditTask.status);

        if (!hasRunningAudit) {
          const latestAttachment = await c.env.DB.prepare(
            `SELECT file_key FROM envelope_attachment
             WHERE envelope_id = ? AND status = 'active'
             ORDER BY id DESC LIMIT 1`
          )
            .bind(id)
            .first<{ file_key: string | null }>();
          await enqueueEnvelopeAiAudit(c.env, id, {
            file_key: latestAttachment?.file_key ?? null
          });
        }

        return c.json(
          {
            success: false,
            error: { message: "Duplicate audit is mandatory before precheck approval" },
            data: {
              wait_for_audit: true,
              audit_triggered: !hasRunningAudit,
              task_id: latestAuditTask?.id ?? null
            }
          },
          409
        );
      }
      const duplicateRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM reimbursement_duplicate_check WHERE envelope_id = ?"
      )
        .bind(id)
        .first<{ cnt: number }>();
      const duplicateCount = duplicateRow?.cnt ?? 0;
      if (duplicateCount > 0 && envelope.duplicate_override_requested !== 1) {
        return c.json(
          {
            success: false,
            error: {
              message: "Duplicate risk exists. Applicant insist-submit is required before office can approve precheck"
            }
          },
          400
        );
      }
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
  await syncEnvelopeAuditState(c.env, id);
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

reimbursementRoutes.get("/resolve/by-uuid", async (c) => {
  const envelopeUuid = c.req.query("envelope_uuid")?.trim();
  if (!envelopeUuid) {
    return c.json({ success: false, error: { message: "envelope_uuid is required" } }, 400);
  }

  const envelope = await c.env.DB.prepare(
    "SELECT id, envelope_no, envelope_uuid, status, applicant_userid FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
  )
    .bind(envelopeUuid)
    .first<
      Pick<
        ReimbursementEnvelope,
        "id" | "envelope_no" | "envelope_uuid" | "status" | "applicant_userid"
      >
    >();

  if (!envelope) {
    return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
  }

  return c.json({
    success: true,
    data: {
      ...envelope,
      registered: envelope.applicant_userid !== UNASSIGNED_APPLICANT && envelope.status !== "unregistered"
    }
  });
});

reimbursementRoutes.post(
  "/",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateEnvelopeRequest;

    if (!body.project_id || body.project_id <= 0) {
      return c.json({ success: false, error: { message: "project_id is required" } }, 400);
    }

    const now = nowIso();
    const requestedApplicant = body.applicant_userid ?? auth.sub;
    const requestedChannel = body.channel ?? "physical";
    const preferredEnvelopeUuid = body.preferred_envelope_uuid?.trim();
    const generatedEnvelopeUuid = crypto.randomUUID();

    if (!validChannelSet.has(requestedChannel)) {
      return c.json({ success: false, error: { message: "Invalid reimbursement channel" } }, 400);
    }

    if (requestedChannel === "physical" && !preferredEnvelopeUuid) {
      return c.json(
        {
          success: false,
          error: { message: "Physical reimbursement requires envelope UUID input or scan before create" }
        },
        400
      );
    }
    if (requestedChannel === "physical" && !isValidUuid(preferredEnvelopeUuid)) {
      return c.json(
        {
          success: false,
          error: { message: "Physical reimbursement UUID must be a valid UUID format" }
        },
        400
      );
    }
    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );

    let existingEnvelope: Pick<
      ReimbursementEnvelope,
      "id" | "status" | "applicant_userid" | "channel" | "envelope_uuid"
    > | null = null;

    if (preferredEnvelopeUuid) {
      existingEnvelope = await c.env.DB.prepare(
        "SELECT * FROM reimbursement_envelope WHERE envelope_uuid = ? AND status != 'deleted'"
      )
        .bind(preferredEnvelopeUuid)
        .first<ReimbursementEnvelope>();
    }

    const decision = decideCreateRouteBranch({
      authSub: auth.sub,
      isPrivileged,
      requestedApplicant,
      requestedChannel,
      preferredEnvelopeUuid,
      generatedEnvelopeUuid,
      unassignedApplicant: UNASSIGNED_APPLICANT,
      existingEnvelope: existingEnvelope ?? undefined
    });

    if (decision.kind === "error") {
      return c.json({ success: false, error: { message: decision.message } }, decision.status);
    }

    if (decision.kind === "bind-existing") {
      await c.env.DB.prepare(
        `UPDATE reimbursement_envelope SET
           envelope_no = ?,
           project_id = COALESCE(?, project_id),
           applicant_userid = ?,
           channel = ?,
           invoice_unique_no = COALESCE(?, invoice_unique_no),
           invoice_no = COALESCE(?, invoice_no),
           expense_date = COALESCE(?, expense_date),
           amount = COALESCE(?, amount),
           category = COALESCE(?, category),
           description = COALESCE(?, description),
           status = ?,
           updated_at = ?
         WHERE id = ?`
      )
        .bind(
          decision.envelopeNo,
          body.project_id ?? null,
          decision.applicantToPersist,
          decision.channelToPersist,
          body.invoice_no ?? null,
          body.invoice_no ?? null,
          body.expense_date ?? null,
          body.amount ?? null,
          body.category ?? null,
          body.description ?? null,
          decision.nextStatus,
          now,
          decision.envelopeId
        )
        .run();

      await insertAttachments(c.env.DB, decision.envelopeId, body.attachments);

      await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_CREATED", "reimbursement_envelope", {
        envelope_id: decision.envelopeId,
        envelope_no: decision.envelopeNo,
        envelope_uuid: decision.envelopeUuid,
        created_by: auth.sub,
        bound_existing: true
      });

      return c.json(
        {
          success: true,
          data: {
            id: decision.envelopeId,
            envelope_no: decision.envelopeNo,
            envelope_uuid: decision.envelopeUuid
          }
        },
        201
      );
    }

    const envelopeUuid = decision.envelopeUuid;
    const envelopeNo = decision.envelopeNo;

    const result = await c.env.DB.prepare(
      `INSERT INTO reimbursement_envelope
        (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
         invoice_unique_no, invoice_no, expense_date, amount, category, description,
         status, precheck_status, verification_status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'none', 'pending', ?, ?)`
    )
      .bind(
        envelopeNo,
        envelopeUuid,
        body.project_id,
        requestedApplicant,
        requestedChannel,
        body.invoice_no ?? null,
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
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
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
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );

    if (!isPrivileged && existing.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    const immutableStatuses = ["batched", "pending_approval", "approved", "paid"];
    const isReceivedLocked = existing.status === "received" && !isPrivileged;
    if (immutableStatuses.includes(existing.status) || isReceivedLocked) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${existing.status} cannot be modified` }
        },
        400
      );
    }

    if (body.channel && !validChannelSet.has(body.channel)) {
      return c.json({ success: false, error: { message: "Invalid reimbursement channel" } }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         project_id = COALESCE(?, project_id),
         applicant_userid = COALESCE(?, applicant_userid),
         channel = COALESCE(?, channel),
         invoice_unique_no = COALESCE(?, invoice_unique_no),
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
      const latestFileKey = body.attachments.find(item => item.file_key?.trim())?.file_key ?? null;
      await enqueueEnvelopeAiAudit(c.env, id, { file_key: latestFileKey });
    }

    return c.json({ success: true });
  }
);

reimbursementRoutes.post(
  "/:id/attachments/:attachmentId/delete",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const attachmentId = Number(c.req.param("attachmentId"));
    const auth = c.get("auth");

    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return c.json({ success: false, error: { message: "attachmentId is required" } }, 400);
    }

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );
    if (!isPrivileged && envelope.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    if (!["draft", "unregistered"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Attachments can only be removed before submit. Current status: ${envelope.status}` }
        },
        400
      );
    }

    const attachment = await c.env.DB.prepare(
      "SELECT id, file_key, status FROM envelope_attachment WHERE id = ? AND envelope_id = ?"
    )
      .bind(attachmentId, id)
      .first<{ id: number; file_key: string; status: string }>();

    if (!attachment || attachment.status !== "active") {
      return c.json({ success: false, error: { message: "Attachment not found" } }, 404);
    }

    await c.env.DB.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?")
      .bind(attachmentId)
      .run();

    return c.json({ success: true, data: { id, attachment_id: attachmentId } });
  }
);

reimbursementRoutes.post(
  "/batch-generate",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
      const envelopeUuid = crypto.randomUUID();
      const envelopeNo = envelopeUuid;

      const result = await c.env.DB.prepare(
        `INSERT INTO reimbursement_envelope
          (envelope_no, envelope_uuid, project_id, applicant_userid, channel,
           status, precheck_status, verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'physical', 'unregistered', 'none', 'pending', ?, ?)`
      )
        .bind(envelopeNo, envelopeUuid, body.project_id, UNASSIGNED_APPLICANT, now, now)
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

  if (["batched", "pending_approval", "approved", "paid", "deleted"].includes(envelope.status)) {
    return c.json(
      {
        success: false,
        error: { message: `Envelope in status ${envelope.status} cannot be scanned for registration` }
      },
      400
    );
  }

  const shouldBindApplicant =
    envelope.applicant_userid === UNASSIGNED_APPLICANT || envelope.status === "unregistered";
  const isPrivileged = auth.roles.some((role) =>
    ["super_admin", "manager", "site_manager", "finance"].includes(role)
  );

  if (!shouldBindApplicant && !isPrivileged && envelope.applicant_userid !== auth.sub) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  await c.env.DB.prepare(
    `UPDATE reimbursement_envelope SET
       project_id = COALESCE(?, project_id),
       applicant_userid = CASE WHEN ? THEN ? ELSE applicant_userid END,
       invoice_unique_no = COALESCE(?, invoice_unique_no),
       invoice_no = COALESCE(?, invoice_no),
       expense_date = COALESCE(?, expense_date),
       amount = COALESCE(?, amount),
       category = COALESCE(?, category),
       description = COALESCE(?, description),
       status = CASE WHEN status = 'unregistered' THEN 'draft' ELSE status END,
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.project_id ?? null,
      shouldBindApplicant ? 1 : 0,
      auth.sub,
      body.invoice_no ?? null,
      body.invoice_no ?? null,
      body.expense_date ?? null,
      body.amount ?? null,
      body.category ?? null,
      body.description ?? null,
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

  const latest = await c.env.DB.prepare(
    "SELECT id, status, applicant_userid FROM reimbursement_envelope WHERE id = ?"
  )
    .bind(envelope.id)
    .first<{ id: number; status: string; applicant_userid: string }>();

  return c.json({
    success: true,
    data: {
      id: envelope.id,
      status: latest?.status ?? envelope.status,
      applicant_userid: latest?.applicant_userid ?? envelope.applicant_userid,
      registered: shouldBindApplicant
    }
  });
});

reimbursementRoutes.post(
  "/:id/submit",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as SubmitEnvelopeRequest;

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    const isPrivileged = auth.roles.some((role) =>
      ["super_admin", "manager", "site_manager", "finance"].includes(role)
    );
    if (!isPrivileged && envelope.applicant_userid !== auth.sub) {
      return c.json({ success: false, error: { message: "Forbidden" } }, 403);
    }

    if (![
      "draft",
      "submitted",
      "unregistered"
    ].includes(envelope.status)) {
      return c.json(
        { success: false, error: { message: `Envelope in status ${envelope.status} cannot submit` } },
        400
      );
    }

    if (envelope.applicant_userid === UNASSIGNED_APPLICANT) {
      return c.json({ success: false, error: { message: "Envelope not registered to applicant yet" } }, 400);
    }

    if (envelope.status === "submitted") {
      return c.json({
        success: true,
        data: {
          id,
          status: "submitted",
          already_submitted: true
        }
      });
    }

    if (envelope.channel === "physical" && !isValidUuid(envelope.envelope_uuid)) {
      return c.json(
        {
          success: false,
          error: {
            message: "Physical envelope must be bound with a valid scanned UUID before submit"
          }
        },
        400
      );
    }

    const attachmentRow = await c.env.DB.prepare(
      "SELECT file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
    )
      .bind(id)
      .first<{ file_key: string | null }>();

    if (!attachmentRow?.file_key) {
      return c.json({ success: false, error: { message: "At least one attachment is required before submit" } }, 400);
    }

    const duplicateCount = await applyDuplicateChecks(c.env, id);
    if (duplicateCount > 0 && body.force_submit !== true) {
      return c.json(
        {
          success: false,
          error: {
            message:
              "Duplicate audit found risks. Applicant must explicitly insist submit before office can continue precheck"
          },
          data: { duplicate_count: duplicateCount, require_force_submit: true }
        },
        409
      );
    }

    const now = nowIso();
    const submitResult = await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET
         status = 'submitted',
         duplicate_override_requested = ?,
         duplicate_override_reason = ?,
         submitted_at = COALESCE(submitted_at, ?),
         updated_at = ?
       WHERE id = ?
         AND status IN ('draft', 'unregistered')`
    )
      .bind(
        body.force_submit === true ? 1 : 0,
        body.force_submit === true ? body.force_submit_reason?.trim() ?? null : null,
        now,
        now,
        id
      )
      .run();

    if ((submitResult.meta.changes ?? 0) === 0) {
      const latest = await c.env.DB.prepare(
        "SELECT status FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
      )
        .bind(id)
        .first<{ status: string }>();

      if (latest?.status === "submitted") {
        return c.json({
          success: true,
          data: {
            id,
            status: "submitted",
            already_submitted: true
          }
        });
      }

      return c.json(
        {
          success: false,
          error: {
            message: `Envelope in status ${latest?.status ?? "unknown"} cannot submit`
          }
        },
        400
      );
    }

    await enqueueEnvelopeAiAudit(c.env, id, {
      file_key: attachmentRow.file_key
    });

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_SCANNED", "reimbursement_envelope", {
      envelope_id: id,
      envelope_uuid: envelope.envelope_uuid,
      submitted_by: auth.sub
    });

    return c.json({ success: true, data: { id, status: "submitted" } });
  }
);

reimbursementRoutes.post(
  "/:id/void",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    if (!envelope) {
      return c.json({ success: false, error: { message: "Envelope not found" } }, 404);
    }

    if (envelope.status === "cancelled") {
      return c.json(
        { success: false, error: { message: "Envelope is already cancelled" } },
        400
      );
    }

    if (["batched", "pending_approval", "approved", "paid"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: {
            message: `Envelope in status ${envelope.status} cannot be cancelled directly`
          }
        },
        400
      );
    }

    await c.env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'cancelled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    await publishEvent(c.env, "REIMBURSEMENT_ENVELOPE_CANCELLED", "reimbursement_envelope", {
      envelope_id: id,
      envelope_uuid: envelope.envelope_uuid,
      previous_status: envelope.status,
      cancelled_by: auth.sub
    });

    return c.json({ success: true, data: { id, status: "cancelled" } });
  }
);

reimbursementRoutes.post(
  "/verify",
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
  async (c) => {
    const auth = c.get("auth");
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

    const canSelfAudit = auth.roles.includes("super_admin") || auth.roles.includes("finance");
    if (envelope.applicant_userid === auth.sub && !canSelfAudit) {
      return c.json(
        { success: false, error: { message: "Applicant cannot verify their own reimbursement envelope" } },
        403
      );
    }

    if (!["submitted", "received"].includes(envelope.status)) {
      return c.json(
        {
          success: false,
          error: { message: `Envelope in status ${envelope.status} cannot be verified` }
        },
        400
      );
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
  requireRoles(["super_admin", "manager", "site_manager", "finance"]),
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
