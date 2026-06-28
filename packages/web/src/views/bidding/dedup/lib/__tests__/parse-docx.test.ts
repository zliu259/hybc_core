import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { splitDocxParagraphs } from "../parse-docx";

describe("splitDocxParagraphs", () => {
  it("splits raw text on newlines and trims, dropping blanks", () => {
    expect(splitDocxParagraphs("第一段\n\n第二段\n")).toEqual(["第一段", "第二段"]);
  });
});

describe("splitDocxParagraphs over real mammoth output", () => {
  it("yields paragraph texts from a real docx", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("第一段内容。")] }),
            new Paragraph({ children: [new TextRun("第二段内容。")] })
          ]
        }
      ]
    });
    const buffer = await Packer.toBuffer(doc);
    const { value } = await mammoth.extractRawText({ buffer });
    const paras = splitDocxParagraphs(value);
    expect(paras).toContain("第一段内容。");
    expect(paras).toContain("第二段内容。");
  });
});
