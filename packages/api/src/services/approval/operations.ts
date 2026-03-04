import type { Env } from "../../types/env";
import type {
  ApprovalInstance,
  ApprovalNodeInstance,
  ApprovalTask
} from "../../types/approval";
import { advanceWorkflow, handleRoundReset, handleResubmit } from "./engine";
import { executorFactory } from "./executors";
import { publishEvent } from "../event-bus";
import { createAiGateHandler } from "../ai-slot";

const nowIso = () => new Date().toISOString();

// ─── Helper: Load and validate task ──────────

const loadPendingTask = async (
  env: Env,
  taskId: number,
  userId: string
): Promise<ApprovalTask> => {
  const task = await env.DB.prepare(
    "SELECT * FROM approval_task WHERE id = ?"
  )
    .bind(taskId)
    .first<ApprovalTask>();

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.assignee_userid !== userId) {
    throw new Error(`Task ${taskId} does not belong to user ${userId}`);
  }

  if (task.status !== "pending") {
    throw new Error(`Task ${taskId} is not pending (current: ${task.status})`);
  }

  return task;
};

const loadInstance = async (
  env: Env,
  instanceId: number
): Promise<ApprovalInstance> => {
  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance) {
    throw new Error(`Approval instance ${instanceId} not found`);
  }

  return instance;
};

// ─── 1. Approve ──────────

export const approve = async (
  env: Env,
  taskId: number,
  userId: string,
  comment?: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);

  const executor = executorFactory(
    (await env.DB.prepare(
      "SELECT node_type FROM approval_node_instance WHERE id = ?"
    )
      .bind(task.node_instance_id)
      .first<{ node_type: string }>())?.node_type as import("../../types/approval").NodeType ?? "sequential"
  );

  await executor.processAction(env, task, "approve", comment);
  await advanceWorkflow(env, task.instance_id, createAiGateHandler());
};

// ─── 2. Reject ──────────

export const reject = async (
  env: Env,
  taskId: number,
  userId: string,
  comment?: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);
  const now = nowIso();

  const executor = executorFactory(
    (await env.DB.prepare(
      "SELECT node_type FROM approval_node_instance WHERE id = ?"
    )
      .bind(task.node_instance_id)
      .first<{ node_type: string }>())?.node_type as import("../../types/approval").NodeType ?? "sequential"
  );

  await executor.processAction(env, task, "reject", comment);

  // Cancel remaining pending tasks in the same node
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE node_instance_id = ? AND status = 'pending'`
  )
    .bind(now, task.node_instance_id)
    .run();

  // Mark node as completed
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, task.node_instance_id)
    .run();

  // Mark instance as rejected
  await env.DB.prepare(
    `UPDATE approval_instance SET status = 'rejected', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, task.instance_id)
    .run();

  const instance = await loadInstance(env, task.instance_id);
  await publishEvent(env, "APPROVAL_REJECTED", "approval-operations", {
    instance_id: task.instance_id,
    instance_no: instance.instance_no,
    rejected_by: userId,
    node_instance_id: task.node_instance_id
  });
};

// ─── 3. Return to Initiator ──────────

export const returnToInitiator = async (
  env: Env,
  taskId: number,
  userId: string,
  comment?: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);
  const now = nowIso();

  // Mark task as completed with return action
  await env.DB.prepare(
    `UPDATE approval_task SET action = 'return_initiator', comment = ?,
     status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(comment ?? null, now, now, task.id)
    .run();

  // Cancel remaining pending tasks in the node
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE node_instance_id = ? AND status = 'pending'`
  )
    .bind(now, task.node_instance_id)
    .run();

  // Mark node as returned
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'returned', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, task.node_instance_id)
    .run();

  // Mark instance as pending (awaiting resubmit)
  await env.DB.prepare(
    `UPDATE approval_instance SET status = 'pending', updated_at = ?
     WHERE id = ?`
  )
    .bind(now, task.instance_id)
    .run();

  // Record initiator action
  await env.DB.prepare(
    `INSERT INTO approval_initiator_action
      (instance_id, action, userid, comment, created_at)
      VALUES (?, 'return_initiator', ?, ?, ?)`
  )
    .bind(task.instance_id, userId, comment ?? null, now)
    .run();

  await publishEvent(env, "APPROVAL_RETURNED", "approval-operations", {
    instance_id: task.instance_id,
    returned_by: userId,
    return_type: "initiator"
  });
};

// ─── 4. Return to Previous Node ──────────

export const returnToPrev = async (
  env: Env,
  taskId: number,
  userId: string,
  comment?: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);
  const now = nowIso();

  const instance = await loadInstance(env, task.instance_id);

  // Find previous node
  const currentNodeInst = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE id = ?"
  )
    .bind(task.node_instance_id)
    .first<ApprovalNodeInstance>();

  if (!currentNodeInst) {
    throw new Error("Current node instance not found");
  }

  // Find the previous completed node in this round
  const prevNode = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ? AND round = ? AND sort_order < ?
       AND status = 'completed'
     ORDER BY sort_order DESC LIMIT 1`
  )
    .bind(task.instance_id, instance.current_round, currentNodeInst.sort_order)
    .first<ApprovalNodeInstance>();

  if (!prevNode) {
    throw new Error("No previous node to return to");
  }

  // Mark current task
  await env.DB.prepare(
    `UPDATE approval_task SET action = 'return_prev', comment = ?,
     status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(comment ?? null, now, now, task.id)
    .run();

  // Cancel remaining pending tasks
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE node_instance_id = ? AND status = 'pending'`
  )
    .bind(now, task.node_instance_id)
    .run();

  await handleRoundReset(env, task.instance_id, prevNode.node_key, createAiGateHandler());

  await publishEvent(env, "APPROVAL_RETURNED", "approval-operations", {
    instance_id: task.instance_id,
    returned_by: userId,
    return_type: "prev",
    target_node_key: prevNode.node_key
  });
};

// ─── 5. Return to Specific Node ──────────

export const returnTo = async (
  env: Env,
  taskId: number,
  userId: string,
  targetNodeKey: string,
  comment?: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);
  const now = nowIso();

  const instance = await loadInstance(env, task.instance_id);

  // Verify target node exists and is before current
  const currentNodeInst = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE id = ?"
  )
    .bind(task.node_instance_id)
    .first<ApprovalNodeInstance>();

  if (!currentNodeInst) {
    throw new Error("Current node instance not found");
  }

  const targetNodeInst = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ? AND round = ? AND node_key = ?`
  )
    .bind(task.instance_id, instance.current_round, targetNodeKey)
    .first<ApprovalNodeInstance>();

  if (!targetNodeInst) {
    throw new Error(`Target node "${targetNodeKey}" not found in current round`);
  }

  if (targetNodeInst.sort_order >= currentNodeInst.sort_order) {
    throw new Error("Cannot return to a node at or after current position");
  }

  // Mark current task
  await env.DB.prepare(
    `UPDATE approval_task SET action = 'return_to', comment = ?,
     status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(comment ?? null, now, now, task.id)
    .run();

  // Cancel remaining pending tasks
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE node_instance_id = ? AND status = 'pending'`
  )
    .bind(now, task.node_instance_id)
    .run();

  await handleRoundReset(env, task.instance_id, targetNodeKey, createAiGateHandler());

  await publishEvent(env, "APPROVAL_RETURNED", "approval-operations", {
    instance_id: task.instance_id,
    returned_by: userId,
    return_type: "to",
    target_node_key: targetNodeKey
  });
};

// ─── 6. Transfer ──────────

export const transfer = async (
  env: Env,
  taskId: number,
  userId: string,
  toUserId: string,
  reason: string
): Promise<void> => {
  const task = await loadPendingTask(env, taskId, userId);
  const now = nowIso();

  // Cancel original task
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'transferred', updated_at = ?
     WHERE id = ?`
  )
    .bind(now, task.id)
    .run();

  // Create new task for target user
  await env.DB.prepare(
    `INSERT INTO approval_task
      (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(task.node_instance_id, task.instance_id, toUserId, task.round, now, now)
    .run();

  // Record transfer
  await env.DB.prepare(
    `INSERT INTO approval_transfer
      (task_id, instance_id, from_userid, to_userid, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(task.id, task.instance_id, userId, toUserId, reason, now)
    .run();

  await publishEvent(env, "APPROVAL_TRANSFERRED", "approval-operations", {
    instance_id: task.instance_id,
    from_userid: userId,
    to_userid: toUserId,
    task_id: task.id
  });
};

// ─── 7. Withdraw ──────────

export const withdraw = async (
  env: Env,
  instanceId: number,
  userId: string,
  comment?: string
): Promise<void> => {
  const instance = await loadInstance(env, instanceId);
  const now = nowIso();

  if (instance.initiator_userid !== userId) {
    throw new Error("Only the initiator can withdraw");
  }

  if (instance.status !== "in_progress") {
    throw new Error(`Cannot withdraw instance in status: ${instance.status}`);
  }

  // Cancel all pending tasks
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE instance_id = ? AND status = 'pending'`
  )
    .bind(now, instanceId)
    .run();

  // Update instance
  await env.DB.prepare(
    `UPDATE approval_instance SET status = 'withdrawn', updated_at = ?
     WHERE id = ?`
  )
    .bind(now, instanceId)
    .run();

  // Record action
  await env.DB.prepare(
    `INSERT INTO approval_initiator_action
      (instance_id, action, userid, comment, created_at)
      VALUES (?, 'withdraw', ?, ?, ?)`
  )
    .bind(instanceId, userId, comment ?? null, now)
    .run();

  await publishEvent(env, "APPROVAL_WITHDRAWN", "approval-operations", {
    instance_id: instanceId,
    instance_no: instance.instance_no,
    withdrawn_by: userId
  });
};

// ─── 8. Cancel ──────────

export const cancel = async (
  env: Env,
  instanceId: number,
  userId: string,
  userRoles: string[],
  comment?: string
): Promise<void> => {
  const instance = await loadInstance(env, instanceId);
  const now = nowIso();

  const isInitiator = instance.initiator_userid === userId;
  const isSuperAdmin = userRoles.includes("super_admin");

  if (!isInitiator && !isSuperAdmin) {
    throw new Error("Only the initiator or super_admin can cancel");
  }

  // Cancel all pending tasks
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE instance_id = ? AND status = 'pending'`
  )
    .bind(now, instanceId)
    .run();

  // Update instance
  await env.DB.prepare(
    `UPDATE approval_instance SET status = 'cancelled', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, instanceId)
    .run();

  // Record action
  await env.DB.prepare(
    `INSERT INTO approval_initiator_action
      (instance_id, action, userid, comment, created_at)
      VALUES (?, 'cancel', ?, ?, ?)`
  )
    .bind(instanceId, userId, comment ?? null, now)
    .run();

  await publishEvent(env, "APPROVAL_CANCELLED", "approval-operations", {
    instance_id: instanceId,
    instance_no: instance.instance_no,
    cancelled_by: userId
  });
};

// ─── 9. Resubmit ──────────

export const resubmit = async (
  env: Env,
  instanceId: number,
  userId: string,
  newSummary?: string
): Promise<void> => {
  const instance = await loadInstance(env, instanceId);

  if (instance.initiator_userid !== userId) {
    throw new Error("Only the initiator can resubmit");
  }

  if (instance.status !== "pending" && instance.status !== "withdrawn") {
    throw new Error(
      `Cannot resubmit instance in status: ${instance.status}. Must be pending or withdrawn.`
    );
  }

  await handleResubmit(env, instanceId, newSummary, createAiGateHandler());
};
