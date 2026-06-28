import mammoth from "mammoth";

export function splitDocxParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

export async function parseDocxArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<string[]> {
  const buffer = Buffer.from(arrayBuffer);
  const { value } = await mammoth.extractRawText({ buffer });
  return splitDocxParagraphs(value);
}
