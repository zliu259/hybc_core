import type { Env } from "../types/env";

// ─── Event Types ──────────

export const domainEventTypes = [
  "APPROVAL_SUBMITTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_RETURNED",
  "APPROVAL_TRANSFERRED",
  "APPROVAL_WITHDRAWN",
  "APPROVAL_CANCELLED",
  "APPROVAL_TIMEOUT",
  "TASK_CREATED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "TASK_FAILED"
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
export const logEvent = async (
  env: Env,
  event: DomainEvent
): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      event.type,
      event.source,
      JSON.stringify(event.payload),
      event.timestamp
    )
    .run();
};
