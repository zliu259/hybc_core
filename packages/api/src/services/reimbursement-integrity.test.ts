import { describe, expect, it } from "vitest";

import {
  findReimbursementIntegrityIssues,
  summarizeIntegrityIssues,
  type IntegrityIssue
} from "./reimbursement-integrity";

type FakeRow = { id: number };

/**
 * Minimal fake D1 for findReimbursementIntegrityIssues.
 *
 * Each of the five integrity queries carries a unique `-- kind: <kind>`
 * marker comment (see reimbursement-integrity.ts). The fake routes on that
 * marker and returns canned rows instead of re-implementing the real SQL —
 * this test asserts the service's row -> IntegrityIssue assembly (kind,
 * severity, id truncation, real total count), not SQL correctness itself.
 */
const createFakeDb = (rowsByKind: Partial<Record<string, FakeRow[]>>): D1Database => {
  const pick = (sql: string): FakeRow[] => {
    const match = sql.match(/-- kind: (\w+)/);
    if (!match) {
      throw new Error(`Test fake cannot route unmarked SQL: ${sql}`);
    }
    return rowsByKind[match[1]] ?? [];
  };

  return {
    prepare(sql: string) {
      const results = pick(sql);
      return {
        bind() {
          return { all: async () => ({ results }) };
        },
        all: async () => ({ results })
      };
    }
  } as unknown as D1Database;
};

describe("summarizeIntegrityIssues", () => {
  it("returns a zeroed summary for an empty issue list", () => {
    expect(summarizeIntegrityIssues([])).toEqual({ total: 0, bySeverity: {} });
  });

  it("groups counts by severity and sums the total", () => {
    const issues: IntegrityIssue[] = [
      { kind: "batch_totals_mismatch", severity: "high", count: 3, ids: [1, 2, 3] },
      { kind: "envelope_no_uuid_mismatch", severity: "high", count: 2, ids: [4, 5] },
      { kind: "envelope_batch_missing", severity: "medium", count: 1, ids: [6] }
    ];

    expect(summarizeIntegrityIssues(issues)).toEqual({
      total: 6,
      bySeverity: { high: 5, medium: 1 }
    });
  });

  it("does not mutate the input array", () => {
    const issues: IntegrityIssue[] = [
      { kind: "orphan_split_child", severity: "medium", count: 1, ids: [9] }
    ];
    const snapshot = JSON.parse(JSON.stringify(issues));

    summarizeIntegrityIssues(issues);

    expect(issues).toEqual(snapshot);
  });
});

describe("findReimbursementIntegrityIssues", () => {
  it("returns an empty array when nothing is inconsistent", async () => {
    const db = createFakeDb({});

    const issues = await findReimbursementIntegrityIssues(db);

    expect(issues).toEqual([]);
  });

  it("reports one entry per problem kind with correct kind/severity/ids", async () => {
    const db = createFakeDb({
      batch_totals_mismatch: [{ id: 101 }],
      envelope_no_uuid_mismatch: [{ id: 202 }],
      envelope_batched_without_batch: [{ id: 303 }],
      envelope_batch_missing: [{ id: 404 }],
      orphan_split_child: [{ id: 505 }]
    });

    const issues = await findReimbursementIntegrityIssues(db);

    expect(issues).toHaveLength(5);
    expect(issues).toContainEqual({
      kind: "batch_totals_mismatch",
      severity: "high",
      count: 1,
      ids: [101]
    });
    expect(issues).toContainEqual({
      kind: "envelope_no_uuid_mismatch",
      severity: "high",
      count: 1,
      ids: [202]
    });
    expect(issues).toContainEqual({
      kind: "envelope_batched_without_batch",
      severity: "medium",
      count: 1,
      ids: [303]
    });
    expect(issues).toContainEqual({
      kind: "envelope_batch_missing",
      severity: "medium",
      count: 1,
      ids: [404]
    });
    expect(issues).toContainEqual({
      kind: "orphan_split_child",
      severity: "medium",
      count: 1,
      ids: [505]
    });
  });

  it("omits kinds with zero matching rows instead of returning a zero-count entry", async () => {
    const db = createFakeDb({
      envelope_no_uuid_mismatch: [{ id: 7 }]
    });

    const issues = await findReimbursementIntegrityIssues(db);

    expect(issues).toEqual([
      { kind: "envelope_no_uuid_mismatch", severity: "high", count: 1, ids: [7] }
    ]);
  });

  it("truncates ids to 50 per kind but keeps the real total count", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
    const db = createFakeDb({ envelope_no_uuid_mismatch: many });

    const issues = await findReimbursementIntegrityIssues(db);

    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(120);
    expect(issues[0].ids).toHaveLength(50);
    expect(issues[0].ids).toEqual(many.slice(0, 50).map((r) => r.id));
  });
});
