import type { Env } from "../../types/env";
import type {
  ApprovalInstance,
  ApprovalNodeInstance,
  ApprovalTask,
  ApprovalTransfer,
  ApprovalInitiatorAction,
  ApprovalDetailResponse,
  ApprovalAction,
  SubmitApprovalRequest,
  AiGateHandler,
  RouteContext,
  TemplateNodeConfig
} from "../../types/approval";
import { resolveTemplate } from "./router";
import { parseTemplate, getNextNodeKey, type ParsedNode, type ParsedTemplate } from "./template-parser";
import { executorFactory, setAiGateHandler } from "./executors";
import { publishEvent } from "../event-bus";
import { generateSerial } from "../serial";

const nowIso = () => new Date().toISOString();

// ─── Helper: Build route context from instance ──────────

const buildContextFromInstance = (instance: ApprovalInstance): RouteContext => ({
  amount: undefined,
  entity_id: undefined,
  project_id: undefined,
  biz_type: instance.biz_type,
  biz_id: instance.biz_id
});

const getAssigneeUserids = (config: TemplateNodeConfig): string | null => {
  return config.assignee_userids ? JSON.stringify(config.assignee_userids) : null;
};

// ─── Submit ──────────

/**
 * Submit a new approval request. Creates instance + all node instances + initializes first node.
 */
export const submitForApproval = async (
  env: Env,
  request: SubmitApprovalRequest,
  userId: string,
  aiGateHandler?: AiGateHandler
): Promise<ApprovalInstance> => {
  // Wire AI gate handler if provided
  if (aiGateHandler) {
    setAiGateHandler(aiGateHandler);
  }

  // 1. Resolve template + branch
  const { template, parsedTemplate } = await resolveTemplate(
    env, request.biz_type, request.context ?? {}
  );

  // 2. Generate serial
  const instanceNo = await generateSerial(env.DB, "SP", "approval_instance", "instance_no");
  const now = nowIso();

  // 3. Insert instance
  const insertResult = await env.DB.prepare(
    `INSERT INTO approval_instance
      (instance_no, template_id, biz_type, biz_id, biz_summary,
       initiator_userid, current_node_key, status, current_round,
       submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', 1, ?, ?, ?)`
  )
    .bind(
      instanceNo, template.id, request.biz_type, request.biz_id,
      request.biz_summary, userId, parsedTemplate.startKey,
      now, now, now
    )
    .run();

  const instanceId = insertResult.meta.last_row_id;

  // 4. Create node_instance rows for ALL nodes
  for (let i = 0; i < parsedTemplate.nodeOrder.length; i++) {
    const nodeKey = parsedTemplate.nodeOrder[i];
    const node: ParsedNode = parsedTemplate.nodes.get(nodeKey)!;
    const assigneeUserids = getAssigneeUserids(node.config);

    await env.DB.prepare(
      `INSERT INTO approval_node_instance
        (instance_id, node_key, node_type, node_name, assignee_userids,
         status, round, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`
    )
      .bind(
        instanceId, nodeKey, node.type, node.name,
        assigneeUserids, i, now, now
      )
      .run();
  }

  // 5. Initialize first node
  const firstNodeKey = parsedTemplate.startKey;
  const firstNode: ParsedNode = parsedTemplate.nodes.get(firstNodeKey)!;

  // Mark first node as in_progress
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'in_progress', started_at = ?, updated_at = ?
     WHERE instance_id = ? AND node_key = ? AND round = 1`
  )
    .bind(now, now, instanceId, firstNodeKey)
    .run();

  // Get the node instance for executor
  const firstNodeInstance = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE instance_id = ? AND node_key = ? AND round = 1"
  )
    .bind(instanceId, firstNodeKey)
    .first<ApprovalNodeInstance>();

  if (firstNodeInstance) {
    const executor = executorFactory(firstNode.type);
    await executor.initializeNode(env, firstNodeInstance, firstNode.config, instanceId);
  }

  // 6. Publish event
  await publishEvent(env, "APPROVAL_SUBMITTED", "approval-engine", {
    instance_id: instanceId,
    instance_no: instanceNo,
    biz_type: request.biz_type,
    biz_id: request.biz_id,
    template_id: template.id
  });

  // 7. Return instance
  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance) {
    throw new Error("Failed to retrieve created approval instance");
  }

  return instance;
};

// ─── Advance Workflow ──────────

/**
 * Advance the workflow after an action on the current node.
 * Checks if current node is complete, moves to next node or finishes.
 */
export const advanceWorkflow = async (
  env: Env,
  instanceId: number,
  aiGateHandler?: AiGateHandler
): Promise<void> => {
  if (aiGateHandler) {
    setAiGateHandler(aiGateHandler);
  }

  const now = nowIso();

  // Load instance
  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance || instance.status !== "in_progress") {
    return;
  }

  // Load current node instance
  const currentNodeInst = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ? AND node_key = ? AND round = ?`
  )
    .bind(instanceId, instance.current_node_key, instance.current_round)
    .first<ApprovalNodeInstance>();

  if (!currentNodeInst) {
    return;
  }

  // Check if current node is complete
  const executor = executorFactory(currentNodeInst.node_type);
  const { complete, outcome } = await executor.isNodeComplete(env, currentNodeInst.id);

  if (!complete) {
    return;
  }

  // Mark current node completed
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, currentNodeInst.id)
    .run();

  // If rejected, finish instance
  if (outcome === "rejected") {
    await env.DB.prepare(
      `UPDATE approval_instance SET status = 'rejected', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, instanceId)
      .run();

    await publishEvent(env, "APPROVAL_REJECTED", "approval-engine", {
      instance_id: instanceId,
      instance_no: instance.instance_no,
      rejected_at_node: currentNodeInst.node_key
    });
    return;
  }

  // Get template and find next node
  const template = await env.DB.prepare(
    "SELECT * FROM approval_template WHERE id = ?"
  )
    .bind(instance.template_id)
    .first<{ config_json: string }>();

  if (!template) {
    throw new Error(`Template ${instance.template_id} not found`);
  }

  const parsedTemplate: ParsedTemplate = parseTemplate(template.config_json);
  const currentNode = parsedTemplate.nodes.get(currentNodeInst.node_key);

  if (!currentNode) {
    throw new Error(`Node ${currentNodeInst.node_key} not found in template`);
  }

  const context = buildContextFromInstance(instance);
  const nextKey = getNextNodeKey(currentNode, context);

  if (nextKey === null) {
    // End of chain — instance approved
    await env.DB.prepare(
      `UPDATE approval_instance SET status = 'approved', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, instanceId)
      .run();

    await publishEvent(env, "APPROVAL_APPROVED", "approval-engine", {
      instance_id: instanceId,
      instance_no: instance.instance_no
    });
    return;
  }

  // Move to next node
  const nextNodeInst = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ? AND node_key = ? AND round = ?`
  )
    .bind(instanceId, nextKey, instance.current_round)
    .first<ApprovalNodeInstance>();

  if (!nextNodeInst) {
    throw new Error(`Next node instance not found for key: ${nextKey}`);
  }

  // Mark next node in_progress
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'in_progress', started_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, nextNodeInst.id)
    .run();

  // Update instance current_node_key
  await env.DB.prepare(
    `UPDATE approval_instance SET current_node_key = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(nextKey, now, instanceId)
    .run();

  // Initialize next node
  const nextNode: ParsedNode = parsedTemplate.nodes.get(nextKey)!;
  const nextExecutor = executorFactory(nextNode.type);

  // Reload node instance to get updated status
  const updatedNextNodeInst = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE id = ?"
  )
    .bind(nextNodeInst.id)
    .first<ApprovalNodeInstance>();

  if (updatedNextNodeInst) {
    await nextExecutor.initializeNode(env, updatedNextNodeInst, nextNode.config, instanceId);
  }

  // Auto-advance if next node is auto-completing (auto, cc)
  if (nextNode.type === "auto" || nextNode.type === "cc") {
    await advanceWorkflow(env, instanceId, aiGateHandler);
  }
};

// ─── Round Reset (for return operations) ──────────

/**
 * Reset workflow to a target node. Used by return operations.
 * Cancels nodes between current and target, re-initializes target.
 */
export const handleRoundReset = async (
  env: Env,
  instanceId: number,
  targetNodeKey: string
): Promise<void> => {
  const now = nowIso();

  // Cancel all pending tasks in the instance for current round
  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance) {
    throw new Error(`Instance ${instanceId} not found`);
  }

  // Cancel all pending/in_progress nodes after the target
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'skipped', updated_at = ?
     WHERE instance_id = ? AND round = ? AND status IN ('pending', 'in_progress')
       AND node_key != ?`
  )
    .bind(now, instanceId, instance.current_round, targetNodeKey)
    .run();

  // Cancel pending tasks
  await env.DB.prepare(
    `UPDATE approval_task SET status = 'cancelled', updated_at = ?
     WHERE instance_id = ? AND round = ? AND status = 'pending'`
  )
    .bind(now, instanceId, instance.current_round)
    .run();

  // Re-initialize target node
  const targetNodeInst = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ? AND node_key = ? AND round = ?`
  )
    .bind(instanceId, targetNodeKey, instance.current_round)
    .first<ApprovalNodeInstance>();

  if (!targetNodeInst) {
    throw new Error(`Target node instance not found: ${targetNodeKey}`);
  }

  // Reset target node to in_progress
  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'in_progress', started_at = ?, completed_at = NULL, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, targetNodeInst.id)
    .run();

  // Get template for node config
  const template = await env.DB.prepare(
    "SELECT * FROM approval_template WHERE id = ?"
  )
    .bind(instance.template_id)
    .first<{ config_json: string }>();

  if (!template) {
    throw new Error(`Template ${instance.template_id} not found`);
  }

  const parsedTemplate: ParsedTemplate = parseTemplate(template.config_json);
  const targetNode: ParsedNode | undefined = parsedTemplate.nodes.get(targetNodeKey);

  if (!targetNode) {
    throw new Error(`Node ${targetNodeKey} not found in template`);
  }

  // Reload target node instance
  const updatedTargetInst = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE id = ?"
  )
    .bind(targetNodeInst.id)
    .first<ApprovalNodeInstance>();

  if (updatedTargetInst) {
    const executor = executorFactory(targetNode.type);
    await executor.initializeNode(env, updatedTargetInst, targetNode.config, instanceId);
  }

  // Update instance current_node_key
  await env.DB.prepare(
    `UPDATE approval_instance SET current_node_key = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(targetNodeKey, now, instanceId)
    .run();
};

// ─── Resubmit ──────────

/**
 * Resubmit an approval after return/withdraw. Increments round, creates fresh nodes.
 */
export const handleResubmit = async (
  env: Env,
  instanceId: number,
  newSummary?: string
): Promise<void> => {
  const now = nowIso();

  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance) {
    throw new Error(`Instance ${instanceId} not found`);
  }

  const newRound = instance.current_round + 1;

  // Load template
  const template = await env.DB.prepare(
    "SELECT * FROM approval_template WHERE id = ?"
  )
    .bind(instance.template_id)
    .first<{ config_json: string }>();

  if (!template) {
    throw new Error(`Template ${instance.template_id} not found`);
  }

  const parsedTemplate: ParsedTemplate = parseTemplate(template.config_json);

  // Create fresh node instances for new round
  for (let i = 0; i < parsedTemplate.nodeOrder.length; i++) {
    const nodeKey = parsedTemplate.nodeOrder[i];
    const node: ParsedNode = parsedTemplate.nodes.get(nodeKey)!;
    const assigneeUserids = getAssigneeUserids(node.config);

    await env.DB.prepare(
      `INSERT INTO approval_node_instance
        (instance_id, node_key, node_type, node_name, assignee_userids,
         status, round, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
      .bind(
        instanceId, nodeKey, node.type, node.name,
        assigneeUserids, newRound, i, now, now
      )
      .run();
  }

  // Update instance
  const summary = newSummary ?? instance.biz_summary;
  await env.DB.prepare(
    `UPDATE approval_instance
     SET status = 'in_progress', current_round = ?, current_node_key = ?,
         biz_summary = ?, completed_at = NULL, updated_at = ?
     WHERE id = ?`
  )
    .bind(newRound, parsedTemplate.startKey, summary, now, instanceId)
    .run();

  // Initialize first node of new round
  const firstNodeKey = parsedTemplate.startKey;
  const firstNode: ParsedNode = parsedTemplate.nodes.get(firstNodeKey)!;

  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'in_progress', started_at = ?, updated_at = ?
     WHERE instance_id = ? AND node_key = ? AND round = ?`
  )
    .bind(now, now, instanceId, firstNodeKey, newRound)
    .run();

  const firstNodeInst = await env.DB.prepare(
    "SELECT * FROM approval_node_instance WHERE instance_id = ? AND node_key = ? AND round = ?"
  )
    .bind(instanceId, firstNodeKey, newRound)
    .first<ApprovalNodeInstance>();

  if (firstNodeInst) {
    const executor = executorFactory(firstNode.type);
    await executor.initializeNode(env, firstNodeInst, firstNode.config, instanceId);
  }

  await publishEvent(env, "APPROVAL_SUBMITTED", "approval-engine", {
    instance_id: instanceId,
    instance_no: instance.instance_no,
    round: newRound,
    resubmit: true
  });
};

// ─── Instance Detail ──────────

/**
 * Get full approval instance detail with timeline, tasks, available actions.
 */
export const getInstanceDetail = async (
  env: Env,
  instanceId: number,
  userId: string
): Promise<ApprovalDetailResponse> => {
  // Load instance
  const instance = await env.DB.prepare(
    "SELECT * FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<ApprovalInstance>();

  if (!instance) {
    throw new Error(`Approval instance ${instanceId} not found`);
  }

  // Load template
  const template = await env.DB.prepare(
    "SELECT * FROM approval_template WHERE id = ?"
  )
    .bind(instance.template_id)
    .first<import("../../types/approval").ApprovalTemplate>();

  if (!template) {
    throw new Error(`Template ${instance.template_id} not found`);
  }

  // Load all node instances (all rounds)
  const nodeRows = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE instance_id = ?
     ORDER BY round DESC, sort_order ASC`
  )
    .bind(instanceId)
    .all<ApprovalNodeInstance>();

  const nodes = nodeRows.results ?? [];

  // Load all tasks
  const taskRows = await env.DB.prepare(
    "SELECT * FROM approval_task WHERE instance_id = ? ORDER BY created_at ASC"
  )
    .bind(instanceId)
    .all<ApprovalTask>();

  const tasks = taskRows.results ?? [];

  // Load transfers
  const transferRows = await env.DB.prepare(
    "SELECT * FROM approval_transfer WHERE instance_id = ? ORDER BY created_at ASC"
  )
    .bind(instanceId)
    .all<ApprovalTransfer>();

  const transfers = transferRows.results ?? [];

  // Load initiator actions
  const actionRows = await env.DB.prepare(
    "SELECT * FROM approval_initiator_action WHERE instance_id = ? ORDER BY created_at ASC"
  )
    .bind(instanceId)
    .all<ApprovalInitiatorAction>();

  const initiatorActions = actionRows.results ?? [];

  // Determine available actions
  const availableActions = determineAvailableActions(instance, tasks, userId);

  return {
    instance,
    template,
    nodes,
    tasks,
    transfers,
    initiator_actions: initiatorActions,
    available_actions: availableActions
  };
};

// ─── Available Actions Logic ──────────

const determineAvailableActions = (
  instance: ApprovalInstance,
  tasks: ApprovalTask[],
  userId: string
): ApprovalAction[] => {
  const actions: ApprovalAction[] = [];

  const isInitiator = instance.initiator_userid === userId;

  // Initiator actions
  if (isInitiator && instance.status === "in_progress") {
    // Check if on first node (can withdraw)
    const currentRoundNodes = tasks.filter((t) => t.round === instance.current_round);
    const isFirstNode = currentRoundNodes.length > 0; // simplified check
    if (isFirstNode) {
      actions.push("withdraw");
    }
    actions.push("cancel");
  }

  if (isInitiator && (instance.status === "pending" || instance.status === "withdrawn")) {
    actions.push("resubmit");
  }

  // Approver actions — check if user has a pending task
  const pendingTask = tasks.find(
    (t) => t.assignee_userid === userId && t.status === "pending"
  );

  if (pendingTask) {
    actions.push("approve", "reject", "return_initiator", "return_prev", "transfer");
  }

  return actions;
};

// ─── Timeout Check ──────────

/**
 * Check for timed-out approval nodes and handle them.
 */
export const checkApprovalTimeouts = async (env: Env): Promise<number> => {
  const now = nowIso();

  // Find nodes that have been in_progress too long (24h default)
  const timedOut = await env.DB.prepare(
    `SELECT * FROM approval_node_instance
     WHERE status = 'in_progress'
       AND started_at IS NOT NULL
       AND (julianday(?) - julianday(started_at)) * 24 > 24`
  )
    .bind(now)
    .all<ApprovalNodeInstance>();

  const nodes = timedOut.results ?? [];

  for (const node of nodes) {
    await publishEvent(env, "APPROVAL_TIMEOUT", "approval-engine", {
      instance_id: node.instance_id,
      node_key: node.node_key,
      node_type: node.node_type,
      started_at: node.started_at
    });
  }

  return nodes.length;
};
