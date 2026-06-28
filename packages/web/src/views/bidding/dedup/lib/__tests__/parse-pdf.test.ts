import { describe, it, expect } from "vitest";
import { pdfItemsToParagraphs } from "../parse-pdf";

describe("pdfItemsToParagraphs", () => {
  it("joins text items and splits into non-empty paragraphs on line breaks", () => {
    const items = [
      { str: "第一行" },
      { str: "继续", hasEOL: false },
      { str: "", hasEOL: true },
      { str: "第二段", hasEOL: true }
    ];
    expect(pdfItemsToParagraphs(items)).toEqual(["第一行继续", "第二段"]);
  });

  it("returns empty array when no text", () => {
    expect(pdfItemsToParagraphs([])).toEqual([]);
  });
});
