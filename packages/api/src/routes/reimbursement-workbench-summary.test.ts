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

class SummaryStatement {
  constructor(
    private readonly db: SummaryDb,
    private readonly sql: string
  ) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.capturedSql.push(this.sql);
    if (this.sql.includes("to_receive")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("batches_to_submit")) {
      return this.db.batchRow as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class SummaryDb {
  capturedSql: string[] = [];
  envelopeRow: unknown = { to_receive: 3, to_precheck: 2, to_batch: 2 };
  batchRow: unknown = { batches_to_submit: 1, batches_to_pay: 1 };

  prepare(sql: string) {
    return new SummaryStatement(this, sql);
  }
}

const createEnv = (db: SummaryDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSummary = (db: SummaryDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/workbench-summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

describe("reimbursement workbench summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
  });

  it("returns five stage counts for finance role", async () => {
    const db = new SummaryDb();
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        to_receive: number;
        to_precheck: number;
        to_batch: number;
        batches_to_submit: number;
        batches_to_pay: number;
      };
    };
    expect(payload.data).toEqual({
      to_receive: 3,
      to_precheck: 2,
      to_batch: 2,
      batches_to_submit: 1,
      batches_to_pay: 1
    });
  });

  it("pins the precheck bucket SQL semantics", async () => {
    const db = new SummaryDb();
    await requestSummary(db);
    const envelopeSql = db.capturedSql.find(s => s.includes("to_receive")) ?? "";
    expect(envelopeSql).toContain("precheck_status IN ('none', 'pending', 'supplement')");
    expect(envelopeSql).toContain("batch_id IS NULL");
  });

  it("falls back to all-zero when aggregate rows are null", async () => {
    const db = new SummaryDb();
    db.envelopeRow = null;
    db.batchRow = null;
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, number> };
    expect(payload.data).toEqual({
      to_receive: 0,
      to_precheck: 0,
      to_batch: 0,
      batches_to_submit: 0,
      batches_to_pay: 0
    });
  });

  it("rejects operator role", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };
    const response = await requestSummary(new SummaryDb());
    expect(response.status).toBe(403);
  });
});
