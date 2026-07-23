// lib/contract-docx-blocks.ts — 定稿 docx 块装配（纯函数）。
// 每节：标题 + 正文（按 {{__table__}} 哨兵切分，哨兵处插清单真表格；无哨兵但有表则附节末）。
import type { FixedSection } from "@/api/contract-draft";
import type { DocxBlock } from "@/views/bidding/dedup/lib/docx-export";
import { parseTable, tableToGrid, type ContractTable } from "./table-presets";

const TABLE_SENTINEL_SPLIT = /\{\{__table__\}\}/;
const DISCLAIMER =
  "【本文档由 AI 辅助起草，须经负责人审核后方可作为正式合同使用】";

const gridToBlock = (table: ContractTable): DocxBlock => {
  const grid = tableToGrid(table);
  return {
    type: "table",
    header: grid.header,
    rows: grid.rows,
    widths: grid.widths
  };
};

export function buildContractDocxBlocks(
  title: string,
  sections: FixedSection[]
): DocxBlock[] {
  const blocks: DocxBlock[] = [
    { type: "paragraph", text: title, heading: true }
  ];
  for (const s of sections) {
    blocks.push({ type: "paragraph", text: "" });
    blocks.push({ type: "paragraph", text: s.title, heading: true });

    const table = parseTable(s.table_json);
    const tableBlock = table && table.rows.length ? gridToBlock(table) : null;

    const parts = s.content.split(TABLE_SENTINEL_SPLIT);
    parts.forEach((part, idx) => {
      for (const line of part.split("\n")) {
        blocks.push({ type: "paragraph", text: line });
      }
      // 哨兵位置（parts 之间）插入表格
      if (idx < parts.length - 1 && tableBlock) blocks.push(tableBlock);
    });
    // 正文无哨兵但有表 → 附在节末
    if (tableBlock && parts.length === 1) blocks.push(tableBlock);
  }
  blocks.push({ type: "paragraph", text: "" });
  blocks.push({ type: "paragraph", text: DISCLAIMER });
  return blocks;
}
