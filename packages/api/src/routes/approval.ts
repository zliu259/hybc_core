import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import type { Env } from "../types/env";
import type {
  SubmitApprovalRequest,
  ReturnRequest,
  TransferRequest,
  ApprovalInstance,
  ApprovalTask
} from "../types/approval";
import {
  submitForApproval,
  getInstanceDetail
} from "../services/approval/engine";
import {
  approve as approveOp,
  reject as rejectOp,
  returnToInitiator,
  returnToPrev,
  returnTo,
  transfer as transferOp,
  withdraw as withdrawOp,
  cancel as cancelOp,
  resubmit as resubmitOp
} from "../services/approval/operations";

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
       ani.node_name as current_node_name
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
     LEFT JOIN approval_node_instance ani ON ani.instance_id = ai.id
       AND ani.node_key = ai.current_node_key AND ani.round = ai.current_round
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
       at2.action, at2.acted_at, at2.comment
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
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

// ─── GET /:id — Full instance detail ──────────

approvalRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const auth = c.get("auth");

  try {
    const detail = await getInstanceDetail(c.env, id, auth.sub);
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
    const instance = await submitForApproval(c.env, body, auth.sub);
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
