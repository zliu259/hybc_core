// 节 AI 审查结果宽容解析：新结构 {overall, issues, revised_content}；
// 旧结构（仅 issues、无 overall/revised_content）同样可用；解析失败返回 null。
export interface ReviewIssue {
  text: string;
  severity: string;
  reason: string;
  suggestion?: string;
}

export interface ParsedReviewResult {
  overall: string | null;
  issues: ReviewIssue[];
  revisedContent: string;
}

/** 剥 markdown 围栏后 JSON.parse；无任何可展示内容时返回 null。 */
export const parseReviewResult = (
  raw: string | null
): ParsedReviewResult | null => {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const overall =
    typeof obj.overall === "string" && obj.overall.length > 0
      ? obj.overall
      : null;
  const revisedContent =
    typeof obj.revised_content === "string" ? obj.revised_content : "";
  const rawIssues = Array.isArray(obj.issues) ? obj.issues : [];
  const issues: ReviewIssue[] = [];
  for (const item of rawIssues) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (typeof it.text !== "string" || it.text.length === 0) continue;
    issues.push({
      text: it.text,
      severity: typeof it.severity === "string" ? it.severity : "yellow",
      reason: typeof it.reason === "string" ? it.reason : "",
      suggestion:
        typeof it.suggestion === "string" && it.suggestion.length > 0
          ? it.suggestion
          : undefined
    });
  }
  if (!overall && issues.length === 0 && revisedContent.length === 0)
    return null;
  return { overall, issues, revisedContent };
};
