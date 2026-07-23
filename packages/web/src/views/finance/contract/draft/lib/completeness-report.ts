// 完整检查 v2（前后递进）结果宽容解析纯函数：
// 后端 result_json / completeness_result_json 形如
// {initial:{model,result}, audit:{model,result}}；两阶段 result 结构同构，
// audit 额外带 verdict / audit_note / revised_content / revision_approved。
// AI 输出不可信，所有字段做运行时守卫，畸形一律回退安全默认。
import type {
  CompletenessIssue,
  CompletenessReport,
  CompletenessResult,
  CompletenessSectionIssue,
  CompletenessVerdict
} from "@/api/contract-draft";

/** 模型简名：gpt-5.6-terra→terra、claude-sonnet-5→sonnet，其余取路径末段。 */
export const completenessModelShortName = (model: string): string => {
  if (model.includes("terra")) return "terra";
  if (model.includes("sonnet")) return "sonnet";
  const tail = model.split("/").pop() ?? "";
  return tail.length > 0 ? tail : model;
};

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asOptionalString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const asVerdict = (v: unknown): CompletenessVerdict | undefined =>
  v === "confirmed" || v === "rejected" || v === "added" ? v : undefined;

type MissingItem = NonNullable<CompletenessResult["missing"]>[number];

const normalizeMissing = (v: unknown): MissingItem | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const sectionKey = asString(o.section_key);
  if (!sectionKey) return null;
  return {
    section_key: sectionKey,
    title: asString(o.title) || sectionKey,
    level: asString(o.level) || "recommended",
    reason: asString(o.reason),
    verdict: asOptionalString(o.verdict),
    audit_note: asOptionalString(o.audit_note)
  };
};

const normalizeIssue = (v: unknown): CompletenessIssue | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = asString(o.text);
  if (!text) return null;
  return {
    text,
    severity: asString(o.severity) || "yellow",
    reason: asString(o.reason),
    suggestion: asOptionalString(o.suggestion),
    verdict: asVerdict(o.verdict),
    audit_note: asOptionalString(o.audit_note)
  };
};

const normalizeSectionIssue = (v: unknown): CompletenessSectionIssue | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const sectionKey = asString(o.section_key);
  if (!sectionKey) return null;
  const rawIssues = Array.isArray(o.issues) ? o.issues : [];
  const issues = rawIssues
    .map(normalizeIssue)
    .filter((x): x is CompletenessIssue => x !== null);
  const revised = asOptionalString(o.revised_content);
  // 既无问题也无修正稿的空节丢弃（避免展示空组）
  if (!issues.length && !revised) return null;
  return {
    section_key: sectionKey,
    title: asString(o.title) || sectionKey,
    issues,
    revised_content: revised,
    revision_approved: o.revision_approved === true
  };
};

const normalizeResult = (v: unknown): CompletenessResult => {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const missing = (Array.isArray(o.missing) ? o.missing : [])
    .map(normalizeMissing)
    .filter((x): x is MissingItem => x !== null);
  const sectionIssues = (
    Array.isArray(o.section_issues) ? o.section_issues : []
  )
    .map(normalizeSectionIssue)
    .filter((x): x is CompletenessSectionIssue => x !== null);
  return {
    missing,
    section_issues: sectionIssues,
    overall_summary: asOptionalString(o.overall_summary),
    ready_to_finalize:
      typeof o.ready_to_finalize === "boolean"
        ? o.ready_to_finalize
        : undefined,
    raw: asOptionalString(o.raw),
    _truncated: o._truncated === true
  };
};

/**
 * 宽容解析递进结果 JSON 为 CompletenessReport；
 * 无法解析或既无 initial 又无 audit 时返回 null（调用方提示重新检查）。
 */
export const parseCompletenessReport = (
  raw: string | null
): CompletenessReport | null => {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const hasInitial = o.initial && typeof o.initial === "object";
  const hasAudit = o.audit && typeof o.audit === "object";
  if (!hasInitial && !hasAudit) return null;
  const initial = hasInitial ? (o.initial as Record<string, unknown>) : {};
  const audit = hasAudit ? (o.audit as Record<string, unknown>) : {};
  return {
    initial: {
      model: asString(initial.model),
      result: normalizeResult(initial.result)
    },
    audit: {
      model: asString(audit.model),
      result: normalizeResult(audit.result)
    }
  };
};
