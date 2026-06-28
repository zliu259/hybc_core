import { describe, it, expect } from "vitest";
import { buildHighlightSegments } from "../highlight";
import type { Sentence } from "../types";

function sent(id: string, text: string): Sentence {
  return { id, text, norm: text, shingles: new Set() };
}

describe("buildHighlightSegments", () => {
  it("marks sentences whose id is in the duplicate set", () => {
    const sentences = [sent("a#0#0", "重复句。"), sent("a#0#1", "独有句。")];
    const segs = buildHighlightSegments(sentences, new Set(["a#0#0"]));
    expect(segs).toEqual([
      { text: "重复句。", duplicate: true },
      { text: "独有句。", duplicate: false },
    ]);
  });

  it("marks nothing when the set is empty", () => {
    const segs = buildHighlightSegments([sent("a#0#0", "句。")], new Set());
    expect(segs).toEqual([{ text: "句。", duplicate: false }]);
  });
});
