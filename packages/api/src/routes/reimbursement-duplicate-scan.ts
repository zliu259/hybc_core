// 查重口径的单一来源：
// - 拦截口径(blocking)仅统计 high/medium 行，low 只提示不进闸门；
// - 模糊命中的风险级按双方费用日期完备性分类；
// - 摘要列表刻意不带 evidence_json（内含对方原始票据证据，员工侧无需）。

export const BLOCKING_RISK_LEVELS = ["high", "medium"] as const;

export const isBlockingRiskLevel = (level: string): boolean =>
  (BLOCKING_RISK_LEVELS as readonly string[]).includes(level);

export interface DuplicateScanResult {
  total: number;
  blocking: number;
}

export interface FuzzyClassification {
  risk_level: "medium" | "low";
  match_score: number;
  summary: string;
}

export const classifyFuzzyDuplicate = (
  selfExpenseDate: string | null,
  matchedExpenseDate: string | null
): FuzzyClassification => {
  const hasBothDates =
    Boolean(selfExpenseDate?.trim()) && Boolean(matchedExpenseDate?.trim());
  if (hasBothDates) {
    return {
      risk_level: "medium",
      match_score: 0.6,
      summary: "同一申请人金额接近且费用日期相近，疑似重复报销"
    };
  }
  return {
    risk_level: "low",
    match_score: 0.4,
    summary: "同一申请人金额接近，但票据缺少费用日期，无法进一步比对，仅供办公室参考"
  };
};

export interface DuplicateCheckSummaryItem {
  id: number;
  match_type: string;
  risk_level: string;
  summary: string | null;
  matched_envelope_id: number | null;
  matched_envelope_no: string | null;
  matched_invoice_no: string | null;
  matched_amount: number | null;
  matched_expense_date: string | null;
}

export const listDuplicateCheckSummaries = async (
  db: D1Database,
  envelopeId: number,
  limit = 5
): Promise<DuplicateCheckSummaryItem[]> => {
  const rows = await db
    .prepare(
      `SELECT d.id, d.match_type, d.risk_level, d.summary, d.matched_envelope_id, d.matched_invoice_no,
              m.envelope_no AS matched_envelope_no, m.amount AS matched_amount, m.expense_date AS matched_expense_date
         FROM reimbursement_duplicate_check d
         LEFT JOIN reimbursement_envelope m ON m.id = d.matched_envelope_id
        WHERE d.envelope_id = ?
        ORDER BY CASE d.risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, d.id DESC
        LIMIT ?`
    )
    .bind(envelopeId, limit)
    .all<DuplicateCheckSummaryItem>();
  return rows.results ?? [];
};
