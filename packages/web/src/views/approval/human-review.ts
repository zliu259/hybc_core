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
  // 超管在控制台直接放行/驳回时，后端会把审核人的待办置为 cancelled
  if (task.status === "cancelled") return "已由超管在控制台代为处理";
  return "";
};
