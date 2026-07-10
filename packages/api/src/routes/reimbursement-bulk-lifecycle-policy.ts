export type BulkLifecycleAction = "void" | "delete";

const VOID_ALLOWED = new Set(["draft", "unregistered", "submitted", "received"]);
const DELETE_ALLOWED = new Set(["draft", "unregistered", "cancelled"]);

export type BulkLifecycleDecision =
  | { allowed: true; nextStatus: "cancelled" | "deleted" }
  | { allowed: false; message: string };

export type BulkLifecycleEnvelopeContext = {
  applicantUserid?: string;
  unassignedApplicant?: string;
};

export const decideBulkLifecycle = (
  action: BulkLifecycleAction,
  status: string,
  context?: BulkLifecycleEnvelopeContext
): BulkLifecycleDecision => {
  // 库存空白信封（信封生成器预生成、尚未分配填报人）是库存而非垃圾单，
  // 任何批量生命周期操作都必须跳过，避免管理员误删库存。
  if (
    context?.unassignedApplicant &&
    context.applicantUserid === context.unassignedApplicant
  ) {
    return {
      allowed: false,
      message: "Unassigned stock envelope is protected from bulk lifecycle operations"
    };
  }
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
