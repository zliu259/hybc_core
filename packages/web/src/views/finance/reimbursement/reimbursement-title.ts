// 规则与 packages/api/src/routes/reimbursement-batch-title-policy.ts 的 summarizeBatchTitles 逐字同步：
// 改一处必须改另一处（web 用同一算法做成批前的预判/提示，api 是最终裁决）。
export type TitleFields = {
  invoice_title_entity_id?: number | null;
  invoice_title_name?: string | null;
};

export type TitleSummaryKind = "uniform" | "mixed" | "unknown" | "empty";

export type TitleCount = {
  entity_id: number | null;
  name: string | null;
  count: number;
};

export type TitleSummary = {
  kind: TitleSummaryKind;
  entityId: number | null;
  counts: TitleCount[];
};

/**
 * 汇总一组信封的抬头：empty / uniform（全部同一主体）/ unknown（全部未识别，不算混合）/
 * mixed（其余，含已识别+未识别）。counts 按数量降序；未识别桶的 name 取第一条有原文的。
 */
export const summarizeTitles = (rows: TitleFields[]): TitleSummary => {
  if (rows.length === 0) return { kind: "empty", entityId: null, counts: [] };

  const buckets = rows.reduce<Map<string, TitleCount>>((map, row) => {
    const entityId = row.invoice_title_entity_id ?? null;
    const key = entityId === null ? "none" : String(entityId);
    const existing = map.get(key);
    const next: TitleCount = existing
      ? {
          ...existing,
          count: existing.count + 1,
          name: existing.name ?? row.invoice_title_name ?? null
        }
      : { entity_id: entityId, name: row.invoice_title_name ?? null, count: 1 };
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

export type TitleDisplay = {
  text: string;
  tag: "matched" | "unmatched" | "unknown";
};

export const invoiceTitleDisplay = (
  row: TitleFields,
  entityName?: string | null
): TitleDisplay => {
  if (row.invoice_title_entity_id) {
    return {
      text:
        entityName ||
        row.invoice_title_name ||
        `主体#${row.invoice_title_entity_id}`,
      tag: "matched"
    };
  }
  if (row.invoice_title_name) {
    return { text: row.invoice_title_name, tag: "unmatched" };
  }
  return { text: "未识别", tag: "unknown" };
};

export const describeTitleCounts = (
  counts: TitleCount[],
  entityName: (id: number) => string | undefined
): string =>
  counts
    .map(item => {
      if (item.entity_id) {
        return `${entityName(item.entity_id) || item.name || `主体#${item.entity_id}`} × ${item.count}`;
      }
      if (item.name) return `${item.name}（未匹配）× ${item.count}`;
      return `未识别 × ${item.count}`;
    })
    .join("；");

/** 全部未识别但原文（去空白后）不止一种时返回这些原文，供页面给出非阻断提示；否则空数组 */
export const distinctUnknownTitleNames = (rows: TitleFields[]): string[] => {
  if (rows.some(row => row.invoice_title_entity_id)) return [];
  const names = rows
    .map(row => (row.invoice_title_name ?? "").replace(/\s+/g, ""))
    .filter(name => name.length > 0);
  const distinct = [...new Set(names)];
  return distinct.length > 1 ? distinct : [];
};
