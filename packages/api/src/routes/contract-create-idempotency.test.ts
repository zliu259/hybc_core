import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type IdempotencyRow = {
  status: string;
  response_json: string | null;
  status_code: number | null;
};

class ContractCreateStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: ContractCreateDb,
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

/**
 * In-memory stand-in for the two tables the create handler touches:
 * api_idempotency_request (with its composite primary key) and contract.
 */
class ContractCreateDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];
  readonly idempotency = new Map<string, IdempotencyRow>();
  contractInserts = 0;
  failContractInsert = false;

  prepare(sql: string) {
    return new ContractCreateStatement(this, sql);
  }

  private idempotencyId(params: unknown[]) {
    const [scope, actor, key] = params as string[];
    return `${scope}|${actor}|${key}`;
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT COUNT(*) as cnt FROM contract")) {
      return { cnt: this.contractInserts } as T;
    }
    if (sql.includes("FROM api_idempotency_request")) {
      return (this.idempotency.get(this.idempotencyId(params)) ?? null) as T | null;
    }
    return null;
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    if (sql.includes("INSERT INTO api_idempotency_request")) {
      const id = this.idempotencyId(params);
      if (this.idempotency.has(id)) {
        throw new Error("UNIQUE constraint failed: api_idempotency_request.scope");
      }
      this.idempotency.set(id, { status: "pending", response_json: null, status_code: null });
      return { meta: { last_row_id: 0, changes: 1 } };
    }
    if (sql.includes("UPDATE api_idempotency_request")) {
      const [responseJson, statusCode, , scope, actor, key] = params as [
        string,
        number,
        string,
        string,
        string,
        string
      ];
      const id = `${scope}|${actor}|${key}`;
      const changes = this.idempotency.has(id) ? 1 : 0;
      if (changes) {
        this.idempotency.set(id, {
          status: "completed",
          response_json: responseJson,
          status_code: statusCode
        });
      }
      return { meta: { last_row_id: 0, changes } };
    }
    if (sql.includes("DELETE FROM api_idempotency_request")) {
      this.idempotency.delete(this.idempotencyId(params));
      return { meta: { last_row_id: 0, changes: 1 } };
    }
    if (sql.includes("INSERT INTO contract")) {
      if (this.failContractInsert) {
        throw new Error("D1_ERROR: insert failed");
      }
      this.contractInserts += 1;
      return { meta: { last_row_id: 700 + this.contractInserts, changes: 1 } };
    }
    return { meta: { last_row_id: 0, changes: 1 } };
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/contract", contractRoutes);
  return app;
};

const createEnv = (db = new ContractCreateDb()) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    },
    EVENT_QUEUE: {
      async send() {
        return undefined;
      }
    }
  }) as unknown as Env & { DB: ContractCreateDb };

const baseBody = {
  direction: "outbound",
  project_id: 143,
  entity_id: 9,
  counterparty: "天津市西青区亿丰广源机械设备租赁站(个体工商户)",
  contract_type: "机械",
  handler_userid: "handler-a",
  contract_date: "2026-09-28",
  total_amount: 240000,
  remark: "公司代个人付款"
};

const postContract = (
  env: Env & { DB: ContractCreateDb },
  body: Record<string, unknown> = baseBody,
  headers: Record<string, string> = {}
) =>
  createApp().request(
    "/contract",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    },
    env
  );

const readContractId = async (response: Response) => {
  const payload = (await response.json()) as { data: { id: number } };
  return payload.data.id;
};

describe("contract create idempotency", () => {
  beforeEach(() => {
    mockAuthState.payload = {
      ...mockAuthState.payload,
      sub: "handler-a",
      roles: ["manager"]
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T02:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays the first contract when the same Idempotency-Key is sent twice", async () => {
    const env = createEnv();
    const headers = { "Idempotency-Key": "payment-wizard-contract-create-run-1-abc" };

    const first = await postContract(env, baseBody, headers);
    const second = await postContract(env, baseBody, headers);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await readContractId(second)).toBe(await readContractId(first));
    expect(env.DB.contractInserts).toBe(1);
  });

  it("replays identical content sent twice without a key inside the time window", async () => {
    const env = createEnv();

    const first = await postContract(env);
    vi.setSystemTime(new Date("2026-09-28T02:00:25.000Z"));
    const second = await postContract(env);

    expect(second.status).toBe(201);
    expect(await readContractId(second)).toBe(await readContractId(first));
    expect(env.DB.contractInserts).toBe(1);
  });

  it("creates a new contract when the content differs", async () => {
    const env = createEnv();

    const first = await postContract(env);
    const second = await postContract(env, { ...baseBody, total_amount: 250000 });

    expect(await readContractId(second)).not.toBe(await readContractId(first));
    expect(env.DB.contractInserts).toBe(2);
  });

  it("allows the same content again once the time window has passed", async () => {
    const env = createEnv();

    await postContract(env);
    vi.setSystemTime(new Date("2026-09-28T02:06:00.000Z"));
    await postContract(env);

    expect(env.DB.contractInserts).toBe(2);
  });

  it("scopes automatic keys to the actor", async () => {
    const env = createEnv();

    await postContract(env);
    mockAuthState.payload = { ...mockAuthState.payload, sub: "handler-b" };
    await postContract(env);

    expect(env.DB.contractInserts).toBe(2);
  });

  it("rejects a second call while the first is still in flight", async () => {
    const env = createEnv();
    const key = "payment-wizard-contract-create-run-2-abc";
    env.DB.idempotency.set(`contract:create|handler-a|${key}`, {
      status: "pending",
      response_json: null,
      status_code: null
    });

    const response = await postContract(env, baseBody, { "Idempotency-Key": key });

    expect(response.status).toBe(409);
    expect(env.DB.contractInserts).toBe(0);
  });

  it("releases the key when creation fails so a retry can succeed", async () => {
    const env = createEnv();
    const headers = { "Idempotency-Key": "payment-wizard-contract-create-run-3-abc" };

    env.DB.failContractInsert = true;
    const failed = await postContract(env, baseBody, headers);
    env.DB.failContractInsert = false;
    const retried = await postContract(env, baseBody, headers);

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(201);
    expect(env.DB.contractInserts).toBe(1);
    expect(
      env.DB.idempotency.get(`contract:create|handler-a|${headers["Idempotency-Key"]}`)?.status
    ).toBe("completed");
  });
});
