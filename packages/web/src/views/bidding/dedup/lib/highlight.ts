import type { Sentence } from "./types";

export interface HighlightSegment {
  text: string;
  duplicate: boolean;
}

export function buildHighlightSegments(
  sentences: Sentence[],
  duplicateIds: Set<string>,
): HighlightSegment[] {
  return sentences.map((s) => ({
    text: s.text,
    duplicate: duplicateIds.has(s.id),
  }));
}
