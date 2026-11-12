/**
 * 把 R2 里的一个对象流给浏览器：支持 Range（看视频拖进度条、大 PDF 分段取），
 * 收紧模式下不让浏览器猜类型，不能内嵌显示的一律当附件下载。
 */
import type { Env } from "../types/env";

export interface ByteRange {
  offset: number;
  length: number;
}

/** 去掉参数（; charset=…），小写。 */
const essenceOf = (contentType: string): string =>
  String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

/** 可以直接在页面里显示的类型。SVG 里能带脚本，不算。 */
export const isInlineType = (contentType: string): boolean => {
  const type = essenceOf(contentType);
  return (
    type === "application/pdf" ||
    type.startsWith("video/") ||
    (type.startsWith("image/") && type !== "image/svg+xml")
  );
};

/** 浏览器只会照字面显示、不会当网页执行的文本。 */
const isPlainText = (type: string): boolean => type === "text/plain" || type === "application/json";

/** 没写类型的二进制。有的图片是这样存的，<img> 要靠浏览器自己认出来，所以不能加 nosniff。 */
const isUntypedBinary = (type: string): boolean =>
  type === "application/octet-stream" || type === "binary/octet-stream";

/**
 * 老前缀（没开收紧模式）的回包头。上传时存的类型是上传的人说的，不能信：
 * 图片、视频、音频、PDF 照旧；纯文本加 nosniff；其余的（HTML、SVG、XML、说不清的类型…）一律当附件，
 * 不让它在我们的域名下当网页打开——否则谁能传文件谁就能在这个域名下跑脚本。
 */
const applyLegacyHeaders = (headers: Headers): void => {
  const type = essenceOf(headers.get("content-type") ?? "application/octet-stream");
  if (isInlineType(type) || type.startsWith("audio/")) return;
  if (isPlainText(type)) {
    headers.set("x-content-type-options", "nosniff");
    return;
  }
  headers.set("content-disposition", "attachment");
  if (!isUntypedBinary(type)) headers.set("x-content-type-options", "nosniff");
};

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
  /**
   * 收紧模式：加 nosniff，不能内嵌的类型当附件。
   * 老前缀不开：图片、视频、音频、PDF 的回包头保持原样，但能当网页执行的内容照样当附件。
   */
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
  } else {
    applyLegacyHeaders(headers);
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
