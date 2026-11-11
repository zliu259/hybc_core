import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

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
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const CONTRACT = {
  id: 17,
  contract_no: "HT-17",
  direction: "outbound",
  project_id: 65,
  entity_id: 13,
  counterparty: "对方单位",
  total_amount: 1000,
  paid_amount: 200,
  status: "active"
};

class SnapshotStatement {
  constructor(
    private readonly sql: string,
    private readonly seen: string[]
  ) {}

  bind() {
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.seen.push(this.sql);
    if (this.sql.includes("FROM contract WHERE id = ?")) return CONTRACT as unknown as T;
    if (this.sql.includes("FROM project WHERE id = ?")) {
      return { project_name: "顶管一期", project_code: "P-7" } as T;
    }
    if (this.sql.includes("FROM entity WHERE id = ?")) {
      return { entity_name: "恒越劳务" } as T;
    }
    throw new Error(`未预期的查询 ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.seen.push(this.sql);
    if (this.sql.includes("FROM contract_amount_change")) {
      return {
        results: [
          {
            id: 5,
            contract_id: 17,
            change_type: "adjust",
            old_amount: 800,
            new_amount: 1000,
            reason: "加量",
            status: "pending",
            approval_instance_id: 9,
            approval_status: "in_progress",
            applicant_userid: "finance-a",
            attachments_json: null,
            created_at: "2026-11-01T00:00:00.000Z"
          }
        ] as unknown as T[]
      };
    }
    if (this.sql.includes("FROM payment_request")) {
      return { results: [{ id: 1, serial_no: "SP-1", amount: 200, status: "paid" }] as unknown as T[] };
    }
    throw new Error(`未预期的查询 ${this.sql}`);
  }
}

describe("GET /contract/:id 详情快照", () => {
  it("带上项目和我方主体，金额变更带审批状态", async () => {
    const seen: string[] = [];
    const env = {
      DB: { prepare: (sql: string) => new SnapshotStatement(sql, seen) },
      KV: {
        async get() {
          return "session";
        }
      }
    } as unknown as Env;
    const app = new Hono<{ Bindings: Env }>();
    app.route("/contract", contractRoutes);

    const response = await app.request(
      "/contract/17",
      { headers: { authorization: "Bearer test-token" } },
      env
    );

    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: {
        project: unknown;
        entity: unknown;
        amount_changes: Array<Record<string, unknown>>;
        payment_requests: unknown[];
      };
    };
    expect(data.project).toEqual({ project_name: "顶管一期", project_code: "P-7" });
    expect(data.entity).toEqual({ entity_name: "恒越劳务" });
    expect(data.amount_changes[0].approval_status).toBe("in_progress");
    expect(data.amount_changes[0].attachments).toEqual([]);
    expect(data.amount_changes[0]).not.toHaveProperty("attachments_json");
    expect(data.payment_requests).toHaveLength(1);
    expect(seen.some((sql) => sql.includes("LEFT JOIN approval_instance"))).toBe(true);
  });
});
