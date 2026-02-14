import type { Env } from "./types/env";
import { logEvent, type DomainEvent } from "./services/event-bus";

export default {
  async queue(batch: MessageBatch<DomainEvent>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const event = msg.body;

        // Log event to DB
        await logEvent(env, event);

        // Dispatch by event type
        switch (event.type) {
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
