// 费用合理性审查结果的读取容错：模型可能写中文等级、缺字段或用旧格式。
// 认不出的等级不显示，不再出现「风险等级：未标记」。

export type AnomalyLevel = "low" | "medium" | "high";

export interface NormalizedAnomaly {
  attachment_id: number | null;
  level: AnomalyLevel;
  reason: string;
}

export interface NormalizedAnomalyResult {
  risk_level: AnomalyLevel | null;
  summary: string | null;
  anomalies: NormalizedAnomaly[];
  recommendation: string | null;
}

const LEVEL_MAP: Record<string, AnomalyLevel> = {
  low: "low",
  medium: "medium",
  high: "high",
  低: "low",
  中: "medium",
  中等: "medium",
  待核验: "medium",
  高: "high"
};

const normalizeLevel = (value: unknown): AnomalyLevel | null => {
  if (typeof value !== "string") return null;
  return LEVEL_MAP[value.trim().toLowerCase()] ?? null;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return value.trim() || null;
};

const normalizeAttachmentId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

const normalizeAnomaly = (item: unknown): NormalizedAnomaly | null => {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  const level = normalizeLevel(record.level);
  const reason = normalizeText(record.reason);
  if (!level || !reason) return null;
  return { attachment_id: normalizeAttachmentId(record.attachment_id), level, reason };
};

export const normalizeAnomalyResult = (raw: Record<string, unknown> | null): NormalizedAnomalyResult => ({
  risk_level: normalizeLevel(raw?.risk_level),
  summary: normalizeText(raw?.summary) ?? normalizeText(raw?.comment),
  anomalies: Array.isArray(raw?.anomalies)
    ? raw.anomalies
        .map(normalizeAnomaly)
        .filter((item): item is NormalizedAnomaly => item !== null)
    : [],
  recommendation: normalizeText(raw?.recommendation)
});
