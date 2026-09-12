export type BatchTitleEnvelope = {
  invoice_title_entity_id: number | null;
  invoice_title_name: string | null;
};

export type BatchTitleKind = "uniform" | "mixed" | "unknown" | "empty";

export type BatchTitleCount = {
  entity_id: number | null;
  name: string | null;
  count: number;
};

export type BatchTitleSummary = {
  kind: BatchTitleKind;
  entityId: number | null;
  counts: BatchTitleCount[];
};

export const MIXED_TITLE_REASON_MIN_LENGTH = 2;
export const MIXED_TITLE_REASON_MAX_LENGTH = 200;

/**
 * 汇总一组信封的抬头：
 * - empty：无信封
 * - uniform：全部同一非空主体
 * - unknown：全部未识别（不算混合）
 * - mixed：其余（含「已识别 + 未识别」）
 * counts 按数量降序；未识别桶的 name 取第一条有原文的信封。
 */
export const summarizeBatchTitles = (envelopes: BatchTitleEnvelope[]): BatchTitleSummary => {
  if (envelopes.length === 0) return { kind: "empty", entityId: null, counts: [] };

  const buckets = envelopes.reduce<Map<string, BatchTitleCount>>((map, envelope) => {
    const entityId = envelope.invoice_title_entity_id ?? null;
    const key = entityId === null ? "none" : String(entityId);
    const existing = map.get(key);
    const next: BatchTitleCount = existing
      ? {
          ...existing,
          count: existing.count + 1,
          name: existing.name ?? envelope.invoice_title_name ?? null
        }
      : { entity_id: entityId, name: envelope.invoice_title_name ?? null, count: 1 };
    return new Map(map).set(key, next);
  }, new Map());

  const counts = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (counts.length === 1) {
    const only = counts[0];
    return only.entity_id === null
      ? { kind: "unknown", entityId: null, counts }
      : { kind: "uniform", entityId: only.entity_id, counts };
  }
  return { kind: "mixed", entityId: null, counts };
};

/** 去空白后 2–200 字有效，返回裁剪后的理由；否则 null */
export const validateMixedTitleReason = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < MIXED_TITLE_REASON_MIN_LENGTH) return null;
  if (trimmed.length > MIXED_TITLE_REASON_MAX_LENGTH) return null;
  return trimmed;
};
