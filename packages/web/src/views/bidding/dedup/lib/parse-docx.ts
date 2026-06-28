import mammoth from "mammoth";

export function splitDocxParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// Runs in the browser: mammoth's browser build reads { arrayBuffer }.
// (Node's mammoth build instead wants { buffer } — that's only relevant in tests.)
export async function parseDocxArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<string[]> {
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return splitDocxParagraphs(value);
}
