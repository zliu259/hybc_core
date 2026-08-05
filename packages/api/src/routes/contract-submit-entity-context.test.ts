import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { contractRoutes } from "./contract";

/**
 * 回归护栏：首次提交审批的 AI 关卡任务由 engine 直接用 route_context 建，
 * 不经 executors 的 loadAiGateContextFromInstance——我方实体必须在
 * submit-approval 这里就进 context，否则主路径的关卡拿不到我方主体，
 * 会把集团下属实体误判成「主体不符」（08-05 CT-20260805-0001 实锤）。
 */

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

const submitSpy = vi.hoisted(() => vi.fn());

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

vi.mock("../services/approval/engine", () => ({
  submitForApproval: submitSpy
}));

vi.mock("../services/idempotency", () => ({
  beginIdempotentRequest: async () => ({ kind: "start" }),
  completeIdempotentRequest: async () => undefined,
  abandonIdempotentRequest: async () => undefined
}));

vi.mock("../services/ai-slot", () => ({
  createAiGateHandler: () => ({ createAiTask: async () => undefined }),
  createTask: async () => ({ id: 1 })
}));

class SubmitStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: SubmitDb,
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
    return this.db.all<T>(this.sql);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class SubmitDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];

  prepare(sql: string) {
    return new SubmitStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("SELECT * FROM contract WHERE id = ?")) {
      return {
        id: 651,
        contract_no: "CT-20260805-0001",
        direction: "outbound",
        project_id: 28352,
        entity_id: 11,
        counterparty: "集宁区鑫元工程机械经销部",
        contract_type: "机械",
        handler_userid: "handler-a",
        contract_date: "2026-08-05",
        total_amount: 30000,
        paid_amount: 0,
        invoiced_amount: 0,
        received_amount: 0,
        status: "draft",
        ai_review_status: "completed",
        ai_review_result: null,
        approval_instance_id: null,
        attachments_json: null,
        remark: null,
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:00.000Z"
      } as T;
    }
    // loadOurEntityContext 的停用主体兜底查询
    if (sql.includes("SELECT entity_name FROM entity WHERE id = ?")) {
      return { entity_name: "北京鑫丰畅建设有限公司" } as T;
    }
    if (sql.includes("FROM approval_instance WHERE id = ?")) {
      return { instance_no: "SP-20260805-0001", status: "in_progress" } as T;
    }
    if (params.length >= 0 && sql.includes("SELECT approval_instance_id FROM contract")) {
      return { approval_instance_id: 295 } as T;
    }
    return null;
  }

  async all<T>(sql: string): Promise<{ results: T[] }> {
    if (sql.includes("FROM entity WHERE status = 'active'")) {
      return {
        results: [
          { id: 1, entity_name: "恒越百川建设集团有限公司" },
          { id: 11, entity_name: "北京鑫丰畅建设有限公司" }
        ] as T[]
      };
    }
    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

const submitApproval = (env: Env) =>
  new Hono<{ Bindings: Env }>()
    .route("/contract", contractRoutes)
    .request(
      "/contract/651/submit-approval",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: "{}"
      },
      env
    );

describe("contract submit-approval 我方实体上下文", () => {
  it("首次提交把我方主体与集团名单写进 route_context", async () => {
    submitSpy.mockReset();
    submitSpy.mockResolvedValue({ id: 295, instance_no: "SP-20260805-0001" });
    const env = { DB: new SubmitDb(), KV: { async get() { return "session"; } } } as unknown as Env;

    const response = await submitApproval(env);
    expect(response.status).toBe(200);

    expect(submitSpy).toHaveBeenCalledTimes(1);
    const request = submitSpy.mock.calls[0][1] as {
      context: Record<string, unknown>;
    };
    // 我方主体取本单 entity_id 对应实体，不得是「恒越百川」的机械假定
    expect(request.context.our_entity).toBe("北京鑫丰畅建设有限公司");
    expect(String(request.context.our_entities)).toContain("恒越百川建设集团有限公司");
    expect(String(request.context.our_entities)).toContain("北京鑫丰畅建设有限公司");
  });
});
