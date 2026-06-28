import { describe, it, expect } from "vitest";
import { splitSentences } from "../segment";

describe("splitSentences", () => {
  it("splits on Chinese terminators and newlines, keeping the terminator", () => {
    const out = splitSentences("今天天气好。明天呢？\n后天");
    expect(out).toEqual(["今天天气好。", "明天呢？", "后天"]);
  });

  it("drops empty fragments and trims", () => {
    expect(splitSentences("  甲。  。乙！ ")).toEqual(["甲。", "乙！"]);
  });

  it("returns empty array for blank input", () => {
    expect(splitSentences("   \n ")).toEqual([]);
  });
});
