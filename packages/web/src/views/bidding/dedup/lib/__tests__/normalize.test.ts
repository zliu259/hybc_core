import { describe, it, expect } from "vitest";
import { normalizeText } from "../normalize";

describe("normalizeText", () => {
  it("folds full-width to half-width, lowercases, strips punctuation and spaces", () => {
    expect(normalizeText("Ｈello， 世界！")).toBe("hello世界");
  });

  it("removes whitespace between Chinese chars", () => {
    expect(normalizeText("质量  管理\t体系")).toBe("质量管理体系");
  });

  it("keeps digits", () => {
    expect(normalizeText("三检A1制度")).toBe("三检a1制度");
  });
});
