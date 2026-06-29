import { describe, it, expect } from "vitest";
import { useDedupTool } from "../useDedupTool";
import { buildParsedDoc } from "../../lib/build-doc";

describe("useDedupTool", () => {
  it("computes star results against the master and a similarity matrix", () => {
    const tool = useDedupTool();
    tool.addDoc(
      buildParsedDoc({
        id: "m",
        name: "母本",
        role: "master",
        paragraphTexts: ["质量管理体系健全。"]
      })
    );
    tool.addDoc(
      buildParsedDoc({
        id: "c",
        name: "对比1",
        role: "compare",
        paragraphTexts: ["质量管理体系健全。其他内容。"]
      })
    );
    tool.compute();
    expect(tool.starResults.value).toHaveLength(1);
    expect(tool.starResults.value[0].charDuplicateRate).toBeGreaterThan(0);
    expect(tool.matrix.value).toHaveLength(2);
    expect(tool.matrix.value[0][0]).toBeCloseTo(1, 5);
  });

  it("throws compute error when no master is set", () => {
    const tool = useDedupTool();
    tool.addDoc(
      buildParsedDoc({
        id: "c",
        name: "对比1",
        role: "compare",
        paragraphTexts: ["内容。"]
      })
    );
    expect(() => tool.compute()).toThrow(/母本/);
  });
});
