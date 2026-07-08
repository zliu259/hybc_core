import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { receiptRoutes } from "./receipt";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "initiator-a",
    username: "initiator-a",
    nickname: "Initiator A",
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

class InvoiceReturnedEditStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: InvoiceReturnedEditDb,
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
    return { results: [] as T[] };
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class InvoiceReturnedEditDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly options: {
      requestStatus?: string;
      approvalStatus?: string | null;
    } = {}
  ) {}

  prepare(sql: string) {
    return new InvoiceReturnedEditStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("FROM invoice_request WHERE id = ?")) {
      return {
        id: 55,
        request_no: "IR-55",
        project_id: 1,
        customer_name: "客户甲",
        customer_tax_no: "913100000000000000",
        buyer_json: null,
        invoice_type: "special",
        invoice_category: null,
        tax_rate: 0.09,
        currency: "CNY",
        items_json: null,
        amount_without_tax: 100,
        tax_amount_estimated: 9,
        amount_with_tax: 109,
        business_contract_no: null,
        payment_reference: null,
        status: this.options.requestStatus ?? "pending_approval",
        review_comment: null,
        attachments_json: null,
        remark: null,
        approval_instance_id: this.options.approvalStatus === null ? null : 77,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z"
      } as T;
    }
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      if (this.options.approvalStatus === null) return null;
      return { status: this.options.approvalStatus ?? "returned" } as T;
    }
    return null;
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/receipt", receiptRoutes);
  return app;
};

const createEnv = (db: InvoiceReturnedEditDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: InvoiceReturnedEditDb };

const putInvoiceRequest = (env: Env & { DB: InvoiceReturnedEditDb }) =>
  createApp().request(
    "/receipt/invoice-request/55",
    {
      method: "PUT",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ remark: "退回后修订" })
    },
    env
  );

describe("invoice request returned rework edits", () => {
  it("allows editing a stale returned request whose status was never reverted to draft", async () => {
    const env = createEnv(
      new InvoiceReturnedEditDb({
        requestStatus: "pending_approval",
        approvalStatus: "returned"
      })
    );

    const response = await putInvoiceRequest(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE invoice_request SET"))).toBe(true);
  });

  it("still blocks edits while the approval is actively running", async () => {
    const env = createEnv(
      new InvoiceReturnedEditDb({
        requestStatus: "pending_approval",
        approvalStatus: "in_progress"
      })
    );

    const response = await putInvoiceRequest(env);

    expect(response.status).toBe(400);
  });

  it("keeps draft and rejected requests editable without an approval instance", async () => {
    const env = createEnv(
      new InvoiceReturnedEditDb({
        requestStatus: "draft",
        approvalStatus: null
      })
    );

    const response = await putInvoiceRequest(env);

    expect(response.status).toBe(200);
  });
});
