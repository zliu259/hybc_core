import { describe, expect, it } from "vitest";

import {
  buildDocKey,
  contentTypeFor,
  DOC_CATEGORIES,
  DOC_CATEGORY_LABELS,
  DOC_EXTENSIONS,
  DOC_PART_SIZE,
  extensionOf,
  safeFileName
} from "../src/services/doc-library/file-types";

// 资料库收哪些文件、存成什么类型、文件键怎么起。

describe("资料库文件类型", () => {
  it("分片 8 MiB，六个资料类别都有中文名", () => {
    expect(DOC_PART_SIZE).toBe(8 * 1024 * 1024);
    expect(DOC_CATEGORIES).toEqual(["cert", "report", "params", "manual", "maintenance", "other"]);
    expect(DOC_CATEGORIES.map((key) => DOC_CATEGORY_LABELS[key])).toEqual([
      "合格证",
      "检测报告",
      "技术参数",
      "说明书",
      "保养维修",
      "其他"
    ]);
  });

  it("类型按扩展名定，不分大小写", () => {
    expect(extensionOf("合格证.PDF")).toBe("pdf");
    expect(extensionOf("a.tar.GZ")).toBe("gz");
    expect(extensionOf("没有扩展名")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
    expect(contentTypeFor("合格证.PDF")).toBe("application/pdf");
    expect(contentTypeFor("照片.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("图纸.dwg")).toBe("application/acad");
    expect(contentTypeFor("视频.mov")).toBe("video/quicktime");
    expect(contentTypeFor("a.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("白名单里的每个扩展名都有类型", () => {
    expect(DOC_EXTENSIONS).toHaveLength(24);
    for (const extension of DOC_EXTENSIONS) {
      expect(contentTypeFor(`a.${extension}`), extension).toBeTruthy();
    }
  });

  it("网页、脚本、可执行文件和没有扩展名的不收", () => {
    for (const name of [
      "a.html",
      "a.htm",
      "a.svg",
      "a.exe",
      "a.js",
      "a.sh",
      "没有扩展名",
      "a.pdf.exe",
      ""
    ]) {
      expect(contentTypeFor(name), name).toBeNull();
    }
  });

  it("扩展名正好是对象自带属性的名字（constructor、__proto__、toString）也不收", () => {
    for (const name of [
      "a.constructor",
      "a.__proto__",
      "a.toString",
      "a.hasOwnProperty",
      "a.valueOf"
    ]) {
      expect([name, contentTypeFor(name)]).toEqual([name, null]);
    }
  });

  it("文件名去掉路径和控制字符，保留中文和扩展名，不超过 120 个字符", () => {
    expect(safeFileName("../../etc/合格 证\u0000.pdf")).toBe("合格 证.pdf");
    expect(safeFileName("C:\\资料\\说明书.docx")).toBe("说明书.docx");
    expect(safeFileName("a?b#c%d.pdf")).toBe("a_b_c_d.pdf");
    const long = safeFileName(`${"长".repeat(200)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(safeFileName("   ")).toBe("file");
  });

  it("文件键带年份和唯一号", () => {
    expect(buildDocKey("合格证.pdf", new Date("2026-11-12T00:00:00Z"), "u-1")).toBe(
      "doc-library/2026/u-1-合格证.pdf"
    );
    expect(buildDocKey("../x/a b.PDF", new Date("2027-01-01T00:00:00Z"), "u-2")).toBe(
      "doc-library/2027/u-2-a b.PDF"
    );
  });
});
