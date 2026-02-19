import { Hono } from "hono";

import { apiKeyMiddleware } from "../middleware/api-key";
import type { Env } from "../types/env";
import { checkApprovalTimeouts } from "../services/approval/engine";
import { checkTimeouts } from "../services/ai-slot";
import { createTask } from "../services/ai-slot";
import { checkNodeHeartbeat, detectMissingLogs, requeueTimedOutTasks } from "../services/cron-jobs";

export const systemRoutes = new Hono<{ Bindings: Env }>();

systemRoutes.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "api",
    env: c.env.APP_ENV,
    now: new Date().toISOString()
  });
});

systemRoutes.get("/storage-check", async (c) => {
  const marker = `ping-${Date.now()}`;
  const key = `health/${marker}.txt`;

  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind("system_check", "api", JSON.stringify({ marker }), new Date().toISOString())
    .run();

  await c.env.FILES.put(key, marker, {
    httpMetadata: { contentType: "text/plain" }
  });

  await c.env.KV.put(`health:${marker}`, marker);

  const file = await c.env.FILES.get(key);
  const value = file ? await file.text() : null;
  const kvValue = await c.env.KV.get(`health:${marker}`);

  await c.env.EVENT_QUEUE.send({
    type: "system.storage_check",
    marker,
    at: new Date().toISOString()
  });

  return c.json({
    ok: true,
    d1Inserted: marker,
    r2Key: key,
    r2Value: value,
    kvValue
  });
});

systemRoutes.get("/automation/approval-notification", apiKeyMiddleware, async (c) => {
  const now = new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT ai.id as instance_id, ai.instance_no, ai.biz_type, ai.biz_summary,
            at2.assignee_userid, at2.created_at as task_created_at
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
     WHERE at2.status = 'pending'
       AND (julianday(?) - julianday(at2.created_at)) * 24 >= 1
     ORDER BY at2.created_at ASC
     LIMIT 200`
  )
    .bind(now)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/risk-alert", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, task_code, task_type, biz_type, biz_id, status, error_message, updated_at
     FROM task_queue
     WHERE status IN ('failed', 'timeout')
       AND task_type IN ('payment_risk_assessment', 'reimbursement_anomaly', 'inventory_alert_analysis', 'consumption_anomaly')
     ORDER BY updated_at DESC
     LIMIT 200`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/monthly-financial-report", apiKeyMiddleware, async (c) => {
  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const endExpr = `${month}-31`;

  const outbound = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(amount), 0) as total
     FROM payment_request
     WHERE status = 'paid'
       AND DATE(payment_date) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  const inbound = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(amount), 0) as total
     FROM receipt
     WHERE status != 'deleted'
       AND DATE(received_date) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  const reimburse = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(total_amount), 0) as total
     FROM reimbursement_batch
     WHERE status = 'paid'
       AND DATE(updated_at) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: {
      month,
      outbound_paid_amount: outbound?.total ?? 0,
      inbound_received_amount: inbound?.total ?? 0,
      reimbursement_paid_amount: reimburse?.total ?? 0
    }
  });
});

systemRoutes.get("/automation/contract-expiry-reminder", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, contract_no, counterparty, contract_date, direction, status
     FROM contract
     WHERE status = 'active'
       AND DATE(contract_date) <= DATE('now', '-335 day')
       AND DATE(contract_date) >= DATE('now', '-395 day')
     ORDER BY contract_date ASC
     LIMIT 200`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/log-missing-alert", apiKeyMiddleware, async (c) => {
  const date = c.req.query("date") ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT p.id as project_id, p.project_name
     FROM project p
     WHERE p.status IN ('preparing', 'active', 'completing')
       AND NOT EXISTS (
         SELECT 1 FROM operator_log ol
         WHERE ol.project_id = p.id
           AND ol.status != 'deleted'
           AND ol.log_date = ?
       )
     ORDER BY p.id DESC`
  )
    .bind(date)
    .all();
  return c.json({ success: true, data: { date, projects: rows.results ?? [] } });
});

systemRoutes.get("/automation/contact-sync", apiKeyMiddleware, async (c) => {
  const now = new Date().toISOString();
  await c.env.KV.put("wecom:contacts:last_sync_at", now);
  return c.json({ success: true, data: { synced_at: now, mode: "placeholder" } });
});

systemRoutes.post("/automation/project-init", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { project_id?: number; project_name?: string };
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      "project_init",
      "n8n",
      JSON.stringify({ project_id: body.project_id ?? null, project_name: body.project_name ?? null, created_at: now }),
      now
    )
    .run();
  return c.json({ success: true, data: { handled_at: now } }, 201);
});

systemRoutes.post("/automation/daily-log-summary", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project_id?: number;
    date_from?: string;
    date_to?: string;
  };
  const task = await createTask(c.env, {
    task_type: "log_summary",
    biz_type: "construction_log",
    biz_id: body.project_id ?? 0,
    payload: {
      report_type: "daily",
      project_id: body.project_id ?? null,
      date_from: body.date_from ?? null,
      date_to: body.date_to ?? null
    },
    priority: 5
  });
  return c.json({ success: true, data: { task_id: task.id } }, 201);
});

systemRoutes.post("/automation/weekly-log-summary", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project_id?: number;
    date_from?: string;
    date_to?: string;
  };
  const task = await createTask(c.env, {
    task_type: "log_summary",
    biz_type: "construction_log",
    biz_id: body.project_id ?? 0,
    payload: {
      report_type: "weekly",
      project_id: body.project_id ?? null,
      date_from: body.date_from ?? null,
      date_to: body.date_to ?? null
    },
    priority: 5
  });
  return c.json({ success: true, data: { task_id: task.id } }, 201);
});

systemRoutes.get("/automation/inventory-alert-notify", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.warehouse_id, i.asset_type_id, i.quantity,
            w.warehouse_name, at.type_name,
            COALESCE(i.min_stock, at.min_stock, 0) as threshold
     FROM inventory i
     JOIN warehouse w ON w.id = i.warehouse_id
     JOIN asset_type at ON at.id = i.asset_type_id
     WHERE i.status = 'active' AND i.quantity < COALESCE(i.min_stock, at.min_stock, 0)
     ORDER BY i.quantity ASC`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.post("/automation/cron/run", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { job?: string };
  const job = body.job ?? "all";

  const result: Record<string, number> = {};
  if (job === "all" || job === "heartbeat_check") {
    result.heartbeat_check = await checkNodeHeartbeat(c.env);
  }
  if (job === "all" || job === "approval_timeout") {
    result.approval_timeout = await checkApprovalTimeouts(c.env);
  }
  if (job === "all" || job === "task_timeout") {
    result.task_timeout = await checkTimeouts(c.env);
  }
  if (job === "all" || job === "task_requeue") {
    result.task_requeue = await requeueTimedOutTasks(c.env);
  }
  if (job === "all" || job === "log_missing") {
    result.log_missing = await detectMissingLogs(c.env);
  }

  return c.json({ success: true, data: result });
});
