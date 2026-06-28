import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { compareToMaster } from "../engine";

describe("compareToMaster", () => {
  const master = buildParsedDoc({
    id: "m",
    name: "master",
    role: "master",
    paragraphTexts: ["质量管理体系健全。"],
  });

  it("flags an exact-duplicate sentence and computes char/sentence rates", () => {
    const compare = buildParsedDoc({
      id: "c",
      name: "compare",
      role: "compare",
      paragraphTexts: ["质量管理体系健全。我们很好。"],
    });
    const result = compareToMaster(master, compare, 0.8);
    expect(result.compareDocId).toBe("c");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].score).toBeCloseTo(1, 5);
    // "质量管理体系健全。"=9 chars matched / total 14 chars
    expect(result.charDuplicateRate).toBeCloseTo(9 / 14, 3);
    expect(result.sentDuplicateRate).toBeCloseTo(0.5, 5);
  });

  it("flags a near-duplicate above threshold", () => {
    const compare = buildParsedDoc({
      id: "c2",
      name: "compare2",
      role: "compare",
      paragraphTexts: ["质量管理体系健全有效。"],
    });
    const result = compareToMaster(master, compare, 0.6);
    expect(result.matches).toHaveLength(1);
    expect(result.charDuplicateRate).toBeCloseTo(1, 5);
  });

  it("reports zero when nothing is similar", () => {
    const compare = buildParsedDoc({
      id: "c3",
      name: "compare3",
      role: "compare",
      paragraphTexts: ["完全不相关的内容描述。"],
    });
    const result = compareToMaster(master, compare, 0.8);
    expect(result.matches).toHaveLength(0);
    expect(result.charDuplicateRate).toBe(0);
    expect(result.sentDuplicateRate).toBe(0);
  });
});
