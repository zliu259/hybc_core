import type { Env } from "./types/env";
import { logEvent, type DomainEvent } from "./services/event-bus";
import { advanceWorkflow } from "./services/approval/engine";
import { createAiGateHandler } from "./services/ai-slot";

const nowIso = () => new Date().toISOString();

const getApprovalBizContext = async (
  env: Env,
  instanceId: number
): Promise<{ biz_type: string; biz_id: number } | null> => {
  return await env.DB.prepare(
    "SELECT biz_type, biz_id FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<{ biz_type: string; biz_id: number }>();
};

const handleApprovalApproved = async (
  env: Env,
  instanceId: number
): Promise<void> => {
  const context = await getApprovalBizContext(env, instanceId);
  if (!context) return;

  if (context.biz_type === "outbound_contract") {
    await env.DB.prepare(
      "UPDATE contract SET status = 'active', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "inbound_contract") {
    await env.DB.prepare(
      "UPDATE contract SET status = 'active', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "payment_request") {
    await env.DB.prepare(
      "UPDATE payment_request SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "contract_amount_change") {
    const change = await env.DB.prepare(
      "SELECT contract_id, new_amount FROM contract_amount_change WHERE id = ?"
    )
      .bind(context.biz_id)
      .first<{ contract_id: number; new_amount: number }>();

    if (!change) return;

    const now = nowIso();
    await env.DB.prepare(
      "UPDATE contract_amount_change SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare(
      "UPDATE contract SET total_amount = ?, updated_at = ? WHERE id = ?"
    )
      .bind(change.new_amount, now, change.contract_id)
      .run();
    return;
  }

  if (context.biz_type === "reimbursement_batch") {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE reimbursement_batch SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'approved', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "stock_order") {
    await env.DB.prepare(
      "UPDATE stock_order SET status = 'approved', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
  }
};

const handleApprovalRejected = async (
  env: Env,
  instanceId: number
): Promise<void> => {
  const context = await getApprovalBizContext(env, instanceId);
  if (!context) return;

  if (context.biz_type === "outbound_contract") {
    await env.DB.prepare(
      "UPDATE contract SET status = 'draft', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "inbound_contract") {
    await env.DB.prepare(
      "UPDATE contract SET status = 'draft', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "payment_request") {
    await env.DB.prepare(
      "UPDATE payment_request SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "contract_amount_change") {
    await env.DB.prepare(
      "UPDATE contract_amount_change SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "reimbursement_batch") {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE reimbursement_batch SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(now, context.biz_id)
      .run();

    await env.DB.prepare(
      "UPDATE reimbursement_envelope SET status = 'received', updated_at = ? WHERE batch_id = ?"
    )
      .bind(now, context.biz_id)
      .run();
    return;
  }

  if (context.biz_type === "stock_order") {
    await env.DB.prepare(
      "UPDATE stock_order SET status = 'rejected', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), context.biz_id)
      .run();
  }
};

const summarizeAiGateResult = (resultJson: string | null): string => {
  if (!resultJson) return "AI关卡已执行";
  try {
    const parsed = JSON.parse(resultJson) as {
      output?: string;
      metadata?: { comment?: string; summary?: string };
    };
    return (
      parsed.metadata?.comment ||
      parsed.metadata?.summary ||
      parsed.output ||
      "AI关卡已执行"
    );
  } catch {
    return "AI关卡已执行";
  }
};

const handleAiGateTaskCompleted = async (
  env: Env,
  taskId: number
): Promise<void> => {
  const task = await env.DB.prepare(
    "SELECT * FROM task_queue WHERE id = ?"
  )
    .bind(taskId)
    .first<{
      id: number;
      task_type: string;
      biz_id: number;
      payload_json: string | null;
      result_json: string | null;
    }>();

  if (!task || task.task_type !== "approval_ai_gate") return;

  let nodeKey: string | null = null;
  if (task.payload_json) {
    try {
      const payload = JSON.parse(task.payload_json) as { node_key?: string };
      nodeKey = payload.node_key ?? null;
    } catch {
      nodeKey = null;
    }
  }

  const node = nodeKey
    ? await env.DB.prepare(
        `SELECT * FROM approval_node_instance
         WHERE instance_id = ?
           AND node_type = 'ai_gate'
           AND node_key = ?
           AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`
      )
        .bind(task.biz_id, nodeKey)
        .first<{ id: number; round: number }>()
    : await env.DB.prepare(
        `SELECT * FROM approval_node_instance
         WHERE instance_id = ?
           AND node_type = 'ai_gate'
           AND status = 'in_progress'
         ORDER BY id DESC
         LIMIT 1`
      )
        .bind(task.biz_id)
        .first<{ id: number; round: number }>();

  if (!node) return;

  const now = nowIso();
  const comment = summarizeAiGateResult(task.result_json);
  await env.DB.prepare(
    "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(now, now, node.id)
    .run();

  const existing = await env.DB.prepare(
    "SELECT id FROM approval_task WHERE node_instance_id = ? AND assignee_userid = 'AI_GATE' LIMIT 1"
  )
    .bind(node.id)
    .first<{ id: number }>();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO approval_task
        (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(node.id, task.biz_id, "AI_GATE", "approve", comment, node.round, "completed", now, now, now)
      .run();
  }

  await advanceWorkflow(env, task.biz_id, createAiGateHandler());
};

export const queue = async (
  batch: MessageBatch<DomainEvent>,
  env: Env
): Promise<void> => {
  for (const msg of batch.messages) {
    try {
      const event = msg.body;
      await logEvent(env, event);

      switch (event.type) {
        case "APPROVAL_APPROVED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            await handleApprovalApproved(env, instanceId);
          }
          break;
        }
        case "APPROVAL_REJECTED": {
          const instanceId = Number(event.payload?.instance_id ?? 0);
          if (!Number.isNaN(instanceId) && instanceId > 0) {
            await handleApprovalRejected(env, instanceId);
          }
          break;
        }
        case "TASK_COMPLETED": {
          const taskId = Number(event.payload?.task_id ?? 0);
          if (!Number.isNaN(taskId) && taskId > 0) {
            await handleAiGateTaskCompleted(env, taskId);
          }
          break;
        }
        default:
          break;
      }

      msg.ack();
    } catch (err) {
      console.error("Queue processing error:", err);
      msg.retry();
    }
  }
};
