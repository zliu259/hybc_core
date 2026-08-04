import type {
  PrecheckIssue,
  PrecheckRuleFinding
} from "@/api/contract-precheck";

const SEVERITY_TEXT: Record<string, string> = {
  critical: "【明显错误】",
  major: "【重要】",
  minor: "【提示】"
};

/**
 * 生成可发给对方的「修改意见清单」纯文本。
 * @param issues AI 问题（含建议文本）
 * @param adoptedIndexes 已采纳的 issue 下标；为 null 时输出全部
 * @param ruleFindings 规则红黄线（始终全部列出——红线是硬性要求）
 */
export const buildOpinionList = (
  title: string,
  issues: PrecheckIssue[],
  adoptedIndexes: Set<number> | null,
  ruleFindings: PrecheckRuleFinding[]
): string => {
  const lines: string[] = [`《${title}》合同修改意见清单`, ""];
  let seq = 0;

  issues.forEach((issue, index) => {
    if (adoptedIndexes !== null && !adoptedIndexes.has(index)) return;
    seq += 1;
    lines.push(
      `${seq}. ${SEVERITY_TEXT[issue.severity] ?? ""}${issue.problem}`
    );
    if (issue.quote) lines.push(`   原文：${issue.quote}`);
    if (issue.suggestion) lines.push(`   建议修改为：${issue.suggestion}`);
    lines.push("");
  });

  for (const finding of ruleFindings) {
    seq += 1;
    const basis = finding.legal_basis ? `（依据：${finding.legal_basis}）` : "";
    lines.push(
      `${seq}. ${finding.level === "red" ? "【明显错误】" : "【提示】"}${finding.reason}${basis}`
    );
    if (finding.text) lines.push(`   原文：${finding.text}`);
    lines.push("");
  }

  if (seq === 0) {
    lines.push("（无修改意见）");
  }
  return lines.join("\n").trimEnd();
};
