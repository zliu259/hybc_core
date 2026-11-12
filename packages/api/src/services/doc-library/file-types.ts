/** 资料库收哪些文件、存成什么类型、文件键怎么起。纯函数。 */
import type { DocCategory } from "../../types/wh";

/** 分片大小。R2 要求除最后一片外每片一样大、不小于 5 MiB。 */
export const DOC_PART_SIZE = 8 * 1024 * 1024;

export const DOC_CATEGORIES: readonly DocCategory[] = [
  "cert",
  "report",
  "params",
  "manual",
  "maintenance",
  "other"
];

export const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
  cert: "合格证",
  report: "检测报告",
  params: "技术参数",
  manual: "说明书",
  maintenance: "保养维修",
  other: "其他"
};

/**
 * 白名单：扩展名 → 存进 R2 的类型。类型由服务端按扩展名定，不信客户端传的；
 * 网页、SVG、脚本、可执行文件不在里面。
 */
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  ofd: "application/ofd",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  dwg: "application/acad",
  dxf: "application/dxf"
};

export const DOC_EXTENSIONS: readonly string[] = Object.keys(CONTENT_TYPES);

const MAX_FILE_NAME = 120;

const baseName = (fileName: string): string => fileName.split(/[\\/]/).pop() ?? "";

/** 扩展名，小写，不带点；没有扩展名（或只有 ".xxx"）返回空串。 */
export const extensionOf = (fileName: string): string => {
  const name = baseName(String(fileName ?? "")).trim();
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
};

/** 不在白名单返回 null。 */
export const contentTypeFor = (fileName: string): string | null =>
  CONTENT_TYPES[extensionOf(fileName)] ?? null;

/** 去掉路径和控制字符，把地址里有特殊含义的字符换成下划线；保留中文和扩展名，最长 120 个字符。 */
export const safeFileName = (fileName: string): string => {
  const cleaned = baseName(String(fileName ?? ""))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[?#%"<>|*:]/g, "_")
    .trim();
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_FILE_NAME) return cleaned;
  const extension = extensionOf(cleaned);
  const suffix = extension ? `.${cleaned.slice(cleaned.length - extension.length)}` : "";
  return `${cleaned.slice(0, MAX_FILE_NAME - suffix.length)}${suffix}`;
};

/** doc-library/<年>/<唯一号>-<安全文件名>。一个键只写一次。 */
export const buildDocKey = (fileName: string, now: Date, uuid: string): string =>
  `doc-library/${now.getUTCFullYear()}/${uuid}-${safeFileName(fileName)}`;
