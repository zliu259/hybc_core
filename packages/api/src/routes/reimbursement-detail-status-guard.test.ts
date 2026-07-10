import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
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

type CapturedStatement = { sql: string; args: unknown[] };

class GuardStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: GuardDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM sqlite_master")) {
      return { name: "reimbursement_invoice_review" } as T;
    }
    if (this.sql.includes("MAX(review_round)")) {
      return { max_round: this.db.maxReviewRound } as T;
    }
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ?")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("FROM task_queue WHERE id = ?")) {
      return this.db.ocrTaskRow as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (
      this.sql.includes("FROM reimbursement_invoice_review") &&
      this.sql.includes("review_round = ?")
    ) {
      return { results: this.db.reviewRows as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class GuardDb {
  executed: CapturedStatement[] = [];
  maxReviewRound: number | null = 1;
  ocrTaskRow: unknown = null;
  envelopeRow: Record<string, unknown> = {};
  reviewRows: unknown[] = [];

  prepare(sql: string) {
    return new GuardStatement(this, sql);
  }
}

const buildEnvelope = (status: string): Record<string, unknown> => ({
  id: 123,
  envelope_no: "test-envelope",
  status,
  precheck_status: "approved",
  batch_id: 6,
  applicant_userid: "finance-a",
  channel: "electronic",
  amount: 100,
  ocr_task_id: null,
  ocr_status: "completed",
  ocr_result_json: null,
  silent_review_result: null,
  duplicate_check_status: "completed"
});

const completedReviewRow = {
  id: 1,
  attachment_id: 10,
  review_round: 1,
  task_id: 100,
  task_status: "completed",
  extraction_json: null,
  qr_text: null,
  qr_hash: null,
  invoice_unique_no: null,
  invoice_no: "12345678",
  invoice_date: "2026-06-01",
  invoice_amount: 100,
  source: "ocr_text",
  risk_level: "low",
  risk_hint: null
};

const createEnv = (db: GuardDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestDetail = (db: GuardDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/123",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

// 匹配裸 status 列赋值,排除 ocr_status / precheck_status / duplicate_check_status
const bareStatusAssignment = /(?<![A-Za-z_])status\s*=/;

const envelopeUpdates = (db: GuardDb) =>
  db.executed.filter((item) => item.sql.includes("UPDATE reimbursement_envelope"));

describe("reimbursement detail audit sync must not regress envelope status", () => {
  it.each(["batched", "pending_approval", "approved", "paid"])(
    "keeps %s status intact when invoice review rows are synced on detail view",
    async (status) => {
      const db = new GuardDb();
      db.envelopeRow = buildEnvelope(status);
      db.maxReviewRound = 1;
      db.reviewRows = [completedReviewRow];

      const response = await requestDetail(db);
      expect(response.status).toBe(200);

      const updates = envelopeUpdates(db);
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(update.sql).not.toMatch(bareStatusAssignment);
        expect(update.args).not.toContain("submitted");
      }
    }
  );

  it("keeps paid status intact on the legacy ocr-task fallback path", async () => {
    const db = new GuardDb();
    db.envelopeRow = {
      ...buildEnvelope("paid"),
      ocr_task_id: 5,
      ocr_status: "pending"
    };
    db.maxReviewRound = null;
    db.reviewRows = [];
    db.ocrTaskRow = { status: "completed", result_json: "{}" };

    const response = await requestDetail(db);
    expect(response.status).toBe(200);

    const updates = envelopeUpdates(db);
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.sql).not.toMatch(bareStatusAssignment);
      expect(update.args).not.toContain("submitted");
    }
  });
});
