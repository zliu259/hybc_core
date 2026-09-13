import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { paymentRoutes } from "./payment";

// 背景（2026-09-13，SP-20260913-0007 / PM-20260913-0003）：AI 关卡把付款申请退回
// （实例 returned、付款回 draft），超管随后作废了该付款。作废只把 pending/in_progress
// 的审批实例收口成 cancelled，returned 实例被留成「退回待处理」僵尸：小程序审批详情仍给
// 发起人「编辑并重新提交」入口，PUT 能过（isOwnerReworkState 认可可重提实例），
// POST submit-approval 却因付款已 cancelled 报 "Only draft requests can be submitted"。
//
// 本文件仿照 payment-returned-edit.test.ts：驱动真实 Hono 路由，用假 D1 捕获实际执行的
// SQL，并模拟 `WHERE id = ? AND status IN (...)` 的行匹配语义来断言实例是否真的被收口。

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "boss-a",
    username: "boss-a",
    nickname: "Boss A",
    avatar: "",
    roles: ["super_admin"],
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

const approvalOpsMock = vi.hoisted(() => ({
  resubmit: vi.fn(async () => {})
}));

vi.mock("../services/approval/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/approval/operations")>()),
  resubmit: approvalOpsMock.resubmit
}));

type FakeDbOptions = {
  paymentStatus?: string;
  /** null = 付款未关联审批实例 */
  approvalStatus?: string | null;
};

class PaymentVoidStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: PaymentVoidDb,
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

class PaymentVoidDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly options: FakeDbOptions = {}) {}

  prepare(sql: string) {
    return new PaymentVoidStatement(this, sql);
  }

  get approvalStatus(): string | null {
    return this.options.approvalStatus === undefined ? "returned" : this.options.approvalStatus;
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    void _params;
    if (sql.includes("FROM payment_request WHERE id = ?")) {
      return {
        id: 2899,
        serial_no: "PM-20260913-0003",
        project_id: 65,
        contract_id: 675,
        payee_id: 701,
        amount: 20000,
        amount_cn: "贰万元整",
        content: "首笔预付款",
        category: "其他费用",
        expected_payment_date: "2026-09-18",
        payment_method: "对公转账",
        payment_entity_id: 18,
        payment_entity_bank_account_id: null,
        payment_account: null,
        attachments_json: null,
        remark: null,
        status: this.options.paymentStatus ?? "draft",
        approval_instance_id: this.approvalStatus === null ? null : 362,
        applicant_userid: "initiator-a",
        created_at: "2026-09-13T06:02:55.751Z",
        updated_at: "2026-09-13T06:03:52.078Z"
      } as T;
    }
    if (sql.includes("FROM approval_instance")) {
      if (this.approvalStatus === null) return null;
      return { id: 362, instance_no: "SP-20260913-0007", status: this.approvalStatus } as T;
    }
    return null;
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }

  /**
   * 模拟 D1 对 `UPDATE approval_instance SET status = 'cancelled' ... WHERE id = ? AND status IN (...)`
   * 的行匹配：只有状态列表包含实例当前状态，这条 UPDATE 才会真的改到行。
   */
  get approvalInstanceClosed(): boolean {
    const statement = this.runs.find(
      (call) => call.sql.includes("UPDATE approval_instance") && call.sql.includes("'cancelled'")
    );
    if (!statement) return false;
    const match = statement.sql.match(/status\s+IN\s*\(([^)]*)\)/i);
    if (!match) return this.approvalStatus !== null;
    const statuses = match[1].split(",").map((item) => item.trim().replace(/^'|'$/g, ""));
    return this.approvalStatus !== null && statuses.includes(this.approvalStatus);
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/payment", paymentRoutes);
  return app;
};

const createEnv = (db: PaymentVoidDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    },
    EVENT_QUEUE: {
      async send() {}
    }
  }) as unknown as Env & { DB: PaymentVoidDb };

const postJson = (env: Env, path: string, body: Record<string, unknown> = {}) =>
  createApp().request(
    path,
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );

describe("voiding a payment closes its still-open approval instance", () => {
  beforeEach(() => {
    approvalOpsMock.resubmit.mockClear();
    mockAuthState.payload = { ...mockAuthState.payload, sub: "boss-a", roles: ["super_admin"] };
  });

  it.each(["returned", "withdrawn", "pending"])(
    "closes a %s instance that is back in the initiator's hands",
    async (approvalStatus) => {
      const env = createEnv(new PaymentVoidDb({ paymentStatus: "draft", approvalStatus }));

      const response = await postJson(env, "/payment/2899/void", { reason: "附件对象不符" });

      expect(response.status).toBe(200);
      expect(env.DB.approvalInstanceClosed).toBe(true);
    }
  );

  it("still closes an in_progress instance", async () => {
    const env = createEnv(
      new PaymentVoidDb({ paymentStatus: "pending_approval", approvalStatus: "in_progress" })
    );

    const response = await postJson(env, "/payment/2899/void");

    expect(response.status).toBe(200);
    expect(env.DB.approvalInstanceClosed).toBe(true);
  });

  it("leaves a terminal (approved) instance untouched", async () => {
    const env = createEnv(
      new PaymentVoidDb({ paymentStatus: "approved", approvalStatus: "approved" })
    );

    const response = await postJson(env, "/payment/2899/void");

    expect(response.status).toBe(200);
    expect(env.DB.approvalInstanceClosed).toBe(false);
  });
});

describe("submit-approval on a voided payment", () => {
  beforeEach(() => {
    approvalOpsMock.resubmit.mockClear();
    mockAuthState.payload = { ...mockAuthState.payload, sub: "initiator-a", roles: ["manager"] };
  });

  it("names the cancellation instead of the generic draft-only message and never resubmits", async () => {
    const env = createEnv(
      new PaymentVoidDb({ paymentStatus: "cancelled", approvalStatus: "returned" })
    );

    const response = await postJson(env, "/payment/2899/submit-approval", {
      biz_summary: "首笔预付款"
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe(
      "Payment request has been cancelled and cannot be submitted"
    );
    expect(approvalOpsMock.resubmit).not.toHaveBeenCalled();
    expect(env.DB.runs.some((call) => call.sql.includes("api_idempotency_request"))).toBe(false);
  });

  it("keeps the draft-only message for other non-draft statuses", async () => {
    const env = createEnv(new PaymentVoidDb({ paymentStatus: "paid", approvalStatus: "approved" }));

    const response = await postJson(env, "/payment/2899/submit-approval");

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toBe("Only draft requests can be submitted");
  });
});
