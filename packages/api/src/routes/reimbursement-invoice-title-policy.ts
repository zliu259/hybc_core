export type InvoiceTitleEntityCandidate = {
  id: number;
  entity_name: string;
  status: string;
};

export type InvoiceTitleMatch = {
  entityId: number | null;
  name: string | null;
};

export type InvoiceReviewTitleRow = {
  task_status: string;
  extraction_json: string | null;
};

export type OcrTitleOutcome = {
  buyerName: string | null;
  pendingCount: number;
};

export type OcrTitleUpdate = {
  entityId: number | null;
  name: string | null;
  source: "ocr" | null;
};

/** 去首尾及内部空白（含全角空格），半角括号转全角；空串返回 null */
export const normalizeInvoiceTitle = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const normalized = raw
    // 注意：\s 已含 U+3000；比迁移 0087 的 SQL 归一化（仅去 U+0020/U+3000）更宽，只会多匹配不会错匹配
    .replace(/[\s\u3000]+/g, "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
  return normalized || null;
};

/** 只在 active 主体中按归一化名精确比对；唯一命中才给 entityId，原文始终保留 */
export const matchInvoiceTitleEntity = (
  raw: unknown,
  entities: InvoiceTitleEntityCandidate[]
): InvoiceTitleMatch => {
  const name = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const normalized = normalizeInvoiceTitle(raw);
  if (!normalized) return { entityId: null, name };
  const hits = entities.filter(
    (entity) =>
      entity.status === "active" && normalizeInvoiceTitle(entity.entity_name) === normalized
  );
  return { entityId: hits.length === 1 ? hits[0].id : null, name };
};

/** 从识别行的 extraction_json 读取一个非空字符串字段（如 buyer_name / seller_name） */
export const readInvoiceExtractionText = (
  extractionJson: string | null | undefined,
  field: string
): string | null => {
  if (!extractionJson) return null;
  try {
    const parsed: unknown = JSON.parse(extractionJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

/** 优先取与发票号提示同源的 bestRow，否则取第一条有 buyer_name 的完成行 */
export const pickBuyerNameFromReviews = (
  rows: InvoiceReviewTitleRow[],
  preferred: InvoiceReviewTitleRow | null | undefined
): string | null => {
  const preferredName =
    preferred?.task_status === "completed"
      ? readInvoiceExtractionText(preferred.extraction_json, "buyer_name")
      : null;
  if (preferredName) return preferredName;
  for (const row of rows) {
    if (row.task_status !== "completed") continue;
    const name = readInvoiceExtractionText(row.extraction_json, "buyer_name");
    if (name) return name;
  }
  return null;
};

/**
 * OCR 同步是否/如何写抬头：
 * - 手工指定过 → null（不写）
 * - 仍有识别任务进行中 → null（不动）
 * - 全部完成但无抬头 → 三列清空
 * - 有抬头 → 写匹配结果，来源 ocr
 */
export const resolveOcrTitleUpdate = (
  envelope: { invoice_title_source: string | null },
  outcome: OcrTitleOutcome,
  match: InvoiceTitleMatch
): OcrTitleUpdate | null => {
  if (envelope.invoice_title_source === "manual") return null;
  if (outcome.pendingCount > 0) return null;
  if (!outcome.buyerName) return { entityId: null, name: null, source: null };
  return { entityId: match.entityId, name: match.name, source: "ocr" };
};
