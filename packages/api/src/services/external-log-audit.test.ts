import { describe, expect, it } from "vitest";

import { applyExternalLogAuditResult, type ExternalLogSubmissionRow } from "./external-log-audit";
import type { Env } from "../types/env";

type DbCall = {
  sql: string;
  params: unknown[];
};

const createEnv = (submission: ExternalLogSubmissionRow | null) => {
  const calls: DbCall[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        calls.push({ sql, params });
        return {
          first: async () => {
            if (sql.startsWith("SELECT * FROM external_log_submission")) {
              return submission;
            }
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] })
        };
      }
    })
  };

  return { env: { DB: db } as unknown as Env, calls };
};

const baseSubmission: ExternalLogSubmissionRow = {
  id: 12,
  project_id: 1,
  section_id: 2,
  submitter_name: "外包填报人",
  submitter_company: "外包队",
  submitter_phone: null,
  log_date: "2026-06-02",
  shift: "day",
  operator_log_payload_json: "{}",
  project_log_payload_json: "{}",
  photo_keys_json: null,
  review_status: "approved_manual",
  ai_review_task_id: 99,
  ai_review_result_json: null,
  ai_review_score: null,
  ai_review_risk_level: null,
  ai_review_summary: null,
  reviewed_by_userid: "manager-a",
  reviewed_at: "2026-06-02T01:00:00.000Z",
  review_comment: "人工已通过",
  adopted_operator_log_id: 8,
  adopted_manager_log_id: null,
  created_at: "2026-06-02T00:00:00.000Z",
  updated_at: "2026-06-02T01:00:00.000Z"
};

describe("applyExternalLogAuditResult", () => {
  it("records AI result without overwriting a manually reviewed submission", async () => {
    const { env, calls } = createEnv(baseSubmission);

    const review = await applyExternalLogAuditResult(env, 12, 99, {
      output: JSON.stringify({
        decision: "auto_approve",
        risk_level: "low",
        score: 96,
        summary: "未发现明显异常。",
        issues: []
      })
    });

    expect(review.decision).toBe("auto_approve");

    const updateCall = calls.find((call) =>
      call.sql.includes("UPDATE external_log_submission SET")
    );
    expect(updateCall?.sql).toContain("CASE");
    expect(updateCall?.sql).toContain("WHEN review_status = 'pending_ai_review'");
    expect(updateCall?.params[4]).toBe("ai_approved");
    expect(calls.some((call) => call.sql.includes("INSERT INTO operator_log"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("INSERT INTO manager_log"))).toBe(false);
  });
});
