import type { ParsedDoc, DedupResult } from "./types";

export interface RewriteParagraph {
  id: string;
  text: string;
}

// Paragraph id: `${docId}#${paraIdx}` — sentence id is `${docId}#${paraIdx}#${sentIdx}`.
function paragraphIdOf(docId: string, paraIdx: number): string {
  return `${docId}#${paraIdx}`;
}

export function collectDuplicateParagraphs(
  compare: ParsedDoc,
  result: DedupResult
): RewriteParagraph[] {
  const dupSentenceIds = new Set(result.matches.map((m) => m.compareSentenceId));
  return compare.paragraphs
    .filter((p) => p.sentences.some((s) => dupSentenceIds.has(s.id)))
    .map((p) => ({ id: paragraphIdOf(compare.id, p.idx), text: p.text }));
}

export function applyRewrites(
  compare: ParsedDoc,
  accepted: ReadonlyMap<string, string>
): string[] {
  return compare.paragraphs.map((p) => {
    const rewritten = accepted.get(paragraphIdOf(compare.id, p.idx));
    return rewritten ?? p.text;
  });
}
