import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "operator.a",
    username: "operator.a",
    nickname: "Operator A",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const createTaskMock = vi.hoisted(() => vi.fn());
vi.mock("../services/ai-slot", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/ai-slot")>()),
  createTask: createTaskMock
}));

const publishEventMock = vi.hoisted(() => vi.fn());
vi.mock("../services/event-bus", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/event-bus")>()),
  publishEvent: publishEventMock
}));

type CapturedStatement = { sql: string; args: unknown[] };

type FuzzyCandidate = {
  applicant_userid: string;
  id: number;
  project_id: number;
  invoice_no: string | null;
  amount: number;
  expense_date: string | null;
};

type StoredDuplicateRow = {
  id: number;
  match_type: string;
  match_score: number | null;
  risk_level: string;
  summary: string | null;
  matched_envelope_id: number | null;
  matched_invoice_no: string | null;
};

const riskRank = (level: string) =>
  level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;

class SubmitStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: SubmitDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ?")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("SELECT file_key FROM envelope_attachment")) {
      return { file_key: "files/inv-current.pdf" } as T;
    }
    if (this.sql.includes("sqlite_master")) {
      return null;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.queried.push({ sql: this.sql, args: this.args });
    if (this.sql.includes("ABS(amount - ?)")) {
      const boundApplicant = this.args[1];
      const rows = this.db.fuzzyCandidates
        .filter(candidate => candidate.applicant_userid === boundApplicant)
        .map(candidate => ({
          id: candidate.id,
          project_id: candidate.project_id,
          invoice_no: candidate.invoice_no,
          amount: candidate.amount,
          expense_date: candidate.expense_date
        }));
      return { results: rows as T[] };
    }
    if (this.sql.includes("LEFT JOIN reimbursement_envelope m")) {
      const limit = Number(this.args[1]);
      const rows = [...this.db.duplicateRows]
        .sort((a, b) => riskRank(b.risk_level) - riskRank(a.risk_level) || b.id - a.id)
        .slice(0, limit)
        .map(row => ({
          id: row.id,
          match_type: row.match_type,
          risk_level: row.risk_level,
          summary: row.summary,
          matched_envelope_id: row.matched_envelope_id,
          matched_invoice_no: row.matched_invoice_no,
          matched_envelope_no: row.matched_envelope_id ? `BX-NO-${row.matched_envelope_id}` : null,
          matched_amount: null,
          matched_expense_date: null
        }));
      return { results: rows as T[] };
    }
    if (
      this.sql.includes("FROM reimbursement_duplicate_check") &&
      this.sql.includes("ORDER BY id DESC")
    ) {
      return { results: [...this.db.duplicateRows] as unknown as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    if (this.sql.includes("DELETE FROM reimbursement_duplicate_check")) {
      this.db.duplicateRows = [];
    }
    if (this.sql.includes("INSERT INTO reimbursement_duplicate_check")) {
      this.db.duplicateRows = [
        ...this.db.duplicateRows,
        this.parseDuplicateInsert()
      ];
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }

  private parseDuplicateInsert(): StoredDuplicateRow {
    const id = ++this.db.duplicateRowSeq;
    if (this.sql.includes("'fuzzy'")) {
      return {
        id,
        match_type: "fuzzy",
        matched_envelope_id: this.args[1] as number,
        matched_invoice_no: this.args[2] as string | null,
        match_score: this.args[3] as number,
        risk_level: this.args[4] as string,
        summary: this.args[5] as string
      };
    }
    if (this.sql.includes("'attachment_file_key'")) {
      return {
        id,
        match_type: "attachment_file_key",
        matched_envelope_id: this.args[1] as number,
        matched_invoice_no: null,
        match_score: this.args[2] as number,
        risk_level: "high",
        summary: this.args[3] as string
      };
    }
    return {
      id,
      match_type: this.args[3] as string,
      matched_envelope_id: this.args[1] as number,
      matched_invoice_no: this.args[2] as string | null,
      match_score: this.args[4] as number,
      risk_level: "high",
      summary: this.args[5] as string
    };
  }
}

class SubmitDb {
  executed: CapturedStatement[] = [];
  queried: CapturedStatement[] = [];
  envelopeRow: Record<string, unknown> | null = null;
  fuzzyCandidates: FuzzyCandidate[] = [];
  duplicateRows: StoredDuplicateRow[] = [];
  duplicateRowSeq = 0;

  prepare(sql: string) {
    return new SubmitStatement(this, sql);
  }
}

const buildEnvelope = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 188,
  envelope_no: "BX-20260710-188",
  envelope_uuid: null,
  project_id: 7,
  applicant_userid: "operator.a",
  channel: "electronic",
  status: "draft",
  precheck_status: "none",
  invoice_unique_no: null,
  invoice_no: "INV-A",
  expense_date: "2026-07-10",
  amount: 100,
  category: null,
  description: null,
  batch_id: null,
  ocr_task_id: null,
  duplicate_override_requested: 0,
  ...overrides
});

const createEnv = (db: SubmitDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSubmit = (db: SubmitDb, body: Record<string, unknown> = {}) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/188/submit",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

const fuzzyInserts = (db: SubmitDb) =>
  db.executed.filter(
    item =>
      item.sql.includes("INSERT INTO reimbursement_duplicate_check") &&
      item.sql.includes("'fuzzy'")
  );

const sameWeekCandidate = (
  overrides: Partial<FuzzyCandidate> = {}
): FuzzyCandidate => ({
  applicant_userid: "operator.a",
  id: 202,
  project_id: 7,
  invoice_no: "INV-B",
  amount: 100.5,
  expense_date: "2026-07-12",
  ...overrides
});

describe("POST /reimbursement/:id/submit duplicate response contract", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"], sub: "operator.a" };
    createTaskMock.mockReset();
    publishEventMock.mockReset();
  });

  it("returns 409 with force-submit contract when the same applicant has a near-duplicate", async () => {
    const db = new SubmitDb();
    db.envelopeRow = buildEnvelope();
    db.fuzzyCandidates = [sameWeekCandidate()];

    const response = await requestSubmit(db);
    expect(response.status).toBe(409);
    const payload = (await response.json()) as {
      success: boolean;
      error: { message: string };
      data: {
        duplicate_count: number;
        duplicate_total: number;
        require_force_submit: boolean;
        duplicate_checks: Array<{ risk_level: string; summary: string | null }>;
      };
    };
    expect(payload.success).toBe(false);
    expect(payload.error.message).toBe("存在疑似重复报销记录，请确认后决定是否坚持提交");
    expect(payload.data.require_force_submit).toBe(true);
    expect(payload.data.duplicate_count).toBeGreaterThanOrEqual(1);
    expect(payload.data.duplicate_total).toBeGreaterThanOrEqual(payload.data.duplicate_count);
    expect(payload.data.duplicate_checks.length).toBeGreaterThanOrEqual(1);
    expect(payload.data.duplicate_checks.length).toBeLessThanOrEqual(5);
    for (const item of payload.data.duplicate_checks) {
      expect(item.risk_level).toBe("medium");
      expect(item.summary).toBe("同一申请人金额接近且费用日期相近，疑似重复报销");
    }
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("no longer flags same-amount same-week envelopes from a different employee", async () => {
    const db = new SubmitDb();
    db.envelopeRow = buildEnvelope();
    db.fuzzyCandidates = [sameWeekCandidate({ applicant_userid: "operator.b" })];

    const response = await requestSubmit(db);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { status: string };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe("submitted");

    const fuzzySelects = db.queried.filter(item => item.sql.includes("ABS(amount - ?)"));
    expect(fuzzySelects.length).toBeGreaterThanOrEqual(1);
    for (const query of fuzzySelects) {
      expect(query.sql).toContain("applicant_userid = ?");
      expect(query.sql).toContain("status NOT IN ('deleted', 'cancelled')");
      expect(query.args[1]).toBe("operator.a");
    }
    expect(fuzzyInserts(db)).toHaveLength(0);
  });

  it("records but does not block a low-risk hit when the matched invoice lacks an expense date", async () => {
    const db = new SubmitDb();
    db.envelopeRow = buildEnvelope();
    db.fuzzyCandidates = [sameWeekCandidate({ expense_date: null })];

    const response = await requestSubmit(db);
    expect(response.status).toBe(200);

    // 提交闸门 + AI 审计入队各重扫一轮，断言最后一轮落库的仍是 low 提示行
    const inserts = fuzzyInserts(db);
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const lastInsert = inserts[inserts.length - 1];
    expect(lastInsert.args[4]).toBe("low");
    expect(db.duplicateRows).toHaveLength(1);
    expect(db.duplicateRows[0].risk_level).toBe("low");
  });

  it("accepts force_submit and persists the insist-submit flag with the reason", async () => {
    const db = new SubmitDb();
    db.envelopeRow = buildEnvelope();
    db.fuzzyCandidates = [sameWeekCandidate()];

    const response = await requestSubmit(db, {
      force_submit: true,
      force_submit_reason: "申请人确认非重复，坚持提交"
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { status: string };
    };
    expect(payload.data.status).toBe("submitted");

    const submitUpdates = db.executed.filter(item =>
      item.sql.includes("duplicate_override_requested = ?")
    );
    expect(submitUpdates).toHaveLength(1);
    expect(submitUpdates[0].args[0]).toBe(1);
    expect(submitUpdates[0].args[1]).toBe("申请人确认非重复，坚持提交");
  });
});
