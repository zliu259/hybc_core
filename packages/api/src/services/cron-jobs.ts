import { writeAuditLog } from "./audit-log";
import { publishEvent } from "./event-bus";
import { findReimbursementIntegrityIssues, summarizeIntegrityIssues } from "./reimbursement-integrity";
import { getWeComContactBook } from "./wecom-contact-book";
import type { Env } from "../types/env";
import type { ComputeNode, TaskQueueItem } from "../types/ai";

const nowIso = () => new Date().toISOString();

export const checkNodeHeartbeat = async (env: Env, staleMinutes = 10): Promise<number> => {
  const now = nowIso();
  const rows = await env.DB.prepare(
    `SELECT * FROM compute_node
     WHERE status = 'online'
       AND (
         last_heartbeat_at IS NULL
         OR (julianday(?) - julianday(last_heartbeat_at)) * 1440 > ?
       )`
  )
    .bind(now, staleMinutes)
    .all<ComputeNode>();

  const nodes = rows.results ?? [];
  for (const node of nodes) {
    await env.DB.prepare("UPDATE compute_node SET status = 'offline', updated_at = ? WHERE id = ?")
      .bind(now, node.id)
      .run();
    await publishEvent(env, "NODE_OFFLINE", "cron", {
      node_id: node.node_id,
      node_name: node.node_name,
      last_heartbeat_at: node.last_heartbeat_at,
      detected_at: now
    });
  }
  return nodes.length;
};

export const requeueTimedOutTasks = async (env: Env): Promise<number> => {
  const now = nowIso();
  const rows = await env.DB.prepare(
    `SELECT * FROM task_queue
     WHERE status = 'timeout' AND retry_count < max_retries
     ORDER BY updated_at ASC LIMIT 100`
  ).all<TaskQueueItem>();

  const tasks = rows.results ?? [];
  for (const task of tasks) {
    await env.DB.prepare(
      `UPDATE task_queue SET
         status = 'pending',
         retry_count = retry_count + 1,
         assigned_node_id = NULL,
         assigned_at = NULL,
         started_at = NULL,
         error_message = NULL,
         updated_at = ?
       WHERE id = ?`
    )
      .bind(now, task.id)
      .run();

    await publishEvent(env, "TASK_REQUEUED", "cron", {
      task_id: task.id,
      task_type: task.task_type,
      retry_count: task.retry_count + 1,
      max_retries: task.max_retries,
      requeued_at: now
    });
  }

  return tasks.length;
};

export const detectMissingLogs = async (env: Env, targetDate?: string): Promise<number> => {
  const date =
    targetDate ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const projects = await env.DB.prepare(
    `SELECT p.id as project_id, p.project_name
     FROM project p
     WHERE p.status IN ('preparing', 'active', 'completing')
       AND NOT EXISTS (
         SELECT 1 FROM operator_log ol
         WHERE ol.project_id = p.id
           AND ol.status != 'deleted'
           AND ol.log_date = ?
       )`
  )
    .bind(date)
    .all<{ project_id: number; project_name: string }>();

  for (const row of projects.results ?? []) {
    await publishEvent(env, "LOG_MISSING", "cron", {
      project_id: row.project_id,
      project_name: row.project_name,
      log_date: date
    });
  }

  return (projects.results ?? []).length;
};

export const refreshWeComContactsCache = async (env: Env): Promise<boolean> => {
  try {
    await getWeComContactBook(env, {
      forceRefresh: true,
      allowStaleOnRefreshError: true
    });
    return true;
  } catch {
    return false;
  }
};

export const wakeRunner = async (env: Env): Promise<boolean> => {
  const healthUrl = env.RUNNER_HEALTH_URL || "https://runner.hybcdg.com/health";
  const wakeUrl = healthUrl.endsWith("/health")
    ? `${healthUrl.slice(0, -"/health".length)}/`
    : `${healthUrl.replace(/\/+$/, "")}/`;

  try {
    const resp = await fetch(wakeUrl, {
      method: "GET",
      headers: { "cache-control": "no-cache" }
    });
    return resp.ok;
  } catch {
    return false;
  }
};

export const shouldWakeRunner = async (env: Env): Promise<boolean> => {
  const row = await env.DB.prepare(
    `SELECT 1 as has_work
     FROM task_queue
     WHERE status IN ('pending', 'assigned')
     LIMIT 1`
  ).first<{ has_work: number }>();

  return Boolean(row?.has_work);
};

export const markOverdueRentalTerms = async (env: Env): Promise<number> => {
  const result = await env.DB.prepare(
    "UPDATE asset_rental_term SET status = 'overdue', updated_at = ? WHERE status = 'active' AND returned_date IS NULL AND date(due_date) < date(?)"
  )
    .bind(nowIso(), new Date().toISOString().slice(0, 10))
    .run();

  const updated = Number(result.meta.changes ?? 0);
  if (updated > 0) {
    await publishEvent(env, "RENTAL_OVERDUE_MARKED", "cron", {
      updated,
      marked_at: nowIso()
    });
  }
  return updated;
};

/**
 * 每日巡检报销数据一致性（信封/批次的部分写入痕迹）。
 * 有问题 → 写审计日志 + 发领域事件；无问题 → 不产生噪音。
 * 本函数永不抛出——cron 里任何异常都要吞掉并 console.error，
 * 避免拖垮同一批次里的其它 cron 任务。
 */
export const runReimbursementIntegrityCheck = async (env: Env): Promise<void> => {
  try {
    const issues = await findReimbursementIntegrityIssues(env.DB);
    if (issues.length === 0) {
      return;
    }

    const summary = summarizeIntegrityIssues(issues);

    await writeAuditLog(env.DB, {
      actorUserId: "system",
      actorRoles: [],
      action: "system.integrity.reimbursement_issues_found",
      targetType: "system",
      targetId: "reimbursement_integrity",
      detail: { summary, issues }
    });

    await publishEvent(env, "REIMBURSEMENT_INTEGRITY_ISSUES_FOUND", "system", {
      summary,
      issues
    });
  } catch (error) {
    console.error("Reimbursement integrity check failed", error);
  }
};
