import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { splitDocxParagraphs, parseDocxArrayBuffer } from "../parse-docx";

describe("splitDocxParagraphs", () => {
  it("splits raw text on newlines and trims, dropping blanks", () => {
    expect(splitDocxParagraphs("第一段\n\n第二段\n")).toEqual(["第一段", "第二段"]);
  });
});

describe("parseDocxArrayBuffer", () => {
  it("extracts paragraph texts from a real docx", async () => {
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
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const paras = await parseDocxArrayBuffer(arrayBuffer);
    expect(paras).toContain("第一段内容。");
    expect(paras).toContain("第二段内容。");
  });
});
