/**
 * AI 审查结果（AI 关卡 / 付款风控）的前端共享展示工具。
 *
 * 新版后端契约：
 * - AI 关卡 review 带 decision（pass/warn/reject）与 risk_level；
 * - 付款风控 result 带 findings（固定维度事实判定）与 score_basis
 *   （分数构成说明，分数由后端按 warn=20/fail=50 确定性计算）。
 * 旧数据仍可能把 JSON 塞在 summary/comment 文本里，这里提供容错解析。
 */

export type AiTagType = "success" | "warning" | "danger" | "info" | "primary";

export interface AiRiskFinding {
  dimension: string;
  status: "pass" | "warn" | "fail" | string;
  detail: string;
  evidence: string;
}

/** 检查维度中文名（与 task-runner/runner/prompts.py 的维度标识对应） */
const FINDING_DIMENSION_LABELS: Record<string, string> = {
  duplicate_payment: "重复支付",
  overpayment: "超付核验",
  frequency_anomaly: "频率异常",
  counterparty_consistency: "收款方一致性",
  material_consistency: "材料一致性",
  clause_completeness: "条款完整性",
  amount_terms: "金额条款",
  counterparty_info: "相对方信息",
  performance_risk: "履约风险",
  item_precheck: "预审汇总",
  duplicate_invoice: "重复票据",
  amount_reasonableness: "金额合理性",
  data_consistency: "数据一致性",
  completeness: "材料完整性",
  compliance: "合规性"
};

export const toFindingDimensionLabel = (dimension: unknown): string => {
  if (typeof dimension !== "string" || !dimension) return "-";
  return FINDING_DIMENSION_LABELS[dimension] ?? dimension;
};

const FINDING_STATUS_LABELS: Record<string, string> = {
  pass: "通过",
  warn: "关注",
  fail: "异常"
};

const FINDING_STATUS_TAGS: Record<string, AiTagType> = {
  pass: "success",
  warn: "warning",
  fail: "danger"
};

export const toFindingStatusLabel = (status: unknown): string => {
  if (typeof status !== "string" || !status) return "-";
  return FINDING_STATUS_LABELS[status] ?? status;
};

export const toFindingStatusTagType = (status: unknown): AiTagType => {
  if (typeof status !== "string" || !status) return "info";
  return FINDING_STATUS_TAGS[status] ?? "info";
};

export const normalizeAiFindings = (raw: unknown): AiRiskFinding[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object"
    )
    .map(item => ({
      dimension: typeof item.dimension === "string" ? item.dimension : "-",
      status: typeof item.status === "string" ? item.status : "-",
      detail: typeof item.detail === "string" ? item.detail : "",
      evidence: typeof item.evidence === "string" ? item.evidence : ""
    }));
};

/** 风险分档说明（与后端 postprocess 分档一致：0-19 低 / 20-49 中 / ≥50 高） */
export const toRiskScoreBandLabel = (score: unknown): string => {
  if (typeof score !== "number" || Number.isNaN(score)) return "";
  if (score >= 50) return "高风险（≥50）";
  if (score >= 20) return "中风险（20-49）";
  return "低风险（0-19）";
};

export const toRiskScoreBandTagType = (score: unknown): AiTagType => {
  if (typeof score !== "number" || Number.isNaN(score)) return "info";
  if (score >= 50) return "danger";
  if (score >= 20) return "warning";
  return "success";
};

/** AI 关卡三态判定展示（decision 优先于二值 outcome） */
export const AI_DECISION_LABELS: Record<string, string> = {
  pass: "建议通过",
  warn: "放行·需人工关注",
  reject: "建议拒绝"
};

export const AI_DECISION_TAGS: Record<string, AiTagType> = {
  pass: "success",
  warn: "warning",
  reject: "danger"
};

/**
 * 从规范化意见文本前缀推断三态判定（后端 ai-gate-result 的 comment 格式：
 * “AI审查通过：…”/“AI审查放行（需人工重点关注）：…”/“AI审查不通过：…”）。
 * 用于 approval_task.comment 这类只有文本、没有 decision 字段的场景。
 */
export const deriveAiDecisionFromComment = (
  comment: string | null | undefined
): "pass" | "warn" | "reject" | null => {
  if (typeof comment !== "string") return null;
  if (comment.startsWith("AI审查不通过")) return "reject";
  if (comment.startsWith("AI审查放行")) return "warn";
  if (comment.startsWith("AI审查通过")) return "pass";
  return null;
};

/**
 * 容错解析文本里内嵌的 AI 结果 JSON（旧数据 summary/comment 可能是裸 JSON）。
 * 返回 null 表示不是 JSON 文本。
 */
export const parseEmbeddedAiJson = (
  text: string | null | undefined
): Record<string, unknown> | null => {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates: string[] = [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }
  const fenceMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of fenceMatches) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
};

/** 把 summary/comment 文本转成可读展示文本（旧数据裸 JSON 时提取摘要字段） */
export const toReadableAiText = (text: string | null | undefined): string => {
  if (typeof text !== "string" || !text.trim()) return "";
  const embedded = parseEmbeddedAiJson(text);
  if (!embedded) return text.trim();
  for (const key of ["comment", "summary", "output"]) {
    const value = embedded[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return text.trim();
};
