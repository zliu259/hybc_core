import { describe, expect, it } from "vitest";

import { PDFJS_CMAP_DIR, pdfjsCmaps } from "../../../../build/pdfjs-cmaps";

/**
 * 没内嵌中文字体的 PDF（不少电子证照是这样的）要靠 pdf.js 自带的字符映射表才画得出字，
 * 不带的话中文那几行是空白。映射表由构建插件原名放进产物。
 */
describe("pdfjsCmaps", () => {
  it("打包时把映射表原名放进产物：pdf.js 按名字取，不能带 hash", () => {
    const emitted: { fileName: string; size: number }[] = [];
    const plugin = pdfjsCmaps();
    const generateBundle = plugin.generateBundle as unknown as (this: {
      emitFile: (file: {
        type: string;
        fileName: string;
        source: Uint8Array;
      }) => void;
    }) => void;
    generateBundle.call({
      emitFile: file => {
        expect(file.type).toBe("asset");
        emitted.push({ fileName: file.fileName, size: file.source.length });
      }
    });
    expect(PDFJS_CMAP_DIR).toBe("static/pdfjs/cmaps/");
    expect(emitted.length).toBeGreaterThan(100);
    expect(
      emitted.every(file => file.fileName.startsWith(PDFJS_CMAP_DIR))
    ).toBe(true);
    expect(emitted.every(file => file.fileName.endsWith(".bcmap"))).toBe(true);
    expect(emitted.every(file => file.size > 0)).toBe(true);
    // 简体中文最常用的两张
    const names = emitted.map(file =>
      file.fileName.slice(PDFJS_CMAP_DIR.length)
    );
    expect(names).toContain("UniGB-UCS2-H.bcmap");
    expect(names).toContain("GBK-EUC-H.bcmap");
  });
});
