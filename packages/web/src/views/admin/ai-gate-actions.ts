import type { ApprovalAiGateTaskItem } from "@/api/admin";

/**
 * 按钮可用性与轮次标签只依赖这两个字段，直接从 API 类型取，避免两处定义漂移。
 */
export type AiGateTaskActionInput = Pick<
  ApprovalAiGateTaskItem,
  "task_round" | "instance"
>;

/**
 * 放行/驳回只对「审批中实例的当前轮任务」有意义：
 * 后端对旧轮任务与非审批中实例会 409（AI 拦截已退回发起人、实例已终态、或任务属于上一轮）。
 * 实例查不到时不拦前端，交由后端给出准确错误。
 */
export const canPushAiGateFlow = (row: AiGateTaskActionInput): boolean => {
  if (!row.instance) return true;
  return (
    row.instance.status === "in_progress" &&
    row.task_round === row.instance.current_round
  );
};

/** 列表里标出任务属于第几轮；不是实例当前轮的补「旧轮」，提示按钮为何置灰。 */
export const taskRoundLabel = (row: AiGateTaskActionInput): string => {
  const base = `第 ${row.task_round} 轮`;
  if (row.instance && row.task_round !== row.instance.current_round) {
    return `${base}（旧轮）`;
  }
  return base;
};
