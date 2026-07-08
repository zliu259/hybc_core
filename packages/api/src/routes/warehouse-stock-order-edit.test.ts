import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { warehouseRoutes } from "./warehouse";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "initiator-a",
    username: "initiator-a",
    nickname: "Initiator A",
    avatar: "",
    roles: ["site_manager"],
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

class StockOrderEditStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: StockOrderEditDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class StockOrderEditDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly options: {
      orderStatus?: string;
      approvalStatus?: string;
    } = {}
  ) {}

  prepare(sql: string) {
    return new StockOrderEditStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      return { status: this.options.approvalStatus ?? "returned" } as T;
    }
    if (sql.includes("FROM stock_order WHERE id = ?")) {
      return {
        id: 9,
        order_no: "SO-9",
        order_type: "outbound",
        project_id: null,
        from_warehouse_id: 1,
        to_warehouse_id: null,
        applicant_userid: "initiator-a",
        status: this.options.orderStatus ?? "draft",
        approval_instance_id: 19,
        rental_term_id: null,
        override_status: "none",
        override_reason: null,
        override_approver_userid: null,
        override_risk_acknowledged: 0,
        executed_at: null,
        remark: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z"
      } as T;
    }
    return null;
  }

  async all<T>(_sql: string, _params: unknown[]): Promise<{ results: T[] }> {
    void _sql;
    void _params;
    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/warehouse", warehouseRoutes);
  return app;
};

const createEnv = (db = new StockOrderEditDb()) =>
  ({
    DB: db,
    KV: { async get() { return "session"; } }
  }) as unknown as Env & { DB: StockOrderEditDb };

describe("stock order returned draft edit", () => {
  it("updates draft stock order header and replaces item lines", async () => {
    const env = createEnv();

    const response = await createApp().request(
      "/warehouse/stock-order/9",
      {
        method: "PUT",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({
          order_type: "transfer",
          from_warehouse_id: 1,
          to_warehouse_id: 2,
          items: [{ asset_type_id: 5, quantity: 3 }]
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE stock_order SET"))).toBe(true);
    expect(env.DB.runs.some((call) => call.sql.includes("DELETE FROM stock_order_item"))).toBe(true);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO stock_order_item"))).toBe(true);
  });

  it("allows editing a stale returned order whose status was never reverted to draft", async () => {
    const env = createEnv(
      new StockOrderEditDb({
        orderStatus: "pending_approval",
        approvalStatus: "returned"
      })
    );

    const response = await createApp().request(
      "/warehouse/stock-order/9",
      {
        method: "PUT",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ remark: "退回后修订" })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE stock_order SET"))).toBe(true);
  });

  it("still blocks edits while the approval is actively running", async () => {
    const env = createEnv(
      new StockOrderEditDb({
        orderStatus: "pending_approval",
        approvalStatus: "in_progress"
      })
    );

    const response = await createApp().request(
      "/warehouse/stock-order/9",
      {
        method: "PUT",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ remark: "试图审批中修改" })
      },
      env
    );

    expect(response.status).toBe(400);
  });
});
