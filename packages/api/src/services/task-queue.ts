import type { Env } from "../types/env";
import type {
  TaskQueueItem,
  TaskPollResponse,
  TaskResultSubmission,
  HeartbeatRequest,
  NodeRegistrationRequest,
  ComputeNode,
  CreateTaskRequest,
  AiProviderConfig
} from "../types/ai";
import { createTask, completeTask, resolvePrompt } from "./ai-slot";

const nowIso = () => new Date().toISOString();

// ─── Enqueue ──────────

/**
 * Enqueue a new AI task. Delegates to ai-slot.createTask().
 */
export const enqueueTask = async (
  env: Env,
  request: CreateTaskRequest
): Promise<TaskQueueItem> => {
  return createTask(env, request);
};

// ─── Poll ──────────

/**
 * Atomically claim one pending task for a compute node.
 * D1/SQLite is single-writer, so the UPDATE-with-subquery is naturally atomic.
 */
export const pollForNode = async (
  env: Env,
  nodeId: string,
  capabilities: string[]
): Promise<TaskPollResponse> => {
  if (capabilities.length === 0) {
    return { task: null };
  }

  const now = nowIso();

  // Build placeholders for IN clause
  const placeholders = capabilities.map(() => "?").join(", ");

  // Atomically claim one task
  const claimResult = await env.DB.prepare(
    `UPDATE task_queue SET status = 'assigned', assigned_node_id = ?,
       assigned_at = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM task_queue
       WHERE status = 'pending' AND task_type IN (${placeholders})
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
     )`
  )
    .bind(nodeId, now, now, ...capabilities)
    .run();

  if (!claimResult.meta.changes || claimResult.meta.changes === 0) {
    return { task: null };
  }

  // Load claimed task
  const task = await env.DB.prepare(
    "SELECT * FROM task_queue WHERE assigned_node_id = ? AND status = 'assigned' ORDER BY assigned_at DESC LIMIT 1"
  )
    .bind(nodeId)
    .first<TaskQueueItem>();

  if (!task) {
    return { task: null };
  }

  // Resolve provider config
  let providerInfo: TaskPollResponse["provider"] = undefined;
  if (task.provider_id) {
    const provider = await env.DB.prepare(
      "SELECT * FROM ai_provider_config WHERE id = ?"
    )
      .bind(task.provider_id)
      .first<AiProviderConfig>();

    if (provider) {
      let config: Record<string, unknown> = {};
      try {
        config = provider.config_json ? JSON.parse(provider.config_json) : {};
      } catch {
        config = {};
      }

      providerInfo = {
        key: provider.provider_key,
        endpoint: provider.api_endpoint ?? "",
        model: provider.model_id ?? "",
        config
      };
    }
  }

  // Resolve prompt if routing rule has a prompt_template_id
  let prompt: TaskPollResponse["prompt"] = undefined;
  // Check if there's a routing rule with a prompt template
  const rule = await env.DB.prepare(
    `SELECT prompt_template_id FROM ai_routing_rule
     WHERE biz_type = ? AND task_type = ? AND status = 'active'
     ORDER BY priority ASC LIMIT 1`
  )
    .bind(task.biz_type, task.task_type)
    .first<{ prompt_template_id: number | null }>();

  if (rule?.prompt_template_id) {
    let payload: Record<string, unknown> = {};
    try {
      payload = task.payload_json ? JSON.parse(task.payload_json) : {};
    } catch {
      payload = {};
    }
    prompt = await resolvePrompt(env, rule.prompt_template_id, payload);
  }

  return { task, provider: providerInfo, prompt };
};

// ─── Result Submission ──────────

/**
 * Submit result for a completed task. Validates node ownership.
 */
export const submitResult = async (
  env: Env,
  taskId: number,
  nodeId: string,
  result: TaskResultSubmission
): Promise<void> => {
  // Validate task assignment
  const task = await env.DB.prepare(
    "SELECT * FROM task_queue WHERE id = ?"
  )
    .bind(taskId)
    .first<TaskQueueItem>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.assigned_node_id !== nodeId) {
    throw new Error(`Task ${taskId} not assigned to node ${nodeId}`);
  }

  if (task.status !== "assigned" && task.status !== "running") {
    throw new Error(`Task ${taskId} is not in assignable state (current: ${task.status})`);
  }

  await completeTask(env, taskId, nodeId, result);
};

// ─── Node Registration ──────────

/**
 * Register or update a compute node. Uses INSERT OR REPLACE.
 */
export const registerNode = async (
  env: Env,
  request: NodeRegistrationRequest
): Promise<ComputeNode> => {
  const now = nowIso();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO compute_node
      (node_id, node_name, node_type, capabilities_json, status,
       cpu_cores, memory_mb, last_heartbeat_at, registered_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'online', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      request.node_id,
      request.node_name,
      request.node_type,
      JSON.stringify(request.capabilities),
      request.cpu_cores ?? null,
      request.memory_mb ?? null,
      now, now, now, now
    )
    .run();

  const node = await env.DB.prepare(
    "SELECT * FROM compute_node WHERE node_id = ?"
  )
    .bind(request.node_id)
    .first<ComputeNode>();

  if (!node) {
    throw new Error("Failed to retrieve registered node");
  }

  return node;
};

// ─── Heartbeat ──────────

/**
 * Update node heartbeat timestamp and metrics.
 */
export const heartbeat = async (
  env: Env,
  nodeId: string,
  metrics: HeartbeatRequest
): Promise<void> => {
  const now = nowIso();

  const result = await env.DB.prepare(
    `UPDATE compute_node
     SET last_heartbeat_at = ?, status = ?,
         cpu_cores = COALESCE(?, cpu_cores),
         memory_mb = COALESCE(?, memory_mb),
         updated_at = ?
     WHERE node_id = ?`
  )
    .bind(
      now,
      metrics.status,
      metrics.cpu_usage ?? null,
      metrics.memory_usage ?? null,
      now,
      nodeId
    )
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    throw new Error(`Node ${nodeId} not found`);
  }
};
