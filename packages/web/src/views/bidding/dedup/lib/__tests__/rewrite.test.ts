import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { compareToMaster } from "../engine";
import { collectDuplicateParagraphs, applyRewrites } from "../rewrite";

const master = buildParsedDoc({
  id: "m", name: "母本", role: "master",
  paragraphTexts: ["质量管理体系健全。"]
});
const compare = buildParsedDoc({
  id: "c", name: "对比1", role: "compare",
  paragraphTexts: ["质量管理体系健全。独有内容甲。", "完全无关的段落乙。"]
});

describe("collectDuplicateParagraphs", () => {
  it("returns only paragraphs containing a flagged duplicate sentence, id=`${docId}#${paraIdx}`", () => {
    const result = compareToMaster(master, compare, 0.8);
    const paras = collectDuplicateParagraphs(compare, result);
    expect(paras).toHaveLength(1);
    expect(paras[0].id).toBe("c#0");
    expect(paras[0].text).toContain("质量管理体系健全");
  });
});

describe("applyRewrites", () => {
  it("replaces flagged paragraph text with accepted rewrites, leaving others intact", () => {
    const accepted = new Map<string, string>([["c#0", "由项目经理牵头组建质量管控小组。"]]);
    const texts = applyRewrites(compare, accepted);
    expect(texts[0]).toBe("由项目经理牵头组建质量管控小组。");
    expect(texts[1]).toBe("完全无关的段落乙。");
  });

  it("keeps original text when no rewrite accepted for a paragraph", () => {
    const texts = applyRewrites(compare, new Map());
    expect(texts).toEqual(["质量管理体系健全。独有内容甲。", "完全无关的段落乙。"]);
  });
});
