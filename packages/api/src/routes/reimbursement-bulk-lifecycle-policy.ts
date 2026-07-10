export type BulkLifecycleAction = "void" | "delete";

const VOID_ALLOWED = new Set(["draft", "unregistered", "submitted", "received"]);
const DELETE_ALLOWED = new Set(["draft", "unregistered", "cancelled"]);

export type BulkLifecycleDecision =
  | { allowed: true; nextStatus: "cancelled" | "deleted" }
  | { allowed: false; message: string };

export const decideBulkLifecycle = (
  action: BulkLifecycleAction,
  status: string
): BulkLifecycleDecision => {
  if (action === "void") {
    return VOID_ALLOWED.has(status)
      ? { allowed: true, nextStatus: "cancelled" }
      : { allowed: false, message: `Envelope in status ${status} cannot be voided` };
  }
  return DELETE_ALLOWED.has(status)
    ? { allowed: true, nextStatus: "deleted" }
    : {
        allowed: false,
        message: `Envelope in status ${status} cannot be deleted (void it first)`
      };
};
