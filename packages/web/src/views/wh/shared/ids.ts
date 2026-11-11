/** 每次打开表单生成一次，随单据提交；提交失败重试时沿用同一个，后端据此去重。 */
export const newClientRequestId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const formatTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "-";
