import { Document, Packer, Paragraph, TextRun } from "docx";

// 生成结构干净的 docx（不保留原版式，见 spec 第 9 节取舍）。
export async function buildDocxBuffer(paragraphTexts: string[]): Promise<Buffer> {
  const children =
    paragraphTexts.length > 0
      ? paragraphTexts.map(
          t => new Paragraph({ children: [new TextRun(t)] })
        )
      : [new Paragraph({ children: [new TextRun("")] })];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function downloadDocx(
  paragraphTexts: string[],
  filename: string
): Promise<void> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const children =
    paragraphTexts.length > 0
      ? paragraphTexts.map(
          t => new Paragraph({ children: [new TextRun(t)] })
        )
      : [new Paragraph({ children: [new TextRun("")] })];
  const blob = await Packer.toBlob(
    new Document({ sections: [{ children }] })
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
