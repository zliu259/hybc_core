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
  constructor(private readonly sql: string) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("pending_count")) {
      return {
        pending_count: 5,
        returned_count: 2,
        in_approval_count: 8,
        to_pay_count: 3,
        to_pay_total: 1280000,
        overdue_count: 3,
        paid_month_total: 860000
      } as T;
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

const createEnv = () =>
  ({
    DB: { prepare: (sql: string) => new SummaryStatement(sql) },
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSummary = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app.request(
    "/payment/console-summary",
    { headers: { authorization: "Bearer test-token" } },
    createEnv()
  );
};

describe("payment console summary", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
  });

  it("returns aggregated stage counts and totals for finance role", async () => {
    const response = await requestSummary();

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { to_pay_total: number; returned_count: number; overdue_count: number };
    };
    expect(payload.data.to_pay_total).toBe(1280000);
    expect(payload.data.returned_count).toBe(2);
    expect(payload.data.overdue_count).toBe(3);
  });

  it("rejects operator role (global totals must not leak)", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["operator"] };

    const response = await requestSummary();

    expect(response.status).toBe(403);
  });
});
