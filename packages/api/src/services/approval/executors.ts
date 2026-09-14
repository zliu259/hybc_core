import type { Env } from "../../types/env";
import type {
  ApprovalInstance,
  ApprovalNodeInstance,
  ApprovalTask,
  TemplateNodeConfig,
  NodeType,
  AiGateHandler
} from "../../types/approval";
import { parseAiGateTaskResult } from "./ai-gate-result";
import { applyAiGateDecision } from "./ai-gate-apply";
import { hasAiDecisionTaskOnNode } from "./ai-gate-fallback";
import { loadOurEntityContext } from "../our-entities";

// ─── Types ──────────

const nowIso = () => new Date().toISOString();

export interface NodeCompletionResult {
  complete: boolean;
  /** "returned"：AI 关卡拦截 → 实例退回发起人修改重提（非终态） */
  outcome: "approved" | "rejected" | "returned" | null;
}

export interface NodeExecutor {
  initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void>;

  processAction(
    env: Env,
    task: ApprovalTask,
    action: string,
    comment?: string
  ): Promise<void>;

  isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult>;
}

// ─── Factory ──────────

let _aiGateHandler: AiGateHandler | null = null;

export const setAiGateHandler = (handler: AiGateHandler): void => {
  _aiGateHandler = handler;
};

export const executorFactory = (nodeType: NodeType): NodeExecutor => {
  switch (nodeType) {
    case "sequential":
      return new SequentialExecutor();
    case "countersign":
      return new CountersignExecutor();
    case "or_sign":
      return new OrSignExecutor();
    case "auto":
      return new AutoExecutor();
    case "cc":
      return new CcExecutor();
    case "ai_gate":
      return new AiGateExecutor();
    default:
      throw new Error(`Unknown node type: ${nodeType}`);
  }
};

// ─── Helper: Create tasks for assignees ──────────

/**
 * Filter tasks to only "active" ones — excludes cancelled, transferred,
 * and return-type actions that are left over from previous return_to cycles.
 */
const getActiveTasks = (tasks: ApprovalTask[]): ApprovalTask[] =>
  tasks.filter(
    (t) =>
      t.status === "pending" ||
      (t.status === "completed" &&
        (t.action === "approve" || t.action === "reject"))
  );

const createTasksForAssignees = async (
  env: Env,
  nodeInstance: ApprovalNodeInstance,
  instanceId: number,
  status: string = "pending"
): Promise<void> => {
  const userids: string[] = nodeInstance.assignee_userids
    ? JSON.parse(nodeInstance.assignee_userids)
    : [];

  for (let i = 0; i < userids.length; i++) {
    await env.DB.prepare(
      `INSERT INTO approval_task
        (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        nodeInstance.id,
        instanceId,
        userids[i],
        nodeInstance.round,
        status,
        nowIso(),
        nowIso()
      )
      .run();
  }
};

const findAiGateTask = async (
  env: Env,
  instanceId: number,
  nodeKey: string
): Promise<{
  id: number;
  status: string;
  result_json: string | null;
  error_message: string | null;
} | null> => {
  return await env.DB.prepare(
    `SELECT id, status, result_json, error_message
     FROM task_queue
     WHERE task_type = 'approval_ai_gate'
       AND biz_id = ?
       AND json_extract(payload_json, '$.node_key') = ?
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(instanceId, nodeKey)
    .first<{
      id: number;
      status: string;
      result_json: string | null;
      error_message: string | null;
    }>();
};

const loadAiGateContextFromInstance = async (
  env: Env,
  instanceId: number
): Promise<{
  biz_type: string;
  biz_id: number;
  biz_summary: string;
  context: Record<string, unknown>;
} | null> => {
  const instance = await env.DB.prepare("SELECT * FROM approval_instance WHERE id = ?")
    .bind(instanceId)
    .first<ApprovalInstance>();
  if (!instance) return null;

  let routeContext: Record<string, unknown> = {};
  if (instance.instance_config_json) {
    try {
      const parsed = JSON.parse(instance.instance_config_json) as {
        route_context?: Record<string, unknown>;
      };
      routeContext = parsed.route_context ?? {};
    } catch {
      routeContext = {};
    }
  }

  let context: Record<string, unknown> =
    Object.keys(routeContext).length > 0
      ? routeContext
      : {
          biz_type: instance.biz_type,
          biz_id: instance.biz_id,
          biz_summary: instance.biz_summary
        };

  // 合同类关卡补我方实体（实时调取，覆盖重跑/重提交时冻结的 route_context）：
  // AI 需据 our_entity/our_entities 核对签约主体，禁止假定「恒越百川」
  if (
    instance.biz_type === "outbound_contract" ||
    instance.biz_type === "inbound_contract"
  ) {
    // 整段容错：调用方 initializeNode 的 catch 会把异常当成派发失败并直接
    // 放行关卡，实体补充失败绝不能扩大这个 fail-open 面——查不到就不补
    try {
      const entityIdRaw = routeContext.entity_id;
      let entityId =
        typeof entityIdRaw === "number" && Number.isFinite(entityIdRaw)
          ? entityIdRaw
          : 0;
      if (!entityId) {
        const row = await env.DB.prepare("SELECT entity_id FROM contract WHERE id = ?")
          .bind(instance.biz_id)
          .first<{ entity_id: number }>();
        entityId = row?.entity_id ?? 0;
      }
      context = { ...context, ...(await loadOurEntityContext(env.DB, entityId)) };
    } catch (err) {
      console.error("AI gate entity context enrichment failed, continuing:", err);
    }
  }

  return {
    biz_type: instance.biz_type,
    biz_id: instance.biz_id,
    biz_summary: instance.biz_summary,
    context
  };
};

// ─── Sequential Executor ──────────

class SequentialExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    _config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void> {
    await createTasksForAssignees(env, nodeInstance, instanceId);
  }

  async processAction(
    env: Env,
    task: ApprovalTask,
    action: string,
    comment?: string
  ): Promise<void> {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE approval_task SET action = ?, comment = ?, status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(action, comment ?? null, now, now, task.id)
      .run();
  }

  async isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult> {
    const tasks = await env.DB.prepare(
      "SELECT * FROM approval_task WHERE node_instance_id = ? ORDER BY id ASC"
    )
      .bind(nodeInstanceId)
      .all<ApprovalTask>();

    // Filter out cancelled/transferred/return tasks left over from return_to cycles
    const allTasks = getActiveTasks(tasks.results ?? []);

    // Check for any rejection
    const rejected = allTasks.find(
      (t) => t.status === "completed" && t.action === "reject"
    );
    if (rejected) {
      return { complete: true, outcome: "rejected" };
    }

    // Check if all tasks completed
    const allCompleted = allTasks.every((t) => t.status === "completed");
    if (allCompleted && allTasks.length > 0) {
      return { complete: true, outcome: "approved" };
    }

    // Sequential: check if the current (lowest-order pending) task was just acted on
    // If there are still pending tasks, node is not complete
    const hasPending = allTasks.some((t) => t.status === "pending");
    if (hasPending) {
      return { complete: false, outcome: null };
    }

    return { complete: allTasks.length > 0, outcome: allTasks.length > 0 ? "approved" : null };
  }
}

// ─── Countersign Executor ──────────

class CountersignExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    _config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void> {
    await createTasksForAssignees(env, nodeInstance, instanceId);
  }

  async processAction(
    env: Env,
    task: ApprovalTask,
    action: string,
    comment?: string
  ): Promise<void> {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE approval_task SET action = ?, comment = ?, status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(action, comment ?? null, now, now, task.id)
      .run();

    // If rejected, cancel all remaining pending tasks
    if (action === "reject") {
      await env.DB.prepare(
        "UPDATE approval_task SET status = 'cancelled', updated_at = ? WHERE node_instance_id = ? AND status = 'pending'"
      )
        .bind(now, task.node_instance_id)
        .run();
    }
  }

  async isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult> {
    const tasks = await env.DB.prepare(
      "SELECT * FROM approval_task WHERE node_instance_id = ?"
    )
      .bind(nodeInstanceId)
      .all<ApprovalTask>();

    // Filter out cancelled/transferred/return tasks left over from return_to cycles
    const allTasks = getActiveTasks(tasks.results ?? []);

    // Any rejection → node rejected
    const rejected = allTasks.find(
      (t) => t.status === "completed" && t.action === "reject"
    );
    if (rejected) {
      return { complete: true, outcome: "rejected" };
    }

    // ALL must be completed with approve
    const allApproved = allTasks.every(
      (t) => t.status === "completed" && t.action === "approve"
    );
    if (allApproved && allTasks.length > 0) {
      return { complete: true, outcome: "approved" };
    }

    return { complete: false, outcome: null };
  }
}

// ─── OrSign Executor ──────────

class OrSignExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    _config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void> {
    await createTasksForAssignees(env, nodeInstance, instanceId);
  }

  async processAction(
    env: Env,
    task: ApprovalTask,
    action: string,
    comment?: string
  ): Promise<void> {
    const now = nowIso();
    // Complete this task
    await env.DB.prepare(
      "UPDATE approval_task SET action = ?, comment = ?, status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(action, comment ?? null, now, now, task.id)
      .run();

    // Cancel all remaining pending tasks in this node
    await env.DB.prepare(
      "UPDATE approval_task SET status = 'cancelled', updated_at = ? WHERE node_instance_id = ? AND status = 'pending'"
    )
      .bind(now, task.node_instance_id)
      .run();
  }

  async isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult> {
    const tasks = await env.DB.prepare(
      "SELECT * FROM approval_task WHERE node_instance_id = ?"
    )
      .bind(nodeInstanceId)
      .all<ApprovalTask>();

    // Filter to active approve/reject decisions only
    const completed = getActiveTasks(tasks.results ?? []).filter(
      (t) => t.status === "completed"
    );

    if (completed.length > 0) {
      const firstAction = completed[0];
      return {
        complete: true,
        outcome: firstAction.action === "approve" ? "approved" : "rejected"
      };
    }

    return { complete: false, outcome: null };
  }
}

// ─── Auto Executor ──────────

class AutoExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    config: TemplateNodeConfig,
    _instanceId: number
  ): Promise<void> {
    void config;
    void _instanceId;
    // Auto node completes immediately
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, nodeInstance.id)
      .run();
  }

  async processAction(): Promise<void> {
    // Auto nodes have no human actions
  }

  async isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult> {
    const node = await env.DB.prepare(
      "SELECT * FROM approval_node_instance WHERE id = ?"
    )
      .bind(nodeInstanceId)
      .first<ApprovalNodeInstance>();

    if (node && node.status === "completed") {
      return { complete: true, outcome: "approved" };
    }
    return { complete: true, outcome: "approved" };
  }
}

// ─── Cc Executor ──────────

class CcExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    _config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void> {
    // Create tasks as completed (for notification tracking)
    await createTasksForAssignees(env, nodeInstance, instanceId, "completed");

    // CC node completes immediately — does NOT block workflow
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, nodeInstance.id)
      .run();
  }

  async processAction(): Promise<void> {
    // CC nodes have no actions
  }

  async isNodeComplete(): Promise<NodeCompletionResult> {
    // CC nodes are always complete (non-blocking)
    return { complete: true, outcome: "approved" };
  }
}

// ─── AI Gate Executor ──────────

class AiGateExecutor implements NodeExecutor {
  async initializeNode(
    env: Env,
    nodeInstance: ApprovalNodeInstance,
    config: TemplateNodeConfig,
    instanceId: number
  ): Promise<void> {
    if (_aiGateHandler) {
      const existingTask = await findAiGateTask(env, instanceId, nodeInstance.node_key);
      const hasHistoricalDecision = await hasAiDecisionTaskOnNode(env, nodeInstance.id);

      if (hasHistoricalDecision) {
        const aiSlotRoute =
          typeof config.ai_slot_id === "string" && config.ai_slot_id.trim()
            ? config.ai_slot_id.trim()
            : "approval_ai_gate";
        await _aiGateHandler.createAiTask(env, {
          biz_type: aiSlotRoute,
          biz_id: instanceId,
          payload: {
            node_key: nodeInstance.node_key,
            ai_slot_id: config.ai_slot_id,
            instance_id: instanceId,
            round: nodeInstance.round,
            node_instance_id: nodeInstance.id,
            rerun: true,
            rerun_at: nowIso(),
            ...(await loadAiGateContextFromInstance(env, instanceId))
          }
        });
        return;
      }

      if (existingTask?.status === "completed") {
        const instanceRow = await env.DB.prepare(
          "SELECT biz_type FROM approval_instance WHERE id = ?"
        )
          .bind(instanceId)
          .first<{ biz_type: string }>();
        const parsedResult = parseAiGateTaskResult(existingTask.result_json, {
          bizType: instanceRow?.biz_type
        });
        await applyAiGateDecision(env, nodeInstance, instanceId, parsedResult);
        return;
      }

      if (existingTask?.status === "failed" || existingTask?.status === "timeout") {
        const now = nowIso();
        await env.DB.prepare(
          "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
        )
          .bind(now, now, nodeInstance.id)
          .run();
        await env.DB.prepare(
          `INSERT INTO approval_task
            (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            nodeInstance.id,
            instanceId,
            "AI_GATE",
            "approve",
            existingTask.error_message || "AI关卡任务失败，流程继续",
            nodeInstance.round,
            "completed",
            now,
            now,
            now
          )
          .run();
        return;
      }

      if (existingTask && ["pending", "assigned", "running"].includes(existingTask.status)) {
        return;
      }

      try {
        const aiSlotRoute =
          typeof config.ai_slot_id === "string" && config.ai_slot_id.trim()
            ? config.ai_slot_id.trim()
            : "approval_ai_gate";
        await _aiGateHandler.createAiTask(env, {
          biz_type: aiSlotRoute,
          biz_id: instanceId,
          payload: {
            node_key: nodeInstance.node_key,
            ai_slot_id: config.ai_slot_id,
            instance_id: instanceId,
            round: nodeInstance.round,
            node_instance_id: nodeInstance.id,
            ...(await loadAiGateContextFromInstance(env, instanceId))
          }
        });
      } catch (err) {
        console.error("AI Gate task creation failed, auto-approving:", err);
        const now = nowIso();
        await env.DB.prepare(
          "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
        )
          .bind(now, now, nodeInstance.id)
          .run();
      }
    } else {
      const now = nowIso();
      await env.DB.prepare(
        "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(now, now, nodeInstance.id)
        .run();
    }
  }

  async processAction(): Promise<void> {
  }

  async isNodeComplete(
    env: Env,
    nodeInstanceId: number
  ): Promise<NodeCompletionResult> {
    const node = await env.DB.prepare(
      "SELECT * FROM approval_node_instance WHERE id = ?"
    )
      .bind(nodeInstanceId)
      .first<ApprovalNodeInstance>();

    const decision = await env.DB.prepare(
      `SELECT action
       FROM approval_task
       WHERE node_instance_id = ?
         AND assignee_userid = 'AI_GATE'
         AND status = 'completed'
         AND action IN ('approve', 'reject')
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(nodeInstanceId)
      .first<{ action: string }>();

    if (decision?.action === "reject") {
      // 节点被落地为 returned = AI 自主拦截 → 引擎走退回；
      // 节点 completed + reject = 超管覆写或存量数据 → 保留终态语义
      if (node?.status === "returned") {
        return { complete: true, outcome: "returned" };
      }
      return { complete: true, outcome: "rejected" };
    }

    if (node && node.status === "completed") {
      return { complete: true, outcome: "approved" };
    }

    if (_aiGateHandler && node) {
      return { complete: false, outcome: null };
    }

    return { complete: false, outcome: null };
  }
}
