import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "initiator-a",
    username: "initiator-a",
    nickname: "Initiator A",
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

class PaymentReturnedEditStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: PaymentReturnedEditDb,
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

class PaymentReturnedEditDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(
    private readonly options: {
      paymentStatus?: string;
      approvalStatus?: string | null;
      hasApproverTask?: boolean;
    } = {}
  ) {}

  prepare(sql: string) {
    return new PaymentReturnedEditStatement(this, sql);
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("FROM payment_request WHERE id = ?")) {
      return {
        id: 108,
        serial_no: "PAY-108",
        project_id: 1,
        contract_id: 7,
        payee_id: 3,
        amount: 500,
        amount_cn: "伍佰元整",
        content: "原申请内容",
        category: "material",
        expected_payment_date: "2026-07-10",
        payment_method: "bank",
        payment_entity_id: null,
        payment_entity_bank_account_id: null,
        payment_account: null,
        attachments_json: null,
        remark: null,
        status: this.options.paymentStatus ?? "pending_approval",
        approval_instance_id: this.options.approvalStatus === null ? null : 191,
        created_by: "initiator-a",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z"
      } as T;
    }
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      if (this.options.approvalStatus === null) return null;
      return { status: this.options.approvalStatus ?? "returned" } as T;
    }
    if (sql.includes("FROM approval_task")) {
      return this.options.hasApproverTask ? ({ id: 1 } as T) : null;
    }
    if (sql.includes("FROM contract WHERE id = ?")) {
      return null;
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
  app.route("/payment", paymentRoutes);
  return app;
};

const createEnv = (db = new PaymentReturnedEditDb()) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: PaymentReturnedEditDb };

const putPayment = (
  env: Env & { DB: PaymentReturnedEditDb },
  body: Record<string, unknown> = { content: "补充退回材料", remark: "修订" }
) =>
  createApp().request(
    "/payment/108",
    {
      method: "PUT",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );

describe("payment returned rework edits", () => {
  beforeEach(() => {
    mockAuthState.payload = {
      ...mockAuthState.payload,
      sub: "initiator-a",
      roles: ["manager"]
    };
  });

  it("allows the initiator to edit a returned payment stuck in pending_approval (payment 108 scenario)", async () => {
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "returned"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE payment_request SET"))).toBe(true);
  });

  it("treats a legacy 'pending' instance as returned-awaiting-resubmit, not in-progress", async () => {
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "pending"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(200);
  });

  it("does not force edit mode for a super admin editing their own draft payment", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "draft",
        approvalStatus: null
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });

  it("does not force edit mode for a super admin non-owner editing a returned payment", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "returned"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });
});

describe("payment locks retained outside rework states", () => {
  it("still blocks manager business edits while approval is in progress", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "initiator-a", roles: ["manager"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "in_progress"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(400);
  });

  it("still requires edit mode for a super admin while approval is in progress", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "in_progress"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toContain("edit mode");
  });

  it("lets a super admin bypass the in-progress lock with edit mode and note, writing audit", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "in_progress"
      })
    );

    const response = await putPayment(env, {
      content: "审批中修正内容",
      admin_edit_mode: true,
      edit_note: "老板纠正申请内容"
    });

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(true);
  });

  it("still blocks manager business edits after the approval lifecycle finished", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "initiator-a", roles: ["manager"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "approved",
        approvalStatus: "approved"
      })
    );

    const response = await putPayment(env);

    expect(response.status).toBe(400);
  });

  it("still allows the current approver to adjust payout fields during approval", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "approver-a", roles: ["finance"] };
    const env = createEnv(
      new PaymentReturnedEditDb({
        paymentStatus: "pending_approval",
        approvalStatus: "in_progress",
        hasApproverTask: true
      })
    );

    const response = await putPayment(env, { payment_account: "工商银行 622202xxxx" });

    expect(response.status).toBe(200);
  });
});
