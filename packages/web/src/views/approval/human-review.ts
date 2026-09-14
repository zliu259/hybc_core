import type { ApprovalTask } from "@/api/approval";

/** AI 关卡节点上受理人是真人的任务 = AI 拦截转人工的兜底复核任务。 */
export const isAiGateHumanReviewTask = (
  nodeType: string,
  task: ApprovalTask
): boolean => nodeType === "ai_gate" && task.assignee_userid !== "AI_GATE";

export const humanReviewStatusText = (task: ApprovalTask): string =>
  task.status === "pending" ? "AI 拦截，等待人工复核" : "";
