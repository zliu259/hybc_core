// lib/segments.ts — 条款正文渲染分段：关键字（占位符）与风险片段双色高亮的纯函数。
import type { RiskAnnotation } from "@/api/contract-draft";

export interface RenderSegment {
  text: string;
  kind: "plain" | "keyword" | "risk-red" | "risk-yellow";
  key?: string;
  reason?: string;
  legalBasis?: string;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export function fillPlaceholders(
  text: string,
  values: Record<string, string>
): string {
  return text.replace(PLACEHOLDER_RE, (raw, key: string) => {
    const v = values[key];
    return v && v.length > 0 ? v : raw;
  });
}

function splitByPlaceholders(
  text: string,
  values: Record<string, string>
): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const idx = m.index ?? 0;
    if (idx > last)
      segments.push({ text: text.slice(last, idx), kind: "plain" });
    const key = m[1];
    const value = values[key];
    segments.push({
      text: value && value.length > 0 ? value : m[0],
      kind: "keyword",
      key
    });
    last = idx + m[0].length;
  }
  if (last < text.length)
    segments.push({ text: text.slice(last), kind: "plain" });
  return segments;
}

/** 先按风险片段（首次出现、互不重叠）切分，再对非风险部分做占位符切分。 */
export function buildRenderSegments(
  content: string,
  risks: RiskAnnotation[],
  values: Record<string, string>
): RenderSegment[] {
  const hits: Array<{ start: number; end: number; risk: RiskAnnotation }> = [];
  for (const r of risks) {
    if (!r.text) continue;
    const start = content.indexOf(r.text);
    if (start < 0) continue;
    const end = start + r.text.length;
    if (hits.some(h => start < h.end && end > h.start)) continue;
    hits.push({ start, end, risk: r });
  }
  hits.sort((a, b) => a.start - b.start);

  const segments: RenderSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor)
      segments.push(
        ...splitByPlaceholders(content.slice(cursor, h.start), values)
      );
    segments.push({
      text: h.risk.text,
      kind: h.risk.level === "red" ? "risk-red" : "risk-yellow",
      reason: h.risk.reason,
      legalBasis: h.risk.legal_basis
    });
    cursor = h.end;
  }
  if (cursor < content.length)
    segments.push(...splitByPlaceholders(content.slice(cursor), values));
  return segments;
}

export function parseRiskAnnotations(json: string | null): RiskAnnotation[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is RiskAnnotation =>
            !!r &&
            typeof r === "object" &&
            typeof (r as RiskAnnotation).text === "string"
        )
      : [];
  } catch {
    return [];
  }
}
