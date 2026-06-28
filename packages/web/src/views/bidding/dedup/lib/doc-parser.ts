import { parseDocxArrayBuffer } from "./parse-docx";
import { parsePdfArrayBuffer } from "./parse-pdf";

export type DocKind = "docx" | "pdf";

export function detectKind(filename: string): DocKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  throw new Error(`不支持的文件格式：${filename}（仅支持 .docx 与电子版 .pdf）`);
}

export async function parseFile(file: File): Promise<string[]> {
  const kind = detectKind(file.name);
  const arrayBuffer = await file.arrayBuffer();
  return kind === "docx"
    ? parseDocxArrayBuffer(arrayBuffer)
    : parsePdfArrayBuffer(arrayBuffer);
}
