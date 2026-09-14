import type { ApprovalTask } from "@/api/approval";

/** AI 关卡节点上受理人是真人的任务 = AI 拦截转人工的兜底复核任务。 */
export const isAiGateHumanReviewTask = (
  nodeType: string,
  task: ApprovalTask
): boolean => nodeType === "ai_gate" && task.assignee_userid !== "AI_GATE";

export const humanReviewStatusText = (
  nodeType: string,
  task: ApprovalTask
): string => {
  if (!isAiGateHumanReviewTask(nodeType, task)) return "";
  if (task.status === "pending") return "AI 拦截，等待人工复核";
  // cancelled 有多个来源（超管控制台代办、发起人撤回、实例作废），文案必须中性
  if (task.status === "cancelled") return "人工复核任务已作废";
  return "";
};
