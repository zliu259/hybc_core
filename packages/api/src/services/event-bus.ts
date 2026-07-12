import type { Env } from "../types/env";

// ─── Event Types ──────────

export const domainEventTypes = [
  "APPROVAL_SUBMITTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_RETURNED",
  "APPROVAL_TRANSFERRED",
  "APPROVAL_NODE_ENTERED",
  "APPROVAL_WITHDRAWN",
  "APPROVAL_CANCELLED",
  "APPROVAL_TIMEOUT",
  "NODE_OFFLINE",
  "TASK_REQUEUED",
  "RENTAL_OVERDUE_MARKED",
  "LOG_MISSING",
  "TASK_CREATED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "CONTRACT_CREATED",
  "CONTRACT_UPDATED",
  "PAYMENT_REQUEST_CREATED",
  "PAYMENT_CANCELLED",
  "PAYMENT_REACTIVATED",
  "PAYMENT_COMPLETED",
  "REIMBURSEMENT_ENVELOPE_CREATED",
  "REIMBURSEMENT_ENVELOPE_BATCH_GENERATED",
  "REIMBURSEMENT_ENVELOPE_SCANNED",
  "REIMBURSEMENT_ENVELOPE_UUID_REBOUND",
  "REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED",
  "REIMBURSEMENT_ENVELOPE_CANCELLED",
  "REIMBURSEMENT_ENVELOPE_SPLIT",
  "REIMBURSEMENT_ENVELOPE_BULK_VOIDED",
  "REIMBURSEMENT_ENVELOPE_BULK_DELETED",
  "REIMBURSEMENT_BATCH_CREATED",
  "REIMBURSEMENT_BATCH_SUBMITTED",
  "REIMBURSEMENT_BATCH_PAID",
  "TRANSACTION_COMPENSATION_FAILED",
  "REIMBURSEMENT_INTEGRITY_ISSUES_FOUND",
  "MANAGER_LOG_CREATED",
  "MANAGER_LOG_UPDATED",
  "OPERATOR_LOG_CREATED",
  "OPERATOR_LOG_UPDATED",
  "EXTERNAL_LOG_ADOPTED"
] as const;

export type DomainEventType = (typeof domainEventTypes)[number];

export interface DomainEvent {
  type: DomainEventType;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ─── Helpers ──────────

const nowIso = () => new Date().toISOString();

// ─── Public API ──────────

/**
 * Publish an event to the Cloudflare Queue and log it to event_log.
 * Queue send is best-effort — if the queue binding is unavailable (local dev),
 * the event is still logged to DB.
 */
export const publishEvent = async (
  env: Env,
  type: DomainEventType,
  source: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const event: DomainEvent = {
    type,
    source,
    payload,
    timestamp: nowIso()
  };

  // Always log to DB
  await logEvent(env, event);

  // Best-effort queue send
  try {
    await env.EVENT_QUEUE.send(event);
  } catch (err) {
    console.warn("Queue send failed (may be unavailable locally):", err);
  }
};

/**
 * Write an event directly to the event_log table.
 */
export const logEvent = async (env: Env, event: DomainEvent): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(event.type, event.source, JSON.stringify(event.payload), event.timestamp)
    .run();
};
