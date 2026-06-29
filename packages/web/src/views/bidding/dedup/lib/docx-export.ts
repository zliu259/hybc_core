import { Document, Packer, Paragraph, TextRun } from "docx";

// docx requires at least one paragraph, so empty input yields one blank paragraph.
function buildChildren(paragraphTexts: string[]): Paragraph[] {
  return paragraphTexts.length > 0
    ? paragraphTexts.map(t => new Paragraph({ children: [new TextRun(t)] }))
    : [new Paragraph({ children: [new TextRun("")] })];
}

// 生成结构干净的 docx（不保留原版式，见 spec 第 9 节取舍）。
export async function buildDocxBuffer(paragraphTexts: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: buildChildren(paragraphTexts) }]
  });
  return Packer.toBuffer(doc);
}

export async function downloadDocx(
  paragraphTexts: string[],
  filename: string
): Promise<void> {
  const blob = await Packer.toBlob(
    new Document({ sections: [{ children: buildChildren(paragraphTexts) }] })
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
