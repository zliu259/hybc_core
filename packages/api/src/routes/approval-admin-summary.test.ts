import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { approvalRoutes } from "./approval";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "mgr-a",
    username: "mgr-a",
    nickname: "Manager A",
    avatar: "",
    roles: ["manager"],
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
    if (this.sql.includes("in_progress")) {
      return this.db.row as T;
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
  row: unknown = { in_progress: 12, approved: 340, rejected: 18, total: 402 };

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
  app.route("/approval", approvalRoutes);
  return app.request(
    "/approval/admin/summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv(db)
  );
};

describe("approval admin summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
  });

  it("returns four counts for manager", async () => {
    const db = new SummaryDb();
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { in_progress: number; approved: number; rejected: number; total: number };
    };
    expect(payload.data).toEqual({
      in_progress: 12,
      approved: 340,
      rejected: 18,
      total: 402
    });
  });

  it("pins the aggregate SQL semantics", async () => {
    const db = new SummaryDb();
    await requestSummary(db);
    const sql = db.capturedSql.find(s => s.includes("in_progress")) ?? "";
    expect(sql).toContain("status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress");
    expect(sql).toContain("status = 'approved' THEN 1 ELSE 0 END) AS approved");
    expect(sql).toContain("status = 'rejected' THEN 1 ELSE 0 END) AS rejected");
    expect(sql).toContain("COUNT(*) AS total");
  });

  it("falls back to zero when the aggregate row is null", async () => {
    const db = new SummaryDb();
    db.row = null;
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, number> };
    expect(payload.data).toEqual({
      in_progress: 0,
      approved: 0,
      rejected: 0,
      total: 0
    });
  });

  it("falls back to zero per field when counts are null on an empty table", async () => {
    const db = new SummaryDb();
    db.row = { in_progress: null, approved: null, rejected: null, total: 0 };
    const response = await requestSummary(db);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, number> };
    expect(payload.data).toEqual({
      in_progress: 0,
      approved: 0,
      rejected: 0,
      total: 0
    });
  });

  it("rejects operator role", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };
    const response = await requestSummary(new SummaryDb());
    expect(response.status).toBe(403);
  });
});
