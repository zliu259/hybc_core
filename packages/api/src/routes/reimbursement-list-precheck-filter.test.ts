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

class ListStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: ListDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("COUNT(*) as total")) {
      this.db.countSql = this.sql;
      return { total: 1 } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.listSql = this.sql;
    this.db.listParams = this.params;
    return {
      results: [
        {
          id: 501,
          envelope_no: "RB-501",
          project_id: 9,
          applicant_userid: "emp-1",
          channel: "physical",
          amount: 320,
          status: "received",
          precheck_status: "pending"
        } as T
      ]
    };
  }

  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class ListDb {
  listSql = "";
  countSql = "";
  listParams: unknown[] = [];

  prepare(sql: string) {
    return new ListStatement(this, sql);
  }
}

const createEnv = (db: ListDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: ListDb };

describe("reimbursement list precheck_status filter", () => {
  it("adds precheck_status IN filter to list and count SQL and returns rows", async () => {
    const db = new ListDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route("/reimbursement", reimbursementRoutes);

    const response = await app.request(
      "/reimbursement?status=received&precheck_status=none,pending,supplement&page=1&pageSize=20",
      { headers: { authorization: "Bearer test-token" } },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ id: number; precheck_status: string }>;
    };
    expect(payload.data[0].id).toBe(501);
    expect(payload.data[0].precheck_status).toBe("pending");
    expect(db.listSql).toContain("e.precheck_status IN (?, ?, ?)");
    expect(db.countSql).toContain("e.precheck_status IN (?, ?, ?)");
    expect(db.listParams).toContain("none");
    expect(db.listParams).toContain("pending");
    expect(db.listParams).toContain("supplement");
  });
});
