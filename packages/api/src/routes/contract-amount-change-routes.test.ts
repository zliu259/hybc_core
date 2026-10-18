import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { contractRoutes } from "./contract";

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
    wecom_verified_at: "2026-10-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const contractRow = {
  id: 42,
  contract_no: "HT-20260901-001",
  direction: "outbound",
  project_id: 143,
  entity_id: 9,
  counterparty: "天津亿丰机械租赁站",
  contract_type: "机械",
  total_amount: 240000,
  paid_amount: 50000,
  received_amount: 0,
  status: "active"
};

const changeRow = {
  id: 7,
  contract_id: 42,
  change_type: "adjust",
  old_amount: 240000,
  new_amount: 260000,
  reason: "增加二期土方量，补充协议已签",
  status: "pending",
  approval_instance_id: 88,
  applicant_userid: "finance-a",
  attachments_json: JSON.stringify([
    { file_key: "contract/1-supplement.pdf", file_name: "补充协议.pdf", file_size: 2048 }
  ]),
  created_at: "2026-10-18T02:00:00.000Z",
  updated_at: "2026-10-18T02:00:00.000Z"
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeDb,
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
    return { results: [] };
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

/** Stand-in for the contract and contract_amount_change rows the handlers read and write. */
class FakeDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];
  contract: typeof contractRow | null = contractRow;
  change: typeof changeRow | null = changeRow;

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM contract_amount_change")) {
      return (this.change && params[0] === this.change.id ? this.change : null) as T | null;
    }
    if (sql.includes("FROM contract")) {
      return (this.contract && params[0] === this.contract.id ? this.contract : null) as T | null;
    }
    return null;
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: 7, changes: 1 } };
  }
}

const createEnv = (db = new FakeDb()) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: FakeDb };

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/contract", contractRoutes);
  return app;
};

const authHeaders = {
  authorization: "Bearer test-token",
  "content-type": "application/json"
};

const postAmountChange = (env: Env & { DB: FakeDb }, body: Record<string, unknown>) =>
  createApp().request(
    "/contract/42/amount-change",
    { method: "POST", headers: authHeaders, body: JSON.stringify(body) },
    env
  );

const getAmountChange = (env: Env & { DB: FakeDb }, changeId: string) =>
  createApp().request(`/contract/amount-change/${changeId}`, { headers: authHeaders }, env);

describe("POST /contract/:id/amount-change", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  it("stores the uploaded attachments with the change", async () => {
    const env = createEnv();
    const response = await postAmountChange(env, {
      change_type: "adjust",
      new_amount: 260000,
      reason: "增加二期土方量",
      attachments: [
        { file_key: "contract/1-supplement.pdf", file_name: "补充协议.pdf", file_size: 2048 }
      ]
    });

    expect(response.status).toBe(201);
    const insert = env.DB.runs.find((run) =>
      run.sql.includes("INSERT INTO contract_amount_change")
    );
    expect(insert?.sql).toContain("attachments_json");
    expect(insert?.params).toContain(
      JSON.stringify([
        { file_key: "contract/1-supplement.pdf", file_name: "补充协议.pdf", file_size: 2048 }
      ])
    );
  });

  it("rejects a blank reason without writing anything", async () => {
    const env = createEnv();
    const response = await postAmountChange(env, {
      change_type: "adjust",
      new_amount: 260000,
      reason: "   "
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe("请填写变更缘由");
    expect(env.DB.runs).toHaveLength(0);
  });
});

describe("GET /contract/amount-change/:changeId", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "manager-b", roles: ["manager"] };
  });

  it("returns the reason, attachments and contract summary an approver needs", async () => {
    const response = await getAmountChange(createEnv(), "7");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      id: 7,
      reason: "增加二期土方量，补充协议已签",
      old_amount: 240000,
      new_amount: 260000,
      applicant_userid: "finance-a",
      attachments: [
        {
          file_key: "contract/1-supplement.pdf",
          file_name: "补充协议.pdf",
          file_size: 2048,
          file_url: "/api/v1/upload/object/contract%2F1-supplement.pdf"
        }
      ],
      contract: {
        id: 42,
        contract_no: "HT-20260901-001",
        counterparty: "天津亿丰机械租赁站",
        total_amount: 240000,
        paid_amount: 50000
      }
    });
    expect(payload.data).not.toHaveProperty("attachments_json");
  });

  it("returns 404 for an unknown change", async () => {
    const response = await getAmountChange(createEnv(), "999");
    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const response = await getAmountChange(createEnv(), "abc");
    expect(response.status).toBe(400);
  });
});
