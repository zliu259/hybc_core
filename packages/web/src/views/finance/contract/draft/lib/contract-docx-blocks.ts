// lib/contract-docx-blocks.ts — 定稿 docx 块装配（纯函数，中国式合同排版）。
// 结构：居中标题 → 各节。首部(parties_basis)与落款(signature_block)不编号、正文顶格；
// 其余节为「第X条　标题」黑体条号 + 正文首行缩进。清单节在 {{__table__}} 哨兵处（或节末）插真表格。
import type { FixedSection } from "@/api/contract-draft";
import type { DocxBlock } from "@/views/bidding/dedup/lib/docx-export";
import { numberToChinese } from "./cn-ordinal";
import { parseTable, tableToGrid, type ContractTable } from "./table-presets";

const TABLE_SENTINEL_SPLIT = /\{\{__table__\}\}/;
// 首部（签约主体与依据）与落款不作为「第X条」编号条款。
const UNNUMBERED_KEYS = new Set(["parties_basis", "signature_block"]);

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
    { type: "paragraph", text: title, style: "title" }
  ];
  let clauseNo = 0;
  for (const s of sections) {
    const numbered = !UNNUMBERED_KEYS.has(s.section_key);
    const bodyStyle = numbered ? "body" : "plain";
    if (numbered) {
      clauseNo += 1;
      blocks.push({
        type: "paragraph",
        text: `第${numberToChinese(clauseNo)}条　${s.title}`,
        style: "heading"
      });
    }

    const table = parseTable(s.table_json);
    const tableBlock = table && table.rows.length ? gridToBlock(table) : null;

    const parts = s.content.split(TABLE_SENTINEL_SPLIT);
    parts.forEach((part, idx) => {
      for (const line of part.split("\n")) {
        if (line.trim() === "") continue; // 跳过空行，避免多余空段落
        blocks.push({ type: "paragraph", text: line, style: bodyStyle });
      }
      // 哨兵位置（parts 之间）插入表格
      if (idx < parts.length - 1 && tableBlock) blocks.push(tableBlock);
    });
    // 正文无哨兵但有表 → 附在节末
    if (tableBlock && parts.length === 1) blocks.push(tableBlock);
  }
  return blocks;
}
