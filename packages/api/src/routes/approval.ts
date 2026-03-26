import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import type { Env } from "../types/env";
import type {
  SubmitApprovalRequest,
  ReturnRequest,
  TransferRequest,
  ForceTransferRequest,
  UrgeRequest,
  ApprovalInstance,
  ApprovalTask
} from "../types/approval";
import {
  submitForApproval,
  getInstanceDetail,
  advanceWorkflow
} from "../services/approval/engine";
import { createAiGateHandler } from "../services/ai-slot";
import {
  approve as approveOp,
  reject as rejectOp,
  returnToInitiator,
  returnToPrev,
  returnTo,
  transfer as transferOp,
  forceTransferBySuperAdmin,
  withdraw as withdrawOp,
  cancel as cancelOp,
  resubmit as resubmitOp
} from "../services/approval/operations";
import {
  resolveApplicantDisplayName,
  resolveApprovalPushMeta,
  sendApprovalTodoTemplateCard
} from "../services/wecom-approval-push";

export const approvalRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

approvalRoutes.use("*", authMiddleware);

// ─── GET / — List all instances for current user ──────────

approvalRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const bizType = c.req.query("biz_type");
  const status = c.req.query("status");
  const initiator = c.req.query("initiator");
  const keyword = c.req.query("keyword");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let sql = `SELECT DISTINCT ai.* FROM approval_instance ai
    LEFT JOIN approval_task at2 ON at2.instance_id = ai.id
    WHERE (ai.initiator_userid = ? OR at2.assignee_userid = ?)`;
  let countSql = `SELECT COUNT(DISTINCT ai.id) as total FROM approval_instance ai
    LEFT JOIN approval_task at2 ON at2.instance_id = ai.id
    WHERE (ai.initiator_userid = ? OR at2.assignee_userid = ?)`;
  const params: (string | number)[] = [auth.sub, auth.sub];

  if (bizType) {
    sql += " AND ai.biz_type = ?";
    countSql += " AND ai.biz_type = ?";
    params.push(bizType);
  }
  if (status) {
    sql += " AND ai.status = ?";
    countSql += " AND ai.status = ?";
    params.push(status);
  }
  if (initiator) {
    const initiatorFilter = initiator === "me" ? auth.sub : initiator;
    sql += " AND ai.initiator_userid = ?";
    countSql += " AND ai.initiator_userid = ?";
    params.push(initiatorFilter);
  }
  if (keyword) {
    sql += " AND ai.biz_summary LIKE ?";
    countSql += " AND ai.biz_summary LIKE ?";
    params.push(`%${keyword}%`);
  }

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();

  sql += " ORDER BY ai.created_at DESC LIMIT ? OFFSET ?";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all<ApprovalInstance>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

// ─── GET /pending — Pending tasks for current user ──────────

approvalRoutes.get("/pending", async (c) => {
  const auth = c.get("auth");
  const bizType = c.req.query("biz_type");
  const keyword = c.req.query("keyword");
  const status = c.req.query("status");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let whereSql = " WHERE at2.assignee_userid = ? AND at2.status = 'pending'";
  const params: (string | number)[] = [auth.sub];

  if (bizType) {
    whereSql += " AND ai.biz_type = ?";
    params.push(bizType);
  }
  if (keyword) {
    whereSql += " AND ai.biz_summary LIKE ?";
    params.push(`%${keyword}%`);
  }
  if (status) {
    whereSql += " AND ai.status = ?";
    params.push(status);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id${whereSql}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT ai.id, ai.instance_no, ai.biz_type, ai.biz_summary,
       ai.initiator_userid, ai.current_node_key, ai.status, ai.submitted_at,
       at2.id as task_id, at2.status as task_status,
       ani.node_name as current_node_name,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.amount FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.total_amount FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.total_amount FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.total_amount FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.amount_with_tax FROM invoice_request ir WHERE ir.id = ai.biz_id)
         ELSE NULL
       END AS biz_amount,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.project_id FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.project_id FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.project_id FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.project_id FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END AS biz_project_id,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.serial_no || ' | ' || IFNULL(pr.content, '-') FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.contract_no || ' | ' || IFNULL(ct.counterparty, '-') FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.contract_no || ' | ' || IFNULL(ct.counterparty, '-') FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.batch_no || ' | ' || rb.item_count || '单' FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.request_no || ' | ' || IFNULL(ir.customer_name, '-') FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.order_no || ' | ' || IFNULL(so.order_type, '-') FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END AS biz_detail,
       p.project_name,
       p.project_code
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
     LEFT JOIN approval_node_instance ani ON ani.instance_id = ai.id
       AND ani.node_key = ai.current_node_key AND ani.round = ai.current_round
     LEFT JOIN project p ON p.id = (
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.project_id FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.project_id FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.project_id FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.project_id FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END
     )
     ${whereSql}
     ORDER BY at2.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

// ─── GET /processed — Processed tasks for current user ──────────

approvalRoutes.get("/processed", async (c) => {
  const auth = c.get("auth");
  const bizType = c.req.query("biz_type");
  const keyword = c.req.query("keyword");
  const status = c.req.query("status");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let whereSql = " WHERE at2.assignee_userid = ? AND at2.status IN ('completed', 'transferred')";
  const params: (string | number)[] = [auth.sub];

  if (bizType) {
    whereSql += " AND ai.biz_type = ?";
    params.push(bizType);
  }
  if (keyword) {
    whereSql += " AND ai.biz_summary LIKE ?";
    params.push(`%${keyword}%`);
  }
  if (status) {
    whereSql += " AND ai.status = ?";
    params.push(status);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id${whereSql}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT ai.id, ai.instance_no, ai.biz_type, ai.biz_summary,
       ai.initiator_userid, ai.status, ai.submitted_at,
       at2.action, at2.acted_at, at2.comment,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.amount FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.total_amount FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.total_amount FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.total_amount FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.amount_with_tax FROM invoice_request ir WHERE ir.id = ai.biz_id)
         ELSE NULL
       END AS biz_amount,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.project_id FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.project_id FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.project_id FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.project_id FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END AS biz_project_id,
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.serial_no || ' | ' || IFNULL(pr.content, '-') FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.contract_no || ' | ' || IFNULL(ct.counterparty, '-') FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.contract_no || ' | ' || IFNULL(ct.counterparty, '-') FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.batch_no || ' | ' || rb.item_count || '单' FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.request_no || ' | ' || IFNULL(ir.customer_name, '-') FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.order_no || ' | ' || IFNULL(so.order_type, '-') FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END AS biz_detail,
       p.project_name,
       p.project_code
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
     LEFT JOIN project p ON p.id = (
       CASE ai.biz_type
         WHEN 'payment_request' THEN (SELECT pr.project_id FROM payment_request pr WHERE pr.id = ai.biz_id)
         WHEN 'outbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'inbound_contract' THEN (SELECT ct.project_id FROM contract ct WHERE ct.id = ai.biz_id)
         WHEN 'reimbursement_batch' THEN (SELECT rb.project_id FROM reimbursement_batch rb WHERE rb.id = ai.biz_id)
         WHEN 'invoice_request' THEN (SELECT ir.project_id FROM invoice_request ir WHERE ir.id = ai.biz_id)
         WHEN 'stock_order' THEN (SELECT so.project_id FROM stock_order so WHERE so.id = ai.biz_id)
         ELSE NULL
       END
     )
     ${whereSql}
     ORDER BY at2.acted_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

// ─── GET /cc — CC'd instances for current user ──────────

approvalRoutes.get("/cc", async (c) => {
  const auth = c.get("auth");
  const bizType = c.req.query("biz_type");
  const keyword = c.req.query("keyword");
  const status = c.req.query("status");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let whereSql = " WHERE ani.node_type = 'cc' AND at2.assignee_userid = ?";
  const params: (string | number)[] = [auth.sub];

  if (bizType) {
    whereSql += " AND ai.biz_type = ?";
    params.push(bizType);
  }
  if (keyword) {
    whereSql += " AND ai.biz_summary LIKE ?";
    params.push(`%${keyword}%`);
  }
  if (status) {
    whereSql += " AND ai.status = ?";
    params.push(status);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT ai.id) as total FROM approval_instance ai
     JOIN approval_node_instance ani ON ani.instance_id = ai.id
     JOIN approval_task at2 ON at2.node_instance_id = ani.id${whereSql}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT ai.* FROM approval_instance ai
     JOIN approval_node_instance ani ON ani.instance_id = ai.id
     JOIN approval_task at2 ON at2.node_instance_id = ani.id
     ${whereSql}
     ORDER BY ai.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<ApprovalInstance>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

approvalRoutes.get("/remindable", async (c) => {
  const auth = c.get("auth");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT ai.id) as total
     FROM approval_instance ai
     JOIN approval_task at2 ON at2.instance_id = ai.id
     WHERE ai.initiator_userid = ?
       AND ai.status IN ('pending', 'in_progress')
       AND at2.status = 'pending'
       AND at2.assignee_userid IS NOT NULL
       AND at2.assignee_userid != ''`
  )
    .bind(auth.sub)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT ai.id as instance_id,
            ai.instance_no,
            ai.biz_type,
            ai.biz_summary,
            ai.submitted_at,
            COALESCE(ani.node_name, ai.current_node_key, '当前节点') as current_node_name,
            at2.id as task_id,
            at2.assignee_userid,
            at2.created_at as task_created_at
     FROM approval_instance ai
     JOIN approval_task at2 ON at2.instance_id = ai.id
     LEFT JOIN approval_node_instance ani
       ON ani.instance_id = ai.id
      AND ani.node_key = ai.current_node_key
      AND ani.round = ai.current_round
     WHERE ai.initiator_userid = ?
       AND ai.status IN ('pending', 'in_progress')
       AND at2.status = 'pending'
       AND at2.assignee_userid IS NOT NULL
       AND at2.assignee_userid != ''
     ORDER BY ai.submitted_at DESC, at2.created_at ASC
     LIMIT ? OFFSET ?`
  )
    .bind(auth.sub, pageSize, offset)
    .all<{
      instance_id: number;
      instance_no: string;
      biz_type: string;
      biz_summary: string;
      submitted_at: string;
      current_node_name: string;
      task_id: number;
      assignee_userid: string;
      task_created_at: string;
    }>();

  const grouped = new Map<
    number,
    {
      id: number;
      instance_no: string;
      biz_type: string;
      biz_summary: string;
      submitted_at: string;
      current_node_name: string;
      pending_tasks: Array<{ task_id: number; assignee_userid: string; task_created_at: string }>;
    }
  >();

  for (const row of rows.results ?? []) {
    if (!grouped.has(row.instance_id)) {
      grouped.set(row.instance_id, {
        id: row.instance_id,
        instance_no: row.instance_no,
        biz_type: row.biz_type,
        biz_summary: row.biz_summary,
        submitted_at: row.submitted_at,
        current_node_name: row.current_node_name,
        pending_tasks: []
      });
    }
    grouped.get(row.instance_id)?.pending_tasks.push({
      task_id: row.task_id,
      assignee_userid: row.assignee_userid,
      task_created_at: row.task_created_at
    });
  }

  return c.json({
    success: true,
    data: Array.from(grouped.values()),
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

approvalRoutes.get("/admin/all", async (c) => {
  const auth = c.get("auth");
  if (!auth.roles.includes("super_admin")) {
    return c.json({ success: false, error: { message: "Forbidden" } }, 403);
  }

  const bizType = c.req.query("biz_type");
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");
  const initiator = c.req.query("initiator");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "30");
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM approval_instance WHERE 1=1";
  let countSql = "SELECT COUNT(*) as total FROM approval_instance WHERE 1=1";
  const params: (string | number)[] = [];

  if (bizType) {
    sql += " AND biz_type = ?";
    countSql += " AND biz_type = ?";
    params.push(bizType);
  }
  if (status) {
    sql += " AND status = ?";
    countSql += " AND status = ?";
    params.push(status);
  }
  if (initiator) {
    sql += " AND initiator_userid = ?";
    countSql += " AND initiator_userid = ?";
    params.push(initiator);
  }
  if (keyword) {
    sql += " AND biz_summary LIKE ?";
    countSql += " AND biz_summary LIKE ?";
    params.push(`%${keyword}%`);
  }

  const countResult = await c.env.DB.prepare(countSql)
    .bind(...params)
    .first<{ total: number }>();
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const rows = await c.env.DB.prepare(sql)
    .bind(...params, pageSize, offset)
    .all<ApprovalInstance>();

  return c.json({
    success: true,
    data: rows.results ?? [],
    pagination: { page, pageSize, total: countResult?.total ?? 0 }
  });
});

// ─── GET /:id — Full instance detail ──────────

approvalRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");

  try {
    const detail = await getInstanceDetail(c.env, id, auth.sub, auth.roles);
    return c.json({ success: true, data: detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not found";
    return c.json({ success: false, error: { message } }, 404);
  }
});

// ─── POST /submit — Submit new approval ──────────

approvalRoutes.post("/submit", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as SubmitApprovalRequest;

  try {
    const instance = await submitForApproval(c.env, body, auth.sub, createAiGateHandler());
    return c.json({ success: true, data: instance }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submit failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/approve ──────────

approvalRoutes.post("/:id/approve", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as { comment?: string };

  try {
    const task = await findPendingTask(c.env, instanceId, auth.sub);
    await approveOp(c.env, task.id, auth.sub, body.comment);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approve failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/reject ──────────

approvalRoutes.post("/:id/reject", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as { comment?: string };

  try {
    const task = await findPendingTask(c.env, instanceId, auth.sub);
    await rejectOp(c.env, task.id, auth.sub, body.comment);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reject failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/return ──────────

approvalRoutes.post("/:id/return", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as ReturnRequest;

  try {
    const task = await findPendingTask(c.env, instanceId, auth.sub);

    switch (body.type) {
      case "initiator":
        await returnToInitiator(c.env, task.id, auth.sub, body.comment);
        break;
      case "prev":
        await returnToPrev(c.env, task.id, auth.sub, body.comment);
        break;
      case "to":
        if (!body.target_node_key) {
          return c.json(
            { success: false, error: { message: "target_node_key is required for return_to" } },
            400
          );
        }
        await returnTo(c.env, task.id, auth.sub, body.target_node_key, body.comment);
        break;
      default:
        return c.json(
          { success: false, error: { message: "Invalid return type" } },
          400
        );
    }

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Return failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/transfer ──────────

approvalRoutes.post("/:id/transfer", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json()) as TransferRequest;

  try {
    const task = await findPendingTask(c.env, instanceId, auth.sub);
    await transferOp(c.env, task.id, auth.sub, body.to_userid, body.reason);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

approvalRoutes.post("/:id/attachments", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    file_key?: string;
    file_name?: string;
    file_size?: number;
  };

  const fileKey = body.file_key?.trim() || "";
  const fileName = body.file_name?.trim() || fileKey;
  const fileSize = typeof body.file_size === "number" && Number.isFinite(body.file_size)
    ? body.file_size
    : undefined;

  if (!fileKey) {
    return c.json({ success: false, error: { message: "file_key is required" } }, 400);
  }

  const instance = await c.env.DB.prepare(
    `SELECT id, biz_type, biz_id
     FROM approval_instance
     WHERE id = ?
     LIMIT 1`
  )
    .bind(instanceId)
    .first<{ id: number; biz_type: string; biz_id: number }>();

  if (!instance) {
    return c.json({ success: false, error: { message: "Approval instance not found" } }, 404);
  }

  const pendingTask = await c.env.DB.prepare(
    `SELECT id FROM approval_task
     WHERE instance_id = ?
       AND assignee_userid = ?
       AND status = 'pending'
     LIMIT 1`
  )
    .bind(instanceId, auth.sub)
    .first<{ id: number }>();

  const canUpload = Boolean(pendingTask) || auth.roles.includes("super_admin");
  if (!canUpload) {
    return c.json(
      { success: false, error: { message: "No permission to upload attachment on this approval" } },
      403
    );
  }

  const attachmentItem = {
    file_key: fileKey,
    file_name: fileName,
    ...(typeof fileSize === "number" ? { file_size: fileSize } : {})
  };

  const loadAttachmentItems = (raw: string | null): Array<{ file_key: string; file_name: string; file_size?: number }> => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const list: Array<{ file_key: string; file_name: string; file_size?: number }> = [];
      for (const item of parsed) {
        if (typeof item === "string") {
          list.push({ file_key: item, file_name: item });
          continue;
        }
        if (!item || typeof item !== "object") continue;
        const row = item as {
          file_key?: string;
          key?: string;
          file_name?: string;
          name?: string;
          file_size?: number;
          size?: number;
        };
        const key = row.file_key ?? row.key;
        if (!key) continue;
        list.push({
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          ...(typeof row.file_size === "number" ? { file_size: row.file_size } : {}),
          ...(typeof row.size === "number" ? { file_size: row.size } : {})
        });
      }
      return list;
    } catch {
      return [];
    }
  };

  const mergeAttachments = (raw: string | null) => {
    const list = loadAttachmentItems(raw);
    const exists = list.some(item => item.file_key === fileKey);
    if (!exists) {
      list.unshift(attachmentItem);
    }
    return JSON.stringify(list);
  };

  const now = new Date().toISOString();
  if (instance.biz_type === "payment_request") {
    const target = await c.env.DB.prepare("SELECT attachments_json FROM payment_request WHERE id = ? LIMIT 1")
      .bind(instance.biz_id)
      .first<{ attachments_json: string | null }>();
    if (!target) {
      return c.json({ success: false, error: { message: "Payment request not found" } }, 404);
    }
    await c.env.DB.prepare("UPDATE payment_request SET attachments_json = ?, updated_at = ? WHERE id = ?")
      .bind(mergeAttachments(target.attachments_json), now, instance.biz_id)
      .run();
    return c.json({ success: true });
  }

  if (instance.biz_type === "outbound_contract" || instance.biz_type === "inbound_contract") {
    const target = await c.env.DB.prepare("SELECT attachments_json FROM contract WHERE id = ? LIMIT 1")
      .bind(instance.biz_id)
      .first<{ attachments_json: string | null }>();
    if (!target) {
      return c.json({ success: false, error: { message: "Contract not found" } }, 404);
    }
    await c.env.DB.prepare("UPDATE contract SET attachments_json = ?, updated_at = ? WHERE id = ?")
      .bind(mergeAttachments(target.attachments_json), now, instance.biz_id)
      .run();
    return c.json({ success: true });
  }

  return c.json(
    { success: false, error: { message: `Attachments are not supported for biz_type=${instance.biz_type}` } },
    400
  );
});

approvalRoutes.post("/:id/force-transfer", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  if (!auth.roles.includes("super_admin")) {
    return c.json(
      { success: false, error: { message: "Only super_admin can force change approver" } },
      403
    );
  }

  const body = (await c.req.json()) as ForceTransferRequest;
  if (!Number.isFinite(body.task_id) || body.task_id <= 0) {
    return c.json({ success: false, error: { message: "task_id is required" } }, 400);
  }
  if (!body.to_userid?.trim()) {
    return c.json({ success: false, error: { message: "to_userid is required" } }, 400);
  }
  if (!body.reason?.trim()) {
    return c.json({ success: false, error: { message: "reason is required" } }, 400);
  }

  try {
    await forceTransferBySuperAdmin(
      c.env,
      instanceId,
      Number(body.task_id),
      auth.sub,
      body.to_userid.trim(),
      body.reason.trim()
    );
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Force transfer failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

approvalRoutes.post("/:id/force-approve", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  if (!auth.roles.includes("super_admin")) {
    return c.json(
      { success: false, error: { message: "Only super_admin can force approve" } },
      403
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    task_id: number;
    comment?: string;
  };
  if (!Number.isFinite(body.task_id) || body.task_id <= 0) {
    return c.json({ success: false, error: { message: "task_id is required" } }, 400);
  }

  try {
    const task = await c.env.DB.prepare(
      "SELECT * FROM approval_task WHERE id = ? AND instance_id = ? AND status = 'pending'"
    )
      .bind(body.task_id, instanceId)
      .first<ApprovalTask>();
    if (!task) {
      return c.json({ success: false, error: { message: "Pending task not found" } }, 404);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE approval_task SET action = 'approve', comment = ?, status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(body.comment ?? `超管强制通过 (by ${auth.sub})`, now, now, body.task_id)
      .run();

    await advanceWorkflow(c.env, instanceId, createAiGateHandler());

    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "approval_force_approved",
        "approval-route",
        JSON.stringify({
          instance_id: instanceId,
          task_id: body.task_id,
          forced_by: auth.sub
        }),
        now
      )
      .run();

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Force approve failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/withdraw ──────────

approvalRoutes.post("/:id/withdraw", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { comment?: string };

  try {
    await withdrawOp(c.env, instanceId, auth.sub, body.comment);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Withdraw failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/cancel ──────────

approvalRoutes.post("/:id/cancel", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { comment?: string };

  try {
    await cancelOp(c.env, instanceId, auth.sub, auth.roles, body.comment);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── POST /:id/resubmit ──────────

approvalRoutes.post("/:id/resubmit", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { biz_summary?: string };

  try {
    await resubmitOp(c.env, instanceId, auth.sub, body.biz_summary);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resubmit failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

approvalRoutes.post("/:id/urge", async (c) => {
  const instanceId = Number(c.req.param("id"));
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as UrgeRequest;
  if (!Number.isFinite(body.task_id) || body.task_id <= 0) {
    return c.json({ success: false, error: { message: "task_id is required" } }, 400);
  }

  const instance = await c.env.DB.prepare(
    `SELECT ai.id, ai.instance_no, ai.biz_type, ai.biz_id, ai.biz_summary, ai.initiator_userid,
            COALESCE(ani.node_name, ai.current_node_key, '当前节点') as current_node_name
     FROM approval_instance ai
     LEFT JOIN approval_node_instance ani
       ON ani.instance_id = ai.id
      AND ani.node_key = ai.current_node_key
      AND ani.round = ai.current_round
     WHERE ai.id = ?
     LIMIT 1`
  )
    .bind(instanceId)
    .first<{
      id: number;
      instance_no: string;
      biz_type: string;
      biz_id: number;
      biz_summary: string;
      initiator_userid: string;
      current_node_name: string;
    }>();
  if (!instance) {
    return c.json({ success: false, error: { message: "Approval instance not found" } }, 404);
  }

  const canUrge =
    auth.sub === instance.initiator_userid ||
    auth.roles.includes("super_admin") ||
    auth.roles.includes("manager") ||
    auth.roles.includes("site_manager") ||
    auth.roles.includes("finance");
  if (!canUrge) {
    return c.json({ success: false, error: { message: "No permission to urge this approval" } }, 403);
  }

  const task = await c.env.DB.prepare(
    `SELECT id, assignee_userid, status
     FROM approval_task
     WHERE id = ?
       AND instance_id = ?
     LIMIT 1`
  )
    .bind(Number(body.task_id), instanceId)
    .first<{ id: number; assignee_userid: string; status: string }>();
  if (!task || task.status !== "pending" || !task.assignee_userid) {
    return c.json({ success: false, error: { message: "Pending assignee task not found" } }, 400);
  }

  const reason = body.reason?.trim() || "";
  try {
    const applicantName = await resolveApplicantDisplayName(c.env, instance.initiator_userid);
    const pushMeta = await resolveApprovalPushMeta(
      c.env,
      instance.biz_type,
      instance.biz_id,
      instance.biz_summary
    );
    const pushResult = await sendApprovalTodoTemplateCard(
      c.env,
      {
        instanceId,
        instanceNo: instance.instance_no,
        bizType: instance.biz_type,
        bizId: instance.biz_id,
        bizSummary: instance.biz_summary,
        currentNodeName: instance.current_node_name,
        assigneeUserId: task.assignee_userid,
        applicantName,
        requestTitle: pushMeta.requestTitle,
        amountText: pushMeta.amountText ?? undefined
      },
      {
        mode: "urge",
        urgeReason: reason || undefined,
        disableDuplicateCheck: true
      }
    );

    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "wecom_template_card_urge_sent",
        "approval-route",
        JSON.stringify({
          instance_id: instanceId,
          task_id: task.id,
          assignee_userid: task.assignee_userid,
          urged_by: auth.sub,
          reason: reason || null,
          msgid: pushResult.msgid,
          invaliduser: pushResult.invaliduser,
          unlicenseduser: pushResult.unlicenseduser
        }),
        new Date().toISOString()
      )
      .run();

    return c.json({ success: true, data: { assignee_userid: task.assignee_userid } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Urge push failed";
    await c.env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "wecom_template_card_urge_failed",
        "approval-route",
        JSON.stringify({
          instance_id: instanceId,
          task_id: Number(body.task_id),
          assignee_userid: task.assignee_userid,
          urged_by: auth.sub,
          reason: reason || null,
          error: message
        }),
        new Date().toISOString()
      )
      .run();
    return c.json({ success: false, error: { message } }, 400);
  }
});

// ─── Helper ──────────

const findPendingTask = async (
  env: Env,
  instanceId: number,
  userId: string
): Promise<ApprovalTask> => {
  const task = await env.DB.prepare(
    `SELECT * FROM approval_task
     WHERE instance_id = ? AND assignee_userid = ? AND status = 'pending'
     LIMIT 1`
  )
    .bind(instanceId, userId)
    .first<ApprovalTask>();

  if (!task) {
    throw new Error("No pending task found for this user on this instance");
  }

  return task;
};
