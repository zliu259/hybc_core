import type { Env } from "../types/env";
import type {
  TaskQueueItem,
  TaskQueueStatus,
  TaskPollResponse,
  TaskResultSubmission,
  HeartbeatRequest,
  NodeRegistrationRequest,
  ComputeNode,
  CreateTaskRequest,
  AiProviderConfig
} from "../types/ai";
import { createTask, completeTask, resolvePrompt } from "./ai-slot";
import { publishEvent } from "./event-bus";
import { loadRunnerRuntimeMap } from "./runner-runtime";

const nowIso = () => new Date().toISOString();

// ─── Cancellation ──────────

/**
 * 「活任务」= 尚未执行完、且还会被执行的任务：pending / assigned / running，以及还有
 * 重试额度的 timeout（requeueTimedOutTasks 会把它改回 pending）。completed / failed /
 * cancelled 与重试耗尽的 timeout 是终态，不碰。
 */
const LIVE_TASK_SQL =
  "(status IN ('pending', 'assigned', 'running') OR (status = 'timeout' AND retry_count < max_retries))";

export interface CancelTasksForBizInput {
  biz_type: string;
  biz_id: number;
  /** 只撤回某一种任务类型；缺省撤回该业务下的全部活任务 */
  task_type?: string;
  /** 写入 error_message，管理台 AI 任务页与审批详情会原样展示 */
  reason: string;
  /** publishEvent 的 source */
  source: string;
}

export interface CancelAiGateTasksInput {
  /** 审批实例 id（approval_ai_gate 任务的 biz_id） */
  instance_id: number;
  reason: string;
  source: string;
}

export interface CancelledTask {
  id: number;
  task_type: string;
  biz_type: string;
  biz_id: number;
  previous_status: TaskQueueStatus;
}

export interface CancelTasksResult {
  cancelled: CancelledTask[];
}

type LiveTaskRow = Pick<TaskQueueItem, "id" | "task_type" | "biz_type" | "biz_id" | "status">;

const assertPositiveInt = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${String(value)})`);
  }
};

const assertReason = (reason: string): void => {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("cancel reason must not be empty");
  }
};

/**
 * 把一批活任务置为 cancelled。逐行带状态守卫：SELECT 与 UPDATE 之间节点可能刚好
 * 完成了它，终态不覆盖；只有真正改到的行才记入结果并发 TASK_CANCELLED 事件。
 * 保留 assigned_node_id：节点迟到提交结果时 submitResult 仍能认出它并静默丢弃。
 */
const cancelLiveTasks = async (
  env: Env,
  rows: LiveTaskRow[],
  reason: string,
  source: string
): Promise<CancelTasksResult> => {
  const now = nowIso();
  const cancelled: CancelledTask[] = [];

  for (const row of rows) {
    const result = await env.DB.prepare(
      `UPDATE task_queue SET status = 'cancelled', error_message = ?, updated_at = ?
       WHERE id = ? AND ${LIVE_TASK_SQL}`
    )
      .bind(reason, now, row.id)
      .run();

    if (!result.meta.changes) continue;

    const summary: CancelledTask = {
      id: row.id,
      task_type: row.task_type,
      biz_type: row.biz_type,
      biz_id: row.biz_id,
      previous_status: row.status
    };
    cancelled.push(summary);

    await publishEvent(env, "TASK_CANCELLED", source, {
      task_id: row.id,
      task_type: row.task_type,
      biz_type: row.biz_type,
      biz_id: row.biz_id,
      previous_status: row.status,
      reason,
      cancelled_at: now
    });
  }

  return { cancelled };
};

/**
 * 业务作废/取消时撤回挂在该业务上、尚未执行的 AI 任务（按 biz_type + biz_id 定位，
 * 可选限定 task_type）。幂等：没有活任务时不写库、不发事件。
 *
 * 背景（2026-10-27 事故）：作废付款的 payment_risk_assessment 任务仍被节点认领执行，
 * 结果写回已作废单据，毒丸附件还把 runner 打死。
 */
export const cancelPendingTasksForBiz = async (
  env: Env,
  input: CancelTasksForBizInput
): Promise<CancelTasksResult> => {
  assertPositiveInt(input.biz_id, "biz_id");
  assertReason(input.reason);

  const rows = input.task_type
    ? await env.DB.prepare(
        `SELECT id, task_type, biz_type, biz_id, status FROM task_queue
         WHERE biz_type = ? AND biz_id = ? AND task_type = ? AND ${LIVE_TASK_SQL}`
      )
        .bind(input.biz_type, input.biz_id, input.task_type)
        .all<LiveTaskRow>()
    : await env.DB.prepare(
        `SELECT id, task_type, biz_type, biz_id, status FROM task_queue
         WHERE biz_type = ? AND biz_id = ? AND ${LIVE_TASK_SQL}`
      )
        .bind(input.biz_type, input.biz_id)
        .all<LiveTaskRow>();

  return cancelLiveTasks(env, rows.results ?? [], input.reason, input.source);
};

/**
 * 审批实例取消/撤回/随业务作废时，撤回该实例尚未执行的 AI 关卡任务。
 *
 * 关卡任务的 biz_id 是实例 id，但 biz_type 不一定是 'approval_ai_gate'——模板节点配了
 * ai_slot_id 时 biz_type 是槽位名（engine.ts submitForApproval）。因此按 task_type +
 * biz_id 定位，与 engine.ts / executors.ts 查关卡任务的口径一致。
 */
export const cancelPendingAiGateTasksForInstance = async (
  env: Env,
  input: CancelAiGateTasksInput
): Promise<CancelTasksResult> => {
  assertPositiveInt(input.instance_id, "instance_id");
  assertReason(input.reason);

  const rows = await env.DB.prepare(
    `SELECT id, task_type, biz_type, biz_id, status FROM task_queue
     WHERE task_type = 'approval_ai_gate' AND biz_id = ? AND ${LIVE_TASK_SQL}`
  )
    .bind(input.instance_id)
    .all<LiveTaskRow>();

  return cancelLiveTasks(env, rows.results ?? [], input.reason, input.source);
};

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
       assigned_at = ?, started_at = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM task_queue
       WHERE status = 'pending' AND task_type IN (${placeholders})
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
     )`
  )
    .bind(nodeId, now, now, now, ...capabilities)
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
  const runnerRuntime = await loadRunnerRuntimeMap(env);
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

      if (provider.provider_key === "openai") {
        if (runnerRuntime.OPENAI_API_KEY) {
          providerInfo.config.api_key = runnerRuntime.OPENAI_API_KEY;
        }
        if (runnerRuntime.OPENAI_BASE_URL) {
          providerInfo.endpoint = runnerRuntime.OPENAI_BASE_URL;
          providerInfo.config.base_url = runnerRuntime.OPENAI_BASE_URL;
        }
        if (runnerRuntime.OPENAI_MODEL) {
          providerInfo.model = runnerRuntime.OPENAI_MODEL;
        }
      }

      if (provider.provider_key === "claude") {
        if (runnerRuntime.ANTHROPIC_API_KEY) {
          providerInfo.config.api_key = runnerRuntime.ANTHROPIC_API_KEY;
        }
        if (runnerRuntime.ANTHROPIC_MODEL) {
          providerInfo.model = runnerRuntime.ANTHROPIC_MODEL;
        }
      }
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
    payload.payload_json = task.payload_json;
    payload.task_type = task.task_type;
    payload.biz_type = task.biz_type;
    payload.biz_id = task.biz_id;
    prompt = await resolvePrompt(env, rule.prompt_template_id, payload);
  }

  return { task, provider: providerInfo, runner_runtime: runnerRuntime, prompt };
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

  // 业务作废/取消已撤回该任务（cancelPendingTasksForBiz）：节点迟到的结果直接丢弃——
  // 不写 result/审计、不触发 TASK_COMPLETED 的回写分支。返回成功让节点正常收尾，
  // 而不是报 400 让 runner 日志里多一条没人会处理的错误。
  if (task.status === "cancelled") {
    return;
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
