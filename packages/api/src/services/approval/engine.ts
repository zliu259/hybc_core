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
  TemplateNodeConfig,
  InstanceConfig,
  NodeInstanceOverride,
  AiGateReview
} from "../../types/approval";
import { resolveTemplate } from "./router";
import { parseTemplate, getNextNodeKey, type ParsedNode, type ParsedTemplate } from "./template-parser";
import { executorFactory, setAiGateHandler } from "./executors";
import { publishEvent } from "../event-bus";
import { generateSerial } from "../serial";

const nowIso = () => new Date().toISOString();

// ─── Helper: Build route context from instance ──────────

const parseInstanceConfig = (
  instance: ApprovalInstance
): InstanceConfig | undefined => {
  if (!instance.instance_config_json) {
    return undefined;
  }

  try {
    return JSON.parse(instance.instance_config_json) as InstanceConfig;
  } catch {
    return undefined;
  }
};

const buildContextFromInstance = (instance: ApprovalInstance): RouteContext => {
  const routeContext = parseInstanceConfig(instance)?.route_context;
  return {
    ...(routeContext ?? {}),
    biz_type: instance.biz_type,
    biz_id: instance.biz_id
  };
};

const getNodeOverride = (
  instanceConfig: InstanceConfig | undefined,
  nodeKey: string
): NodeInstanceOverride | undefined => {
  return instanceConfig?.node_overrides?.[nodeKey];
};

const getMergedAssignees = (
  nodeConfig: TemplateNodeConfig,
  nodeOverride: NodeInstanceOverride | undefined,
  instanceConfig: InstanceConfig | undefined
): string[] | undefined => {
  if (nodeOverride?.assignee_userids && nodeOverride.assignee_userids.length > 0) {
    return nodeOverride.assignee_userids;
  }
  if (instanceConfig?.default_assignee_userids && instanceConfig.default_assignee_userids.length > 0) {
    return instanceConfig.default_assignee_userids;
  }
  return nodeConfig.assignee_userids;
};

const getTimeoutHours = (
  nodeConfig: TemplateNodeConfig,
  nodeOverride: NodeInstanceOverride | undefined
): number | null => {
  if (typeof nodeOverride?.timeout_hours === "number") {
    return nodeOverride.timeout_hours;
  }
  if (typeof nodeConfig.timeout_hours === "number") {
    return nodeConfig.timeout_hours;
  }
  return null;
};

type AiGateTaskResult = {
  output?: string;
  metadata?: {
    summary?: string;
    comment?: string;
    recommendations?: unknown;
    outcome?: unknown;
  };
};

const parseAiGateResult = (
  raw: string | null
): {
  summary: string | null;
  recommendations: string[];
  outcome: "approve" | "reject" | null;
  comment: string | null;
} => {
  if (!raw) {
    return {
      summary: null,
      recommendations: [],
      outcome: null,
      comment: null
    };
  }

  try {
    const parsed = JSON.parse(raw) as AiGateTaskResult;
    const recommendationsRaw = parsed.metadata?.recommendations;
    const recommendations = Array.isArray(recommendationsRaw)
      ? recommendationsRaw.filter((item): item is string => typeof item === "string")
      : [];
    const outcomeRaw = parsed.metadata?.outcome;
    const outcome =
      outcomeRaw === "approve" || outcomeRaw === "reject"
        ? outcomeRaw
        : null;
    return {
      summary: parsed.metadata?.summary ?? parsed.output ?? null,
      recommendations,
      outcome,
      comment: parsed.metadata?.comment ?? null
    };
  } catch {
    return {
      summary: null,
      recommendations: [],
      outcome: null,
      comment: null
    };
  }
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

  const fallbackRouteContext: RouteContext = {
    biz_type: request.biz_type,
    biz_id: request.biz_id,
    biz_summary: request.biz_summary
  };
  const requestRouteContext = request.context ?? request.instance_config?.route_context;
  const resolvedRouteContext: RouteContext =
    requestRouteContext && Object.keys(requestRouteContext).length > 0
      ? requestRouteContext
      : fallbackRouteContext;

  // 1. Resolve template + branch
  const { template, parsedTemplate } = await resolveTemplate(
    env,
    request.biz_type,
    resolvedRouteContext
  );

  // 2. Generate serial
  const instanceNo = await generateSerial(env.DB, "SP", "approval_instance", "instance_no");
  const now = nowIso();
  const normalizedInstanceConfig: InstanceConfig | undefined =
    request.instance_config || resolvedRouteContext
      ? {
          ...(request.instance_config ?? {}),
          route_context: resolvedRouteContext
        }
      : undefined;

  const instanceConfigJson = normalizedInstanceConfig
    ? JSON.stringify(normalizedInstanceConfig)
    : null;

  // 3. Insert instance
  const insertResult = await env.DB.prepare(
     `INSERT INTO approval_instance
       (instance_no, template_id, biz_type, biz_id, biz_summary,
        initiator_userid, current_node_key, status, current_round, instance_config_json,
        submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', 1, ?, ?, ?, ?)`
  )
    .bind(
      instanceNo, template.id, request.biz_type, request.biz_id,
      request.biz_summary, userId, parsedTemplate.startKey,
      instanceConfigJson, now, now, now
    )
    .run();

  const instanceId = insertResult.meta.last_row_id;

  // 4. Create node_instance rows for ALL nodes
  for (let i = 0; i < parsedTemplate.nodeOrder.length; i++) {
    const nodeKey = parsedTemplate.nodeOrder[i];
    const node: ParsedNode = parsedTemplate.nodes.get(nodeKey)!;
    const nodeOverride = getNodeOverride(normalizedInstanceConfig, nodeKey);
    const mergedAssignees = getMergedAssignees(node.config, nodeOverride, normalizedInstanceConfig);
    const assigneeUserids = mergedAssignees ? JSON.stringify(mergedAssignees) : null;
    const timeoutHours = getTimeoutHours(node.config, nodeOverride);

    await env.DB.prepare(
      `INSERT INTO approval_node_instance
        (instance_id, node_key, node_type, node_name, assignee_userids, timeout_hours,
         status, round, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`
    )
      .bind(
        instanceId, nodeKey, node.type, node.name,
        assigneeUserids, timeoutHours, i, now, now
      )
      .run();
  }

  if (aiGateHandler) {
    for (const nodeKey of parsedTemplate.nodeOrder) {
      const node = parsedTemplate.nodes.get(nodeKey);
      if (!node || node.type !== "ai_gate") continue;
      const aiSlotRoute =
        typeof node.config.ai_slot_id === "string" && node.config.ai_slot_id.trim()
          ? node.config.ai_slot_id.trim()
          : "approval_ai_gate";
      await aiGateHandler.createAiTask(env, {
        biz_type: aiSlotRoute,
        biz_id: instanceId as number,
        payload: {
          node_key: nodeKey,
          ai_slot_id: node.config.ai_slot_id,
          instance_id: instanceId,
          biz_type: request.biz_type,
          biz_id: request.biz_id,
          biz_summary: request.biz_summary,
          context: normalizedInstanceConfig?.route_context ?? resolvedRouteContext
        }
      });
    }
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

  if (nextNodeInst.status !== "completed") {
    await env.DB.prepare(
      `UPDATE approval_node_instance SET status = 'in_progress', started_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, nextNodeInst.id)
      .run();
  }

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

  if (nextNode.type === "auto" || nextNode.type === "cc" || nextNode.type === "ai_gate") {
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
  targetNodeKey: string,
  aiGateHandler?: AiGateHandler
): Promise<void> => {
  if (aiGateHandler) {
    setAiGateHandler(aiGateHandler);
  }
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
  newSummary?: string,
  aiGateHandler?: AiGateHandler
): Promise<void> => {
  if (aiGateHandler) {
    setAiGateHandler(aiGateHandler);
  }
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
  let instanceConfig: InstanceConfig | undefined;
  if (instance.instance_config_json) {
    try {
      instanceConfig = JSON.parse(instance.instance_config_json) as InstanceConfig;
    } catch {
      instanceConfig = undefined;
    }
  }

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
    const nodeOverride = getNodeOverride(instanceConfig, nodeKey);
    const mergedAssignees = getMergedAssignees(node.config, nodeOverride, instanceConfig);
    const assigneeUserids = mergedAssignees ? JSON.stringify(mergedAssignees) : null;
    const timeoutHours = getTimeoutHours(node.config, nodeOverride);

    await env.DB.prepare(
      `INSERT INTO approval_node_instance
        (instance_id, node_key, node_type, node_name, assignee_userids, timeout_hours,
         status, round, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
      .bind(
        instanceId, nodeKey, node.type, node.name,
        assigneeUserids, timeoutHours, newRound, i, now, now
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

  const aiGateTaskRows = await env.DB.prepare(
    `SELECT id, payload_json, status, result_json, error_message, created_at, completed_at
     FROM task_queue
     WHERE task_type = 'approval_ai_gate' AND biz_id = ?
     ORDER BY created_at DESC`
  )
    .bind(instanceId)
    .all<{
      id: number;
      payload_json: string | null;
      status: string;
      result_json: string | null;
      error_message: string | null;
      created_at: string;
      completed_at: string | null;
    }>();

  const aiGateReviews: AiGateReview[] = (aiGateTaskRows.results ?? []).map((row) => {
    let nodeKey: string | null = null;
    let aiSlotId: string | null = null;
    if (row.payload_json) {
      try {
        const payload = JSON.parse(row.payload_json) as {
          node_key?: unknown;
          ai_slot_id?: unknown;
        };
        nodeKey = typeof payload.node_key === "string" ? payload.node_key : null;
        aiSlotId = typeof payload.ai_slot_id === "string" ? payload.ai_slot_id : null;
      } catch {
        nodeKey = null;
        aiSlotId = null;
      }
    }

    const parsedResult = parseAiGateResult(row.result_json);
    return {
      task_id: row.id,
      node_key: nodeKey,
      ai_slot_id: aiSlotId,
      status: row.status,
      summary: parsedResult.summary,
      recommendations: parsedResult.recommendations,
      outcome: parsedResult.outcome,
      comment: parsedResult.comment,
      error_message: row.error_message,
      created_at: row.created_at,
      completed_at: row.completed_at
    };
  });

  // Determine available actions
  const availableActions = determineAvailableActions(instance, tasks, userId);

  return {
    instance,
    template,
    nodes,
    tasks,
    transfers,
    initiator_actions: initiatorActions,
    ai_gate_reviews: aiGateReviews,
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
       AND (julianday(?) - julianday(started_at)) * 24 > COALESCE(timeout_hours, 24)`
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
