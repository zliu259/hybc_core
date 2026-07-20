import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const writeAuditLogMock = vi.hoisted(() => vi.fn());
vi.mock("../services/audit-log", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/audit-log")>()),
  writeAuditLog: writeAuditLogMock
}));

type CapturedStatement = { sql: string; args: unknown[] };

class PrecheckStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: PrecheckDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (
      this.sql.includes("FROM reimbursement_envelope") &&
      this.sql.includes("WHERE id = ?")
    ) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("FROM reimbursement_duplicate_check")) {
      return {
        blocking_cnt: this.db.blockingCount,
        total_cnt: this.db.totalCount
      } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class PrecheckDb {
  executed: CapturedStatement[] = [];
  envelopeRow: Record<string, unknown> | null = null;
  blockingCount = 0;
  totalCount = 0;

  prepare(sql: string) {
    return new PrecheckStatement(this, sql);
  }
}

const buildEnvelope = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 188,
  status: "received",
  duplicate_check_status: "completed",
  duplicate_override_requested: 0,
  applicant_userid: "operator.a",
  channel: "electronic",
  ocr_result_json: null,
  ocr_invoice_unique_no_hint: null,
  ...overrides
});

const createEnv = (db: PrecheckDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestPrecheck = (db: PrecheckDb, body: Record<string, unknown>) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/188/precheck",
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

const precheckUpdates = (db: PrecheckDb) =>
  db.executed.filter(item => item.sql.includes("precheck_status = ?"));

describe("POST /reimbursement/:id/precheck duplicate-risk gate", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
    writeAuditLogMock.mockReset();
  });

  it("blocks finance without a reason and flags the override option", async () => {
    const db = new PrecheckDb();
    db.envelopeRow = buildEnvelope();
    db.blockingCount = 2;
    db.totalCount = 3;

    const response = await requestPrecheck(db, { action: "approved" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        duplicate_risk_unconfirmed: boolean;
        duplicate_count: number;
        duplicate_total: number;
        can_override_duplicate: boolean;
        duplicate_checks: unknown[];
      };
    };
    expect(payload.success).toBe(false);
    expect(payload.data.duplicate_risk_unconfirmed).toBe(true);
    expect(payload.data.duplicate_count).toBe(2);
    expect(payload.data.duplicate_total).toBe(3);
    expect(payload.data.can_override_duplicate).toBe(true);
    expect(Array.isArray(payload.data.duplicate_checks)).toBe(true);
    expect(precheckUpdates(db)).toHaveLength(0);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("blocks manager even with a reason", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
    const db = new PrecheckDb();
    db.envelopeRow = buildEnvelope();
    db.blockingCount = 1;
    db.totalCount = 1;

    const response = await requestPrecheck(db, {
      action: "approved",
      override_duplicate_reason: "想强行通过"
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      data: { can_override_duplicate: boolean };
    };
    expect(payload.data.can_override_duplicate).toBe(false);
    expect(precheckUpdates(db)).toHaveLength(0);
  });

  it("lets finance approve with a reason and writes the audit log", async () => {
    const db = new PrecheckDb();
    db.envelopeRow = buildEnvelope();
    db.blockingCount = 2;
    db.totalCount = 3;

    const response = await requestPrecheck(db, {
      action: "approved",
      override_duplicate_reason: " 已人工核对票据，非重复报销 "
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { precheck_status: string; status: string };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.precheck_status).toBe("approved");
    expect(payload.data.status).toBe("received");
    expect(precheckUpdates(db)).toHaveLength(1);
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    expect(writeAuditLogMock.mock.calls[0][1]).toMatchObject({
      action: "reimbursement.envelope.precheck_duplicate_override",
      targetId: 188,
      detail: {
        reason: "已人工核对票据，非重复报销",
        duplicate_count: 2,
        duplicate_total: 3
      }
    });
  });

  it("lets super_admin approve with a reason", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
    const db = new PrecheckDb();
    db.envelopeRow = buildEnvelope();
    db.blockingCount = 1;
    db.totalCount = 1;

    const response = await requestPrecheck(db, {
      action: "approved",
      override_duplicate_reason: "线下已与申请人确认"
    });
    expect(response.status).toBe(200);
    expect(precheckUpdates(db)).toHaveLength(1);
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
  });

  it("passes without a reason when the applicant already insist-submitted", async () => {
    const db = new PrecheckDb();
    db.envelopeRow = buildEnvelope({ duplicate_override_requested: 1 });
    db.blockingCount = 3;
    db.totalCount = 3;

    const response = await requestPrecheck(db, { action: "approved" });
    expect(response.status).toBe(200);
    expect(precheckUpdates(db)).toHaveLength(1);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });
});
