import { writeAuditLog } from "./audit-log";
import { publishEvent } from "./event-bus";
import type { Env } from "../types/env";

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type CompensationFailureReport = {
  operation: string;
  targetType: string;
  targetId: number;
  actorUserId?: string;
  actorRoles?: string[];
  originalError: unknown;
  compensationError: unknown;
  context?: Record<string, unknown>;
};

/**
 * 补偿逻辑自身失败时的上报：留下可查询、可告警的持久痕迹。
 * 本函数**永不抛出**——它总是在 catch 中被调用，抛出会掩盖原始错误。
 */
export const reportCompensationFailure = async (
  env: Env,
  report: CompensationFailureReport
): Promise<void> => {
  const detail = {
    operation: report.operation,
    original_error: toMessage(report.originalError),
    compensation_error: toMessage(report.compensationError),
    ...report.context
  };

  console.error("Transaction compensation failed", {
    target: `${report.targetType}#${report.targetId}`,
    ...detail
  });

  try {
    await writeAuditLog(env.DB, {
      actorUserId: report.actorUserId ?? "system",
      actorRoles: report.actorRoles ?? [],
      action: "system.transaction.compensation_failed",
      targetType: report.targetType,
      targetId: report.targetId,
      detail
    });
  } catch (auditError) {
    console.error("Failed to persist compensation-failure audit log", auditError);
  }

  try {
    await publishEvent(env, "TRANSACTION_COMPENSATION_FAILED", report.targetType, {
      ...detail,
      target_id: report.targetId
    });
  } catch (eventError) {
    console.error("Failed to publish compensation-failure event", eventError);
  }
};
