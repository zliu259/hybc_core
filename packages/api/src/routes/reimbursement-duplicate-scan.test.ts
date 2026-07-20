import { describe, expect, it } from "vitest";

import {
  classifyFuzzyDuplicate,
  isBlockingRiskLevel,
  listDuplicateCheckSummaries,
  type DuplicateCheckSummaryItem
} from "./reimbursement-duplicate-scan";

describe("classifyFuzzyDuplicate", () => {
  it("classifies as medium when both expense dates are present", () => {
    expect(classifyFuzzyDuplicate("2026-07-10", "2026-07-12")).toEqual({
      risk_level: "medium",
      match_score: 0.6,
      summary: "同一申请人金额接近且费用日期相近，疑似重复报销"
    });
  });

  it("classifies as low when self expense date is missing", () => {
    expect(classifyFuzzyDuplicate(null, "2026-07-12")).toEqual({
      risk_level: "low",
      match_score: 0.4,
      summary: "同一申请人金额接近，但票据缺少费用日期，无法进一步比对，仅供办公室参考"
    });
  });

  it("classifies as low when matched expense date is missing", () => {
    expect(classifyFuzzyDuplicate("2026-07-10", null).risk_level).toBe("low");
  });

  it("classifies as low when both expense dates are missing", () => {
    expect(classifyFuzzyDuplicate(null, null).risk_level).toBe("low");
  });

  it("treats blank strings the same as missing dates", () => {
    expect(classifyFuzzyDuplicate("   ", "2026-07-12").risk_level).toBe("low");
    expect(classifyFuzzyDuplicate("2026-07-10", "").risk_level).toBe("low");
  });
});

describe("isBlockingRiskLevel", () => {
  it("marks high and medium as blocking", () => {
    expect(isBlockingRiskLevel("high")).toBe(true);
    expect(isBlockingRiskLevel("medium")).toBe(true);
  });

  it("does not block low, unknown or empty levels", () => {
    expect(isBlockingRiskLevel("low")).toBe(false);
    expect(isBlockingRiskLevel("unknown")).toBe(false);
    expect(isBlockingRiskLevel("")).toBe(false);
  });
});

type CapturedQuery = { sql: string; args: unknown[] };

const createSummaryDb = (rows: DuplicateCheckSummaryItem[]) => {
  const captured: CapturedQuery[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          captured.push({ sql, args });
          const limit = Number(args[1]);
          return {
            async all<T>(): Promise<{ results: T[] }> {
              return { results: rows.slice(0, limit) as T[] };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
  return { db, captured };
};

const buildSummaryRow = (
  overrides: Partial<DuplicateCheckSummaryItem> = {}
): DuplicateCheckSummaryItem => ({
  id: 1,
  match_type: "fuzzy",
  risk_level: "medium",
  summary: "同一申请人金额接近且费用日期相近，疑似重复报销",
  matched_envelope_id: 202,
  matched_envelope_no: "BX-20260710-001",
  matched_invoice_no: "INV-B",
  matched_amount: 100.5,
  matched_expense_date: "2026-07-12",
  ...overrides
});

describe("listDuplicateCheckSummaries", () => {
  it("orders by risk level descending then id descending and binds the limit", async () => {
    const { db, captured } = createSummaryDb([buildSummaryRow()]);

    const items = await listDuplicateCheckSummaries(db, 188, 5);
    expect(items).toHaveLength(1);
    expect(items[0].risk_level).toBe("medium");

    expect(captured).toHaveLength(1);
    const { sql, args } = captured[0];
    expect(sql).toContain(
      "ORDER BY CASE d.risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, d.id DESC"
    );
    expect(sql).toContain("LEFT JOIN reimbursement_envelope m ON m.id = d.matched_envelope_id");
    expect(sql).not.toContain("evidence_json");
    expect(args).toEqual([188, 5]);
  });

  it("caps the result at the default limit of 5", async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      buildSummaryRow({ id: index + 1 })
    );
    const { db, captured } = createSummaryDb(rows);

    const items = await listDuplicateCheckSummaries(db, 188);
    expect(items).toHaveLength(5);
    expect(captured[0].args).toEqual([188, 5]);
  });
});
