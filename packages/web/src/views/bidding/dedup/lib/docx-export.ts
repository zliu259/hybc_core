import {
  AlignmentType,
  BorderStyle,
  Document,
  LineRuleType,
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

// 浏览器触发 Blob 下载（临时 <a> 点击）。所有 docx 下载入口复用它。
function triggerBlobDownload(blob: Blob, filename: string): void {
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

export async function downloadDocx(
  paragraphTexts: string[],
  filename: string
): Promise<void> {
  const blob = await Packer.toBlob(
    new Document({ sections: [{ children: buildChildren(paragraphTexts) }] })
  );
  triggerBlobDownload(blob, filename);
}

// ── 块模型（中国式合同排版）：段落按语义分级排版 + 清单渲染为 Word 真表格 ──

/** title=居中大标题；heading=第X条黑体加粗；body=正文宋体首行缩进；plain=顶部/落款不缩进；note=脚注 */
export type ParagraphStyle = "title" | "heading" | "body" | "plain" | "note";

export type DocxBlock =
  | { type: "paragraph"; text: string; style?: ParagraphStyle }
  | { type: "table"; header: string[]; rows: string[][]; widths?: number[] };

// 中文正文用宋体、标题/条号用黑体（eastAsia 决定中文字形），西文/数字用 Times New Roman。
const FONT_BODY = { eastAsia: "宋体", ascii: "Times New Roman" } as const;
const FONT_HEAD = { eastAsia: "黑体", ascii: "Times New Roman" } as const;
const SIZE_TITLE = 36; // 18pt（小二）
const SIZE_HEADING = 26; // 13pt
const SIZE_BODY = 24; // 12pt（小四）
const SIZE_NOTE = 20; // 10pt（五号）
const SIZE_CELL = 21; // 10.5pt
const LINE_1_5 = 360; // 1.5 倍行距
const INDENT_2CH = 480; // 首行缩进 2 字符（12pt）

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

// A4 纵向 + 2.5cm 页边距（twips）。
const PAGE_A4 = {
  size: { width: 11906, height: 16838 },
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
} as const;

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
    children: [
      new Paragraph({
        alignment: bold ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({ text, bold, size: SIZE_CELL, font: FONT_BODY })
        ]
      })
    ]
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

function renderParagraph(
  block: Extract<DocxBlock, { type: "paragraph" }>
): Paragraph {
  const text = block.text;
  const line = { line: LINE_1_5, lineRule: LineRuleType.AUTO } as const;
  switch (block.style) {
    case "title":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320, ...line },
        children: [
          new TextRun({ text, bold: true, size: SIZE_TITLE, font: FONT_HEAD })
        ]
      });
    case "heading":
      return new Paragraph({
        spacing: { before: 220, after: 80, ...line },
        children: [
          new TextRun({ text, bold: true, size: SIZE_HEADING, font: FONT_HEAD })
        ]
      });
    case "plain":
      return new Paragraph({
        spacing: line,
        children: [new TextRun({ text, size: SIZE_BODY, font: FONT_BODY })]
      });
    case "note":
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, ...line },
        children: [
          new TextRun({
            text,
            italics: true,
            size: SIZE_NOTE,
            color: "888888",
            font: FONT_BODY
          })
        ]
      });
    default:
      return new Paragraph({
        indent: { firstLine: INDENT_2CH },
        spacing: line,
        children: [new TextRun({ text, size: SIZE_BODY, font: FONT_BODY })]
      });
  }
}

function renderBlock(block: DocxBlock): Paragraph | Table {
  return block.type === "table" ? renderTable(block) : renderParagraph(block);
}

function buildBlockChildren(blocks: DocxBlock[]): (Paragraph | Table)[] {
  return blocks.length > 0
    ? blocks.map(renderBlock)
    : [new Paragraph({ children: [new TextRun("")] })];
}

/**
 * 由块模型（段落 + 真表格）生成 docx Blob，用于合同导出（浏览器下载）。
 * 必须用 Packer.toBlob：toBuffer 走 JSZip nodebuffer，在浏览器抛
 * "nodebuffer is not supported by this platform"，仅 Node 可用。
 */
export async function buildDocxBlobFromBlocks(
  blocks: DocxBlock[]
): Promise<Blob> {
  const doc = new Document({
    sections: [
      { properties: { page: PAGE_A4 }, children: buildBlockChildren(blocks) }
    ]
  });
  return Packer.toBlob(doc);
}

/** 由块模型生成 docx 并触发浏览器下载。 */
export async function downloadDocxFromBlocks(
  blocks: DocxBlock[],
  filename: string
): Promise<void> {
  triggerBlobDownload(await buildDocxBlobFromBlocks(blocks), filename);
}
