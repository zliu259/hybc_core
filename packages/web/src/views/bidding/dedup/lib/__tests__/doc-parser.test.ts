import { describe, it, expect } from "vitest";
import { detectKind } from "../doc-parser";

describe("detectKind", () => {
  it("detects docx and pdf case-insensitively", () => {
    expect(detectKind("标书.DOCX")).toBe("docx");
    expect(detectKind("a.pdf")).toBe("pdf");
  });

  it("throws on unsupported extensions", () => {
    expect(() => detectKind("old.doc")).toThrow(/不支持/);
    expect(() => detectKind("note.txt")).toThrow(/不支持/);
  });

  it("handles filenames with multiple dots", () => {
    expect(detectKind("my.v2.docx")).toBe("docx");
  });
});
