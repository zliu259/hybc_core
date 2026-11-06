import type { AiGateReview, ApprovalDetailResponse } from "@/api/approval";
import { deriveAiDecisionFromComment } from "@/utils/ai-review";
import { readableAiComment } from "./ai-verdict";
import { parseVoidRecord } from "./formatters";

export type StopNotice = {
  kind: "rejected" | "returned" | "cancelled";
  title: string;
  by: string;
  comment: string;
  at: string | null;
};

const RETURN_TASK_ACTIONS = ["return_initiator", "return_prev", "return_to"];

const isAiReject = (review: AiGateReview) =>
  (review.decision === "reject" ||
    deriveAiDecisionFromComment(review.comment) === "reject") &&
  !!(review.comment ?? "").trim();

const latestBy = <T>(rows: T[], at: (row: T) => string | null): T | undefined =>
  [...rows].sort((a, b) => (at(a) ?? "").localeCompare(at(b) ?? "")).pop();

/**
 * 流程停下来的原因。按全量任务取，不受流程区的轮次筛选影响。
 * 驳回：人工驳回意见优先，没有时回退 AI 关卡的拦截结论。
 * 退回：人工意见与 AI 拦截取更晚的，避免把上一轮的旧结论错标成本次原因
 * （与小程序 extractStopReason 口径一致）。
 */
export const stopNoticeAlertType = (
  kind: StopNotice["kind"]
): "error" | "warning" | "info" =>
  kind === "rejected" ? "error" : kind === "returned" ? "warning" : "info";

export const buildStopNotice = (
  detail: ApprovalDetailResponse,
  toUserLabel: (userid: string) => string,
  /** 业务单备注：存量作废只记在这里，审批记录里没有 */
  bizRemark?: string | null
): StopNotice | null => {
  const { instance, tasks, ai_gate_reviews: reviews } = detail;

  if (instance.status === "cancelled" || instance.status === "withdrawn") {
    const withdrawn = instance.status === "withdrawn";
    const action = latestBy(
      (detail.initiator_actions ?? []).filter(
        item => item.action === (withdrawn ? "withdraw" : "cancel")
      ),
      item => item.created_at
    );
    const voided = withdrawn ? null : parseVoidRecord(bizRemark);
    const by = action?.userid ?? voided?.by;
    const title = withdrawn
      ? "发起人已撤回这笔审批"
      : voided
        ? "付款单已作废，这笔审批随之取消"
        : "这笔审批已取消";
    return {
      kind: "cancelled",
      title,
      by: by ? toUserLabel(by) : "",
      comment: action?.comment?.trim() || voided?.reason || "未填写原因",
      at: action?.created_at ?? voided?.at ?? null
    };
  }

  if (instance.status === "rejected") {
    const title = "这笔审批已被驳回";
    const human = latestBy(
      tasks.filter(t => t.action === "reject" && (t.comment ?? "").trim()),
      t => t.acted_at
    );
    if (human) {
      return {
        kind: "rejected",
        title,
        by:
          human.assignee_userid === "AI_GATE"
            ? "AI 审查"
            : toUserLabel(human.assignee_userid),
        comment: (human.comment ?? "").trim(),
        at: human.acted_at
      };
    }
    const ai = reviews.find(isAiReject);
    return ai
      ? {
          kind: "rejected",
          title,
          by: "AI 审查",
          comment: readableAiComment((ai.comment ?? "").trim()),
          at: ai.completed_at
        }
      : { kind: "rejected", title, by: "", comment: "未留驳回意见", at: null };
  }

  if (instance.status === "returned") {
    const title = "这笔审批已被退回，发起人修改后可以重新提交";
    const human = latestBy(
      tasks.filter(
        t =>
          t.assignee_userid !== "AI_GATE" &&
          RETURN_TASK_ACTIONS.includes(t.action ?? "") &&
          (t.comment ?? "").trim()
      ),
      t => t.acted_at
    );
    // ai_gate_reviews 按 created_at 倒序，首个拦截结论即最新
    const ai = reviews.find(isAiReject);
    if (
      ai &&
      (!human ||
        (!!ai.completed_at && ai.completed_at > (human.acted_at ?? "")))
    ) {
      const comment = (ai.comment ?? "").trim();
      return {
        kind: "returned",
        title,
        // 拦截意见自带「AI审查不通过：…」前缀时不再重复标注来源
        by: comment.startsWith("AI审查") ? "" : "AI 审查",
        comment: readableAiComment(comment),
        at: ai.completed_at
      };
    }
    return human
      ? {
          kind: "returned",
          title,
          by: toUserLabel(human.assignee_userid),
          comment: (human.comment ?? "").trim(),
          at: human.acted_at
        }
      : { kind: "returned", title, by: "", comment: "未留退回意见", at: null };
  }

  return null;
};
