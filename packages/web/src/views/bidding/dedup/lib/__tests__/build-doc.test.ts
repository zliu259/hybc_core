import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";

describe("buildParsedDoc", () => {
  it("splits paragraphs into sentences with ids, norm and shingles", () => {
    const doc = buildParsedDoc({
      id: "d1",
      name: "a.docx",
      role: "compare",
      paragraphTexts: ["质量管理体系健全。我们很好。", "第二段。"],
    });
    expect(doc.paragraphs).toHaveLength(2);
    expect(doc.paragraphs[0].sentences).toHaveLength(2);
    expect(doc.paragraphs[0].sentences[0].id).toBe("d1#0#0");
    expect(doc.paragraphs[0].sentences[0].text).toBe("质量管理体系健全。");
    expect(doc.paragraphs[0].sentences[0].norm).toBe("质量管理体系健全");
    expect(doc.paragraphs[0].sentences[0].shingles.size).toBeGreaterThan(0);
  });

  it("skips paragraphs with no sentences", () => {
    const doc = buildParsedDoc({
      id: "d1",
      name: "a.docx",
      role: "master",
      paragraphTexts: ["   ", "有效段落。"],
    });
    expect(doc.paragraphs).toHaveLength(1);
    expect(doc.paragraphs[0].text).toBe("有效段落。");
  });

  it("drops sentences that normalize to empty and the paragraphs they leave empty", () => {
    const doc = buildParsedDoc({
      id: "d1",
      name: "a.docx",
      role: "compare",
      paragraphTexts: ["——", "有效段落。"],
    });
    expect(doc.paragraphs).toHaveLength(1);
    expect(doc.paragraphs[0].text).toBe("有效段落。");
  });
});
