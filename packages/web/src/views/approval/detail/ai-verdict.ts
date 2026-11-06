import type { AiGateReview, ApprovalTask } from "@/api/approval";
import {
  AI_DECISION_LABELS,
  AI_DECISION_TAGS,
  deriveAiDecisionFromComment,
  humanizeAiText,
  toFindingDimensionLabel
} from "@/utils/ai-review";
import { toActionLabel } from "../labels";
import type { TagType } from "./types";

export type AiVerdict = {
  label: string;
  tagType: TagType;
  /** 结论主文：优先模型摘要，旧数据回退到意见全文 */
  summary: string;
};

/** 容错解析内嵌在文本里的 AI JSON（旧数据的 summary/comment 可能是裸 JSON 或代码块）。 */
const parseAiPayload = (text: string | null | undefined) => {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const body = match[1]?.trim();
    if (body) candidates.push(body);
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(trimmed.slice(first, last + 1).trim());
  }

  for (const candidate of new Set(candidates)) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed)) continue;
      return {
        outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
        comment: typeof parsed.comment === "string" ? parsed.comment : null,
        summary: typeof parsed.summary === "string" ? parsed.summary : null
      };
    } catch {
      continue;
    }
  }
  return null;
};

const MATERIAL_HINT = /补充|资料|证据|材料/;

const legacyOutcomeLabel = (
  outcome: string | null | undefined,
  comment: string | null | undefined
): string => {
  if (outcome === "approve") return "建议通过";
  if (outcome === "reject") {
    return MATERIAL_HINT.test(comment ?? "") ? "建议补充材料" : "建议拒绝";
  }
  return "-";
};

const legacyOutcomeTag = (
  outcome: string | null | undefined,
  comment: string | null | undefined
): TagType => {
  if (outcome === "approve") return "success";
  if (outcome === "reject") {
    return MATERIAL_HINT.test(comment ?? "") ? "warning" : "danger";
  }
  return "info";
};

/** 三态判定优先（后端字段或规范化意见前缀），旧数据回退关键词启发式。 */
export const toAiVerdict = (review: AiGateReview): AiVerdict => {
  const embedded = parseAiPayload(review.summary);
  const outcome = review.outcome ?? embedded?.outcome ?? null;
  const comment =
    review.comment ?? embedded?.comment ?? embedded?.summary ?? null;
  const plainSummary =
    review.summary && !embedded ? review.summary : (embedded?.summary ?? null);
  const summary = humanizeAiText(plainSummary ?? comment ?? "-");
  const decision = review.decision ?? deriveAiDecisionFromComment(comment);
  if (decision && AI_DECISION_LABELS[decision]) {
    return {
      label: AI_DECISION_LABELS[decision],
      tagType: AI_DECISION_TAGS[decision],
      summary
    };
  }
  return {
    label: legacyOutcomeLabel(outcome, comment),
    tagType: legacyOutcomeTag(outcome, comment),
    summary
  };
};

export type TaskDecision = { label: string; tagType: TagType };

/** 流程记录里单条任务的动作标签。AI 任务显示三态，人工任务显示通过/驳回等。 */
export const toTaskDecision = (task: ApprovalTask): TaskDecision | null => {
  if (!task.action) return null;
  if (task.assignee_userid !== "AI_GATE") {
    return {
      label: toActionLabel(task.action),
      tagType:
        task.action === "approve"
          ? "success"
          : task.action === "reject"
            ? "danger"
            : "warning"
    };
  }
  const embedded = parseAiPayload(task.comment);
  const comment = embedded?.comment ?? task.comment;
  const decision = deriveAiDecisionFromComment(comment);
  if (decision && AI_DECISION_LABELS[decision]) {
    return {
      label: AI_DECISION_LABELS[decision],
      tagType: AI_DECISION_TAGS[decision]
    };
  }
  const outcome = embedded?.outcome ?? task.action;
  return {
    label: legacyOutcomeLabel(outcome, comment),
    tagType: legacyOutcomeTag(outcome, comment)
  };
};

/** AI 意见里残留的维度标识（amount_terms 等）换成审批人读得懂的中文。 */
export const readableAiComment = (text: string): string =>
  humanizeAiText(text).replace(/\b[a-z]+(?:_[a-z]+)+\b/g, dimension =>
    toFindingDimensionLabel(dimension)
  );

const AI_VERDICT_PREFIX = /^AI审查(?:不通过|通过|放行（需人工重点关注）)：/;

/**
 * 流程记录里的意见文本。AI 任务只留一句结论：判定已由标签表达，依据和关注点在
 * AI 审查区逐条展示，这里重复只会把时间线撑乱。
 */
export const toTaskComment = (task: ApprovalTask): string => {
  if (task.assignee_userid !== "AI_GATE") return task.comment ?? "";
  const embedded = parseAiPayload(task.comment);
  const text = embedded?.comment ?? task.comment ?? "";
  return readableAiComment(
    text.replace(AI_VERDICT_PREFIX, "").split("｜")[0].trim()
  );
};
