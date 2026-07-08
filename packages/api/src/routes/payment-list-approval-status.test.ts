import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

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
      return { total: 1 } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.listSql = this.sql;
    return {
      results: [
        {
          id: 108,
          serial_no: "PAY-108",
          status: "draft",
          approval_instance_id: 191,
          approval_status: "returned",
          amount: 500
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

describe("payment list approval_status", () => {
  it("left-joins approval_instance and returns approval_status per row", async () => {
    const db = new ListDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route("/payment", paymentRoutes);

    const response = await app.request(
      "/payment?page=1&pageSize=20",
      { headers: { authorization: "Bearer test-token" } },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ approval_status: string | null }>;
    };
    expect(payload.data[0].approval_status).toBe("returned");
    expect(db.listSql).toContain("LEFT JOIN approval_instance");
    expect(db.listSql).toContain("ai.status AS approval_status");
  });
});
