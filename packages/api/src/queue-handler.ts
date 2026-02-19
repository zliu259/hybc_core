import type { Env } from "./types/env";
import { logEvent, type DomainEvent } from "./services/event-bus";

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
  }
};

export default {
  async queue(batch: MessageBatch<DomainEvent>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const event = msg.body;

        // Log event to DB
        await logEvent(env, event);

        // Dispatch by event type
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
            // If task is linked to an ai_gate approval node,
            // advance the approval workflow.
            // Full implementation wired after integration testing.
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
  }
};
