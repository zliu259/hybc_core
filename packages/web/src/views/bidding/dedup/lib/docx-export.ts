import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

// docx requires at least one paragraph, so empty input yields one blank paragraph.
function buildChildren(paragraphTexts: string[]): Paragraph[] {
  return paragraphTexts.length > 0
    ? paragraphTexts.map(t => new Paragraph({ children: [new TextRun(t)] }))
    : [new Paragraph({ children: [new TextRun("")] })];
}

// 生成结构干净的 docx（不保留原版式，见 spec 第 9 节取舍）。
export async function buildDocxBuffer(
  paragraphTexts: string[]
): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: buildChildren(paragraphTexts) }]
  });
  return Packer.toBuffer(doc);
}

export async function downloadDocx(
  paragraphTexts: string[],
  filename: string
): Promise<void> {
  const blob = await Packer.toBlob(
    new Document({ sections: [{ children: buildChildren(paragraphTexts) }] })
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── 块模型（段落 + 真表格）：合同定稿导出用，清单表格渲染为 Word Table ──

export type DocxBlock =
  | { type: "paragraph"; text: string; heading?: boolean }
  | { type: "table"; header: string[]; rows: string[][]; widths?: number[] };

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: "999999"
} as const;
const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER
};

// 列宽折算成百分比：宽表在 A4 纵向按比例压缩列宽（文字自动换行），避免溢出页宽。
function columnPercents(colCount: number, widths?: number[]): number[] {
  if (!widths || widths.length !== colCount || colCount === 0) {
    return Array.from({ length: colCount }, () =>
      Math.floor(100 / Math.max(colCount, 1))
    );
  }
  const total = widths.reduce((a, b) => a + b, 0) || colCount;
  return widths.map(w => Math.max(1, Math.round((w / total) * 100)));
}

function tableCell(text: string, pct: number, bold: boolean): TableCell {
  return new TableCell({
    width: { size: pct, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })]
  });
}

function renderTable(block: Extract<DocxBlock, { type: "table" }>): Table {
  const colCount = block.header.length;
  const pcts = columnPercents(colCount, block.widths);
  const headerRow = new TableRow({
    tableHeader: true,
    children: block.header.map((h, i) => tableCell(h, pcts[i] ?? 1, true))
  });
  const bodyRows = block.rows.map(
    row =>
      new TableRow({
        children: Array.from({ length: colCount }, (_, i) =>
          tableCell(row[i] ?? "", pcts[i] ?? 1, false)
        )
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [headerRow, ...bodyRows]
  });
}

function renderBlock(block: DocxBlock): Paragraph | Table {
  if (block.type === "table") return renderTable(block);
  return new Paragraph({
    children: [new TextRun({ text: block.text, bold: block.heading === true })]
  });
}

function buildBlockChildren(blocks: DocxBlock[]): (Paragraph | Table)[] {
  return blocks.length > 0
    ? blocks.map(renderBlock)
    : [new Paragraph({ children: [new TextRun("")] })];
}

/** 由块模型（段落 + 真表格）生成 docx buffer，用于合同定稿导出。 */
export async function buildDocxBufferFromBlocks(
  blocks: DocxBlock[]
): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: buildBlockChildren(blocks) }]
  });
  return Packer.toBuffer(doc);
}
