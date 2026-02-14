import type { Env } from "../types/env";
import type {
  AiProviderConfig,
  AiPromptTemplate,
  AiRoutingRule,
  CreateTaskRequest,
  TaskQueueItem,
  TaskResultSubmission,
  ComputeNode,
  TaskPollResponse
} from "../types/ai";
import type { AiGateHandler } from "../types/approval";
import { publishEvent } from "./event-bus";
import { generateSerial } from "./serial";

const nowIso = () => new Date().toISOString();

// ─── Task Lifecycle ──────────

/**
 * Create a new task in the queue.
 */
export const createTask = async (
  env: Env,
  request: CreateTaskRequest
): Promise<TaskQueueItem> => {
  const taskCode = await generateSerial(env.DB, "TK", "task_queue", "task_code");
  const now = nowIso();

  // Resolve provider for this task
  const provider = await resolveProvider(env, request.biz_type, request.task_type);

  const result = await env.DB.prepare(
    `INSERT INTO task_queue
      (task_code, task_type, biz_type, biz_id, priority, payload_json,
       provider_id, status, max_retries, retry_count, timeout_seconds,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 3, 0, ?, ?, ?)`
  )
    .bind(
      taskCode,
      request.task_type,
      request.biz_type,
      request.biz_id,
      request.priority ?? 5,
      JSON.stringify(request.payload),
      provider?.id ?? null,
      request.timeout_seconds ?? 300,
      now,
      now
    )
    .run();

  const taskId = result.meta.last_row_id;

  await publishEvent(env, "TASK_CREATED", "ai-slot", {
    task_id: taskId,
    task_code: taskCode,
    task_type: request.task_type,
    biz_type: request.biz_type,
    biz_id: request.biz_id
  });

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error("Failed to retrieve created task");
  }

  return task;
};

/**
 * Complete a task with results. Writes audit log.
 */
export const completeTask = async (
  env: Env,
  taskId: number,
  nodeId: string,
  result: TaskResultSubmission
): Promise<void> => {
  const now = nowIso();

  // Load task to get context
  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.assigned_node_id !== nodeId) {
    throw new Error(`Task ${taskId} not assigned to node ${nodeId}`);
  }

  // Update task status
  await env.DB.prepare(
    `UPDATE task_queue SET status = 'completed', result_json = ?,
     completed_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(JSON.stringify(result), now, now, taskId)
    .run();

  // Write audit log
  const provider = task.provider_id
    ? await env.DB.prepare("SELECT * FROM ai_provider_config WHERE id = ?")
        .bind(task.provider_id)
        .first<AiProviderConfig>()
    : null;

  await env.DB.prepare(
    `INSERT INTO ai_audit_log
      (task_id, biz_type, biz_id, provider_key, model_id, input_summary,
       output_summary, tokens_input, tokens_output, latency_ms, status,
       compute_node_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`
  )
    .bind(
      taskId,
      task.biz_type,
      task.biz_id,
      provider?.provider_key ?? "unknown",
      provider?.model_id ?? null,
      null,
      result.output.substring(0, 500),
      result.tokens_input ?? 0,
      result.tokens_output ?? 0,
      result.latency_ms ?? 0,
      nodeId,
      now
    )
    .run();

  await publishEvent(env, "TASK_COMPLETED", "ai-slot", {
    task_id: taskId,
    task_type: task.task_type,
    biz_type: task.biz_type,
    biz_id: task.biz_id
  });
};

/**
 * Mark a task as failed. Auto-retry if under max_retries.
 */
export const failTask = async (
  env: Env,
  taskId: number,
  nodeId: string,
  error: string
): Promise<void> => {
  const now = nowIso();

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const newRetryCount = task.retry_count + 1;
  const newStatus = newRetryCount < task.max_retries ? "pending" : "failed";

  await env.DB.prepare(
    `UPDATE task_queue SET status = ?, error_message = ?, retry_count = ?,
     assigned_node_id = NULL, assigned_at = NULL, started_at = NULL,
     updated_at = ? WHERE id = ?`
  )
    .bind(newStatus, error, newRetryCount, now, taskId)
    .run();

  // Write error audit log
  const provider = task.provider_id
    ? await env.DB.prepare("SELECT * FROM ai_provider_config WHERE id = ?")
        .bind(task.provider_id)
        .first<AiProviderConfig>()
    : null;

  await env.DB.prepare(
    `INSERT INTO ai_audit_log
      (task_id, biz_type, biz_id, provider_key, model_id, status,
       error_message, compute_node_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?)`
  )
    .bind(
      taskId,
      task.biz_type,
      task.biz_id,
      provider?.provider_key ?? "unknown",
      provider?.model_id ?? null,
      error,
      nodeId,
      now
    )
    .run();

  await publishEvent(env, "TASK_FAILED", "ai-slot", {
    task_id: taskId,
    error,
    retry_count: newRetryCount,
    will_retry: newStatus === "pending"
  });
};

// ─── Provider Routing ──────────

/**
 * Resolve which AI provider to use for a given biz_type + task_type.
 */
export const resolveProvider = async (
  env: Env,
  bizType: string,
  taskType: string
): Promise<AiProviderConfig | null> => {
  // Try to find a matching routing rule
  const rule = await env.DB.prepare(
    `SELECT * FROM ai_routing_rule
     WHERE biz_type = ? AND task_type = ? AND status = 'active'
     ORDER BY priority ASC LIMIT 1`
  )
    .bind(bizType, taskType)
    .first<AiRoutingRule>();

  if (rule) {
    const provider = await env.DB.prepare(
      "SELECT * FROM ai_provider_config WHERE id = ? AND status = 'active'"
    )
      .bind(rule.provider_id)
      .first<AiProviderConfig>();

    if (provider) {
      return provider;
    }
  }

  // Fallback: highest-priority active provider
  const fallback = await env.DB.prepare(
    "SELECT * FROM ai_provider_config WHERE status = 'active' ORDER BY priority ASC LIMIT 1"
  )
    .all<AiProviderConfig>();

  return fallback.results?.[0] ?? null;
};

/**
 * Resolve and render a prompt template with variables.
 */
export const resolvePrompt = async (
  env: Env,
  templateId: number,
  variables: Record<string, unknown>
): Promise<{ system: string; user: string } | null> => {
  const template = await env.DB.prepare(
    "SELECT * FROM ai_prompt_template WHERE id = ? AND status = 'active'"
  )
    .bind(templateId)
    .first<AiPromptTemplate>();

  if (!template) {
    return null;
  }

  // Replace {{variable}} patterns
  const renderTemplate = (tmpl: string): string => {
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = variables[key];
      return value !== undefined ? String(value) : `{{${key}}}`;
    });
  };

  return {
    system: renderTemplate(template.system_prompt),
    user: renderTemplate(template.user_prompt_template)
  };
};

// ─── Node Management ──────────

/**
 * Get available compute nodes for a task type.
 */
export const getAvailableNodes = async (
  env: Env,
  taskType: string
): Promise<ComputeNode[]> => {
  const rows = await env.DB.prepare(
    "SELECT * FROM compute_node WHERE status = 'online'"
  )
    .all<ComputeNode>();

  const nodes = rows.results ?? [];

  // Filter by capability
  return nodes.filter((node) => {
    if (!node.capabilities_json) return false;
    try {
      const capabilities = JSON.parse(node.capabilities_json) as string[];
      return capabilities.includes(taskType);
    } catch {
      return false;
    }
  });
};

/**
 * Check for timed-out tasks and mark them accordingly.
 */
export const checkTimeouts = async (env: Env): Promise<number> => {
  const now = nowIso();

  // Find tasks that have been assigned/running and exceeded timeout
  const timedOut = await env.DB.prepare(
    `SELECT * FROM task_queue
     WHERE status IN ('assigned', 'running')
       AND started_at IS NOT NULL
       AND (julianday(?) - julianday(started_at)) * 86400 > timeout_seconds`
  )
    .bind(now)
    .all<TaskQueueItem>();

  const tasks = timedOut.results ?? [];

  for (const task of tasks) {
    await env.DB.prepare(
      `UPDATE task_queue SET status = 'timeout', error_message = 'Task timed out',
       updated_at = ? WHERE id = ?`
    )
      .bind(now, task.id)
      .run();

    // Audit log for timeout
    await env.DB.prepare(
      `INSERT INTO ai_audit_log
        (task_id, biz_type, biz_id, provider_key, status, error_message,
         compute_node_id, created_at)
        VALUES (?, ?, ?, 'unknown', 'timeout', 'Task exceeded timeout', ?, ?)`
    )
      .bind(task.id, task.biz_type, task.biz_id, task.assigned_node_id ?? null, now)
      .run();
  }

  return tasks.length;
};

// ─── AI Gate Handler Implementation ──────────

/**
 * Creates an AiGateHandler that bridges the approval engine with the AI Slot system.
 * This implements the AiGateHandler interface from types/approval.ts.
 */
export const createAiGateHandler = (): AiGateHandler => ({
  async createAiTask(
    env: Env,
    request: { biz_type: string; biz_id: number; payload: Record<string, unknown> }
  ): Promise<{ task_id: number }> {
    const task = await createTask(env, {
      task_type: "approval_ai_gate",
      biz_type: request.biz_type,
      biz_id: request.biz_id,
      payload: request.payload,
      priority: 8
    });
    return { task_id: task.id };
  },

  async getTaskResult(
    env: Env,
    taskId: number
  ): Promise<{ completed: boolean; outcome?: "approve" | "reject"; comment?: string } | null> {
    const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
      .bind(taskId)
      .first<TaskQueueItem>();

    if (!task) return null;

    if (task.status === "completed" && task.result_json) {
      try {
        const result = JSON.parse(task.result_json) as {
          output?: string;
          metadata?: { outcome?: string; comment?: string };
        };
        return {
          completed: true,
          outcome: (result.metadata?.outcome as "approve" | "reject") ?? "approve",
          comment: result.metadata?.comment ?? result.output
        };
      } catch {
        return { completed: true, outcome: "approve" };
      }
    }

    if (task.status === "failed" || task.status === "timeout") {
      return { completed: true, outcome: "approve", comment: "AI task failed, auto-approved" };
    }

    return { completed: false };
  }
});
