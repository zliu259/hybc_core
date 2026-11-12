import { describe, expect, it } from "vitest";

import { parseRange, serveObject } from "../src/services/object-serve";
import type { Env } from "../src/types/env";
import { createFakeR2 } from "./helpers/fake-r2";

// 对象读取：Range、类型和下载方式的回包头。

const setup = async () => {
  const files = createFakeR2();
  await files.put("doc-library/2026/a.pdf", "0123456789", {
    httpMetadata: { contentType: "application/pdf" }
  });
  await files.put("doc-library/2026/b.docx", "docx-bytes", {
    httpMetadata: { contentType: "application/msword" }
  });
  await files.put("wh-task/x.svg", "<svg/>", { httpMetadata: { contentType: "image/svg+xml" } });
  await files.put("miniapp/old.html", "<p>x</p>", { httpMetadata: { contentType: "text/html" } });
  const env = { FILES: files } as unknown as Env;
  const get = (key: string, range?: string, options?: Parameters<typeof serveObject>[3]) =>
    serveObject(
      env,
      key,
      new Request("https://x.test/o", range ? { headers: { range } } : undefined),
      options
    );
  return { get };
};

describe("parseRange", () => {
  it("没有头返回 null，认单段的三种写法", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
    expect(parseRange("bytes=90-", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=-10", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=-200", 100)).toEqual({ offset: 0, length: 100 });
  });

  it("结尾超出文件按文件末尾算", () => {
    expect(parseRange("bytes=95-200", 100)).toEqual({ offset: 95, length: 5 });
  });

  it("越界、写反、多段、别的单位都不认", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-2", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("bytes=a-b", 100)).toBe("invalid");
    expect(parseRange("bytes=0-9", 0)).toBe("invalid");
  });
});

describe("serveObject", () => {
  it("不带 Range 返回整个文件", async () => {
    const { get } = await setup();
    const res = await get("doc-library/2026/a.pdf");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("带 Range 返回 206 和这一段", async () => {
    const { get } = await setup();
    const res = await get("doc-library/2026/a.pdf", "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  it("越界返回 416", async () => {
    const { get } = await setup();
    const res = await get("doc-library/2026/a.pdf", "bytes=50-60");
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("对象不存在返回 404", async () => {
    const { get } = await setup();
    expect((await get("doc-library/2026/none.pdf")).status).toBe(404);
  });

  it("收紧模式：PDF 内嵌，其余当附件下载，都不让浏览器猜类型", async () => {
    const { get } = await setup();
    const pdf = await get("doc-library/2026/a.pdf", undefined, {
      hardened: true,
      fileName: "合格证.pdf"
    });
    expect(pdf.headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("合格证.pdf")}`
    );
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");

    const docx = await get("doc-library/2026/b.docx", undefined, {
      hardened: true,
      fileName: "说明 书.docx"
    });
    expect(docx.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("说明 书.docx")}`
    );
    expect(docx.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("收紧模式：SVG 虽然是图片也当附件（里面能带脚本）；forceAttachment 连 PDF 也当附件", async () => {
    const { get } = await setup();
    const svg = await get("wh-task/x.svg", undefined, { hardened: true });
    expect(svg.headers.get("content-disposition")).toBe("attachment");
    const pdf = await get("doc-library/2026/a.pdf", undefined, {
      hardened: true,
      forceAttachment: true,
      fileName: "a.pdf"
    });
    expect(pdf.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''a.pdf");
  });

  it("不收紧时保持原来的回包头（老前缀的行为不变）", async () => {
    const { get } = await setup();
    const res = await get("miniapp/old.html");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html");
  });
});
