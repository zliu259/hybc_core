import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { contractRoutes } from "./contract";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "handler-a",
    username: "handler-a",
    nickname: "Handler A",
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

class ContractReturnedEditStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: ContractReturnedEditDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class ContractReturnedEditDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly options: {
      handlerUserid?: string;
      approvalInitiatorUserid?: string;
    } = {}
  ) {}

  prepare(sql: string) {
    return new ContractReturnedEditStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("SELECT * FROM contract WHERE id = ?")) {
      return {
        id: 629,
        contract_no: "CT-629",
        direction: "outbound",
        project_id: 1,
        entity_id: 1,
        counterparty: "Original Counterparty",
        contract_type: "purchase",
        handler_userid: this.options.handlerUserid ?? "handler-a",
        contract_date: "2026-07-01",
        total_amount: 1000,
        paid_amount: 0,
        invoiced_amount: 0,
        received_amount: 0,
        status: "draft",
        ai_review_status: "none",
        ai_review_result: null,
        approval_instance_id: 88,
        attachments_json: null,
        remark: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z"
      } as T;
    }
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      return {
        status: "returned",
        initiator_userid: this.options.approvalInitiatorUserid ?? "handler-a"
      } as T;
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
  app.route("/contract", contractRoutes);
  return app;
};

const createEnv = (db = new ContractReturnedEditDb()) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: ContractReturnedEditDb };

const putReturnedContract = (env: Env & { DB: ContractReturnedEditDb }) =>
  createApp().request(
    "/contract/629",
    {
      method: "PUT",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({
        counterparty: "Updated Counterparty",
        remark: "补充退回材料"
      })
    },
    env
  );

describe("contract returned draft edit", () => {
  beforeEach(() => {
    mockAuthState.payload = {
      ...mockAuthState.payload,
      sub: "handler-a",
      roles: ["manager"]
    };
  });

  it("allows the handler to edit a draft contract returned to initiator", async () => {
    const env = createEnv();

    const response = await putReturnedContract(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE contract SET"))).toBe(true);
  });

  it("does not force privileged edit mode when the handler also has super admin role", async () => {
    mockAuthState.payload = {
      ...mockAuthState.payload,
      roles: ["super_admin"]
    };
    const env = createEnv();

    const response = await putReturnedContract(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });

  it("does not force privileged edit mode when the approval initiator is not the contract handler", async () => {
    mockAuthState.payload = {
      ...mockAuthState.payload,
      sub: "initiator-a",
      roles: ["super_admin"]
    };
    const env = createEnv(
      new ContractReturnedEditDb({
        handlerUserid: "handler-b",
        approvalInitiatorUserid: "initiator-a"
      })
    );

    const response = await putReturnedContract(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });
});
