/**
 * 把 R2 里的一个对象流给浏览器：支持 Range（看视频拖进度条、大 PDF 分段取），
 * 收紧模式下不让浏览器猜类型，不能内嵌显示的一律当附件下载。
 */
import type { Env } from "../types/env";

export interface ByteRange {
  offset: number;
  length: number;
}

/** 可以直接在页面里显示的类型。SVG 里能带脚本，不算。 */
export const isInlineType = (contentType: string): boolean =>
  contentType === "application/pdf" ||
  contentType.startsWith("video/") ||
  (contentType.startsWith("image/") && contentType !== "image/svg+xml");

/**
 * 解析 Range 头。只认单段：bytes=a-b、bytes=a-、bytes=-n。
 * 没有头返回 null；越界、写法不对、多段返回 "invalid"。
 */
export const parseRange = (header: string | null, size: number): ByteRange | "invalid" | null => {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return "invalid";
  const [, startText, endText] = match;
  if (startText === "") {
    const suffix = Number(endText);
    if (endText === "" || suffix <= 0) return "invalid";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
};

export interface ServeOptions {
  /** 下载时显示的文件名 */
  fileName?: string;
  /** 连能内嵌的类型也当附件下载（对外链接） */
  forceAttachment?: boolean;
  /** 收紧模式：加 nosniff，不能内嵌的类型当附件。老前缀不开，保持原来的回包头。 */
  hardened?: boolean;
}

const notFound = (): Response =>
  Response.json({ success: false, error: { message: "File not found" } }, { status: 404 });

const disposition = (inline: boolean, fileName?: string): string => {
  const kind = inline ? "inline" : "attachment";
  return fileName ? `${kind}; filename*=UTF-8''${encodeURIComponent(fileName)}` : kind;
};

export const serveObject = async (
  env: Env,
  key: string,
  request: Request,
  options: ServeOptions = {}
): Promise<Response> => {
  const head = await env.FILES.head(key);
  if (!head) return notFound();

  const range = parseRange(request.headers.get("range"), head.size);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("etag", head.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (options.hardened || options.forceAttachment) {
    const contentType = headers.get("content-type") ?? "application/octet-stream";
    const inline = !options.forceAttachment && isInlineType(contentType);
    headers.set("x-content-type-options", "nosniff");
    if (!inline || options.fileName) {
      headers.set("content-disposition", disposition(inline, options.fileName));
    }
  }

  if (range === "invalid") {
    headers.set("content-range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }

  const object = await env.FILES.get(key, range ? { range } : undefined);
  if (!object || !object.body) return notFound();
  if (range) {
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`
    );
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(head.size));
  return new Response(object.body, { headers });
};
