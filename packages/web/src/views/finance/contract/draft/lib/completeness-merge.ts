// 完整性检查（双模型全量审）结果合并纯函数：
// - 缺失节取双模型并集（按 section_key 去重，item 带提出者模型简名）；
// - 逐节问题按 section_key 分组聚合，每条 issue 带提出者模型简名。
// AI 输出不可信，字段全部做运行时守卫。
import type { CompletenessRun } from "@/api/contract-draft";

/** 模型简名：gpt-5.6-terra→terra、claude-sonnet-5→sonnet，其余取路径末段。 */
export const completenessModelShortName = (model: string): string => {
  if (model.includes("terra")) return "terra";
  if (model.includes("sonnet")) return "sonnet";
  const tail = model.split("/").pop() ?? "";
  return tail.length > 0 ? tail : model;
};

export interface MissingHint {
  section_key: string;
  title: string;
  level: string;
  reason: string;
  /** 提出该缺失的模型简名列表（terra/sonnet） */
  models: string[];
}

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** 双模型 missing 并集：任一模型提出即列入，按 section_key 去重并累计提出者。 */
export const mergeMissingHints = (runs: CompletenessRun[]): MissingHint[] => {
  const merged = new Map<string, MissingHint>();
  for (const run of runs) {
    const short = completenessModelShortName(run.model);
    const missing = Array.isArray(run.result?.missing)
      ? run.result.missing
      : [];
    for (const item of missing) {
      const sectionKey = asNonEmptyString(item?.section_key);
      if (!sectionKey) continue;
      const existing = merged.get(sectionKey);
      if (existing) {
        if (!existing.models.includes(short)) {
          merged.set(sectionKey, {
            ...existing,
            models: [...existing.models, short]
          });
        }
        continue;
      }
      merged.set(sectionKey, {
        section_key: sectionKey,
        title: asNonEmptyString(item.title) ?? sectionKey,
        level: asNonEmptyString(item.level) ?? "recommended",
        reason: typeof item.reason === "string" ? item.reason : "",
        models: [short]
      });
    }
  }
  return [...merged.values()];
};

export interface MergedSectionIssue {
  text: string;
  severity: string;
  reason: string;
  suggestion?: string;
  /** 提出该问题的模型简名 */
  model: string;
}

export interface SectionIssueGroup {
  section_key: string;
  title: string;
  issues: MergedSectionIssue[];
}

/** 合并两个 run 的 section_issues：按 section_key 分组，issue 带提出者简名。 */
export const mergeSectionIssueGroups = (
  runs: CompletenessRun[]
): SectionIssueGroup[] => {
  const groups = new Map<string, SectionIssueGroup>();
  for (const run of runs) {
    const short = completenessModelShortName(run.model);
    const sectionIssues = Array.isArray(run.result?.section_issues)
      ? run.result.section_issues
      : [];
    for (const si of sectionIssues) {
      const sectionKey = asNonEmptyString(si?.section_key);
      if (!sectionKey) continue;
      const rawIssues = Array.isArray(si.issues) ? si.issues : [];
      const mapped: MergedSectionIssue[] = [];
      for (const issue of rawIssues) {
        const text = asNonEmptyString(issue?.text);
        if (!text) continue;
        mapped.push({
          text,
          severity: asNonEmptyString(issue.severity) ?? "yellow",
          reason: typeof issue.reason === "string" ? issue.reason : "",
          suggestion: asNonEmptyString(issue.suggestion) ?? undefined,
          model: short
        });
      }
      if (!mapped.length) continue;
      const existing = groups.get(sectionKey);
      if (existing) {
        groups.set(sectionKey, {
          ...existing,
          issues: [...existing.issues, ...mapped]
        });
        continue;
      }
      groups.set(sectionKey, {
        section_key: sectionKey,
        title: asNonEmptyString(si.title) ?? sectionKey,
        issues: mapped
      });
    }
  }
  return [...groups.values()];
};
