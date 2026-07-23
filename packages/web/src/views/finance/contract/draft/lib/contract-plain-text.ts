// lib/contract-plain-text.ts — 纯文本预览装配（纯函数）。
// 每节：填充占位符后的正文 +（清单节）清单纯文本，按 {{__table__}} 哨兵拼入：
// 有哨兵在哨兵处，无哨兵附节末；无清单数据则清掉残留哨兵，避免显示 {{__table__}}。
import type { ContractDraftSection } from "@/api/contract-draft";
import { fillPlaceholders } from "./segments";
import { parseTable, tableToPlainText } from "./table-presets";

const SENTINEL = /\{\{__table__\}\}/;

/** 单节正文（已填充）+ 清单文本 → 拼好的节正文。 */
export const composeSectionText = (
  filledContent: string,
  tableJson: string | null
): string => {
  const table = parseTable(tableJson);
  const tableText = table && table.rows.length ? tableToPlainText(table) : "";
  if (!tableText) return filledContent.replace(SENTINEL, "").trimEnd();
  if (SENTINEL.test(filledContent)) {
    return filledContent.replace(SENTINEL, `\n${tableText}\n`);
  }
  return `${filledContent}\n${tableText}`;
};

/** 全稿纯文本：标题 + 各节（第N节 标题 / 正文含清单）。 */
export const buildDraftPlainText = (
  title: string,
  sections: ContractDraftSection[],
  keywordValues: Record<string, string>
): string => {
  const parts = sections.map((s, idx) => {
    const filled = fillPlaceholders(s.content, keywordValues);
    return `第${idx + 1}节 ${s.title}\n${composeSectionText(filled, s.table_json)}`;
  });
  return [title, ...parts].join("\n\n");
};
