import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { pairSimilarity, buildSimilarityMatrix } from "../engine";

const a = buildParsedDoc({
  id: "a",
  name: "a",
  role: "master",
  paragraphTexts: ["质量管理体系健全。"],
});
const b = buildParsedDoc({
  id: "b",
  name: "b",
  role: "compare",
  paragraphTexts: ["质量管理体系健全。"],
});
const c = buildParsedDoc({
  id: "c",
  name: "c",
  role: "compare",
  paragraphTexts: ["完全不相关的内容。"],
});

describe("pairSimilarity", () => {
  it("is 1 for identical docs and symmetric", () => {
    expect(pairSimilarity(a, b, 0.8)).toBeCloseTo(1, 5);
    expect(pairSimilarity(b, a, 0.8)).toBeCloseTo(1, 5);
  });

  it("is 0 for unrelated docs", () => {
    expect(pairSimilarity(a, c, 0.8)).toBe(0);
  });
});

describe("buildSimilarityMatrix", () => {
  it("returns a symmetric matrix with 1 on the diagonal", () => {
    const m = buildSimilarityMatrix([a, b, c], 0.8);
    expect(m).toHaveLength(3);
    expect(m[0][0]).toBeCloseTo(1, 5);
    expect(m[0][1]).toBeCloseTo(1, 5);
    expect(m[1][0]).toBeCloseTo(1, 5);
    expect(m[0][2]).toBe(0);
  });
});
