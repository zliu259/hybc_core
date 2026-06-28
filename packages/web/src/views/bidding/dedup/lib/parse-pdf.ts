import * as pdfjsLib from "pdfjs-dist";
// Vite 会把 worker 作为独立资源处理。
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

// 把页面文本项拼成段落：遇到 EOL 收尾当前段，过滤空段。
export function pdfItemsToParagraphs(items: PdfTextItem[]): string[] {
  const paragraphs: string[] = [];
  let current = "";
  for (const item of items) {
    current += item.str;
    if (item.hasEOL) {
      const trimmed = current.trim();
      if (trimmed.length > 0) paragraphs.push(trimmed);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail.length > 0) paragraphs.push(tail);
  return paragraphs;
}

export async function parsePdfArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const all: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];
    if (items.length === 0) continue;
    all.push(...pdfItemsToParagraphs(items));
  }
  if (all.length === 0) {
    throw new Error("此 PDF 无文字层，需先转为可复制文字或另存。");
  }
  return all;
}
