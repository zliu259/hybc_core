/** 每次打开表单生成一次，随单据提交；提交失败重试时沿用同一个，后端据此去重。 */
export const newClientRequestId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const formatTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "-";

/** FNV-1a 32 位，只用来区分同一次打开里内容是否变了，不做安全用途。 */
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * 导入每一批的请求号：打开对话框时的 session + 这一批内容的摘要。
 * 响应丢了再点一次、或改了后面一批再点，没变的批次请求号不变，后端直接返回上次结果；
 * 换了内容或重新打开对话框才算新的导入。
 */
export const batchRequestId = (session: string, rows: unknown): string =>
  `${session.slice(0, 40)}-${fnv1a(JSON.stringify(rows))}`;
