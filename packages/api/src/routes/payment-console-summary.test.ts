import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

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
    this.db.capturedSql = this.sql;
    if (this.sql.includes("pending_count")) {
      return this.db.summaryRow as T | null;
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
  capturedSql = "";
  summaryRow: Record<string, number | null> | null = {
    pending_count: 5,
    returned_count: 2,
    in_approval_count: 8,
    to_pay_count: 3,
    to_pay_total: 1280000,
    overdue_count: 3,
    paid_month_total: 860000
  };

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
  }) as unknown as Env & { DB: SummaryDb };

const requestSummary = (db: SummaryDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app.request(
    "/payment/console-summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

describe("payment console summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
  });

  it("returns aggregated stage counts and totals for finance role", async () => {
    const db = new SummaryDb();
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { to_pay_total: number; returned_count: number; overdue_count: number };
    };
    expect(payload.data.to_pay_total).toBe(1280000);
    expect(payload.data.returned_count).toBe(2);
    expect(payload.data.overdue_count).toBe(3);
    expect(db.capturedSql).toContain("IN ('returned', 'pending', 'withdrawn')");
    expect(db.capturedSql).toContain("!= 'cancelled'");
  });

  it("rejects operator role (global totals must not leak)", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };

    const response = await requestSummary(new SummaryDb());

    expect(response.status).toBe(403);
  });

  it("falls back to all-zero counters when the aggregate row is null", async () => {
    const db = new SummaryDb();
    db.summaryRow = null;

    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        pending_count: number;
        returned_count: number;
        in_approval_count: number;
        to_pay_count: number;
        to_pay_total: number;
        overdue_count: number;
        paid_month_total: number;
      };
    };
    expect(payload.data).toEqual({
      pending_count: 0,
      returned_count: 0,
      in_approval_count: 0,
      to_pay_count: 0,
      to_pay_total: 0,
      overdue_count: 0,
      paid_month_total: 0
    });
  });
});
