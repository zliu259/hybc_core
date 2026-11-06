import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "operator-a",
    username: "operator-a",
    nickname: "Operator A",
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

type PaymentRow = {
  id: number;
  contract_id: number | null;
  project_id: number;
  payee_id: number;
  payment_entity_id: number | null;
};

class SnapshotStatement {
  private params: unknown[] = [];

  constructor(
    private readonly row: PaymentRow,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM payment_request WHERE id = ?")) {
      return this.row as unknown as T;
    }
    if (this.sql.includes("FROM contract WHERE id = ?")) {
      return {
        contract_no: "HT-9",
        counterparty: "北京鑫丰畅",
        total_amount: 500000,
        paid_amount: 200000,
        entity_id: 3
      } as T;
    }
    if (this.sql.includes("FROM payee WHERE id = ?")) {
      return { name: "收款方", bank_name: "建行", bank_account: "6227" } as T;
    }
    if (this.sql.includes("FROM project WHERE id = ?")) {
      return { project_name: "顶管一期", project_code: "P-7" } as T;
    }
    if (this.sql.includes("FROM entity WHERE id = ?")) {
      return this.params[0] === 3 ? ({ entity_name: "恒越劳务" } as T) : null;
    }
    throw new Error(`未预期的查询 ${this.sql}`);
  }
}

const requestDetail = async (row: PaymentRow) => {
  const db = { prepare: (sql: string) => new SnapshotStatement(row, sql) };
  const env = {
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  const response = await app.request(
    `/payment/${row.id}`,
    { headers: { authorization: "Bearer test-token" } },
    env
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { data: Record<string, unknown> };
  return payload.data;
};

describe("GET /payment/:id 详情快照", () => {
  it("带上项目、付款单位和合同主体，详情页不必再拉全量列表", async () => {
    const data = await requestDetail({
      id: 55,
      contract_id: 9,
      project_id: 7,
      payee_id: 2,
      payment_entity_id: 3
    });

    expect(data.project).toEqual({ project_name: "顶管一期", project_code: "P-7" });
    expect(data.payment_entity).toEqual({ entity_name: "恒越劳务" });
    expect(data.contract).toMatchObject({
      contract_no: "HT-9",
      total_amount: 500000,
      paid_amount: 200000,
      entity_id: 3
    });
    expect(data.payee).toMatchObject({ name: "收款方" });
  });

  it("没选付款单位、没关联合同时返回 null，不串其他单据的值", async () => {
    const data = await requestDetail({
      id: 56,
      contract_id: null,
      project_id: 7,
      payee_id: 2,
      payment_entity_id: null
    });

    expect(data.payment_entity).toBeNull();
    expect(data.contract).toBeNull();
    expect(data.project).toEqual({ project_name: "顶管一期", project_code: "P-7" });
  });
});
