import { describe, it, expect } from "vitest";
import { buildDocxBlobFromBlocks, buildDocxBuffer } from "../docx-export";

describe("buildDocxBuffer", () => {
  it("produces a non-empty docx buffer from paragraph texts", async () => {
    const buf = await buildDocxBuffer(["第一段。", "第二段。"]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("handles empty input without throwing", async () => {
    const buf = await buildDocxBuffer([]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});

describe("buildDocxBlobFromBlocks", () => {
  // 浏览器路径必须走 toBlob（toBuffer 在浏览器抛 nodebuffer not supported）。
  it("produces a non-empty docx Blob from mixed paragraph + table blocks", async () => {
    const blob = await buildDocxBlobFromBlocks([
      { type: "paragraph", text: "合同标题", heading: true },
      { type: "paragraph", text: "正文一段。" },
      {
        type: "table",
        header: ["序号", "设备名称", "含税金额(元)"],
        rows: [
          ["1", "挖掘机", "1,600.00"],
          ["合计", "", "1,600.00"]
        ],
        widths: [640, 1900, 1500]
      }
    ]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("handles empty blocks without throwing", async () => {
    const blob = await buildDocxBlobFromBlocks([]);
    expect(blob.size).toBeGreaterThan(0);
  });
});
