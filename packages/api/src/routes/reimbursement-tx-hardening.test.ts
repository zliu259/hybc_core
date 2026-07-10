import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

// D1 事务加固 Task 3/4：验证 rebind-uuid 的 UUID 三步交换、basic-info 的批次
// 条目基础信息编辑，都必须通过一次 db.batch() 原子提交完成，而不是拆成多次
// prepare().run()（后者依赖 runInTransaction，在 D1 生产环境降级为非事务执行，
// 失败时不会回滚——三步交换会留下 tempUuid 孤儿，basic-info 会让信封金额与
// 批次总额漂移）。
//
// 本测试仿照 reimbursement-detail-status-guard.test.ts /
// reimbursement-split-concurrency-guard.test.ts 的做法：驱动真实的 Hono 路由，
// 用假 D1 捕获实际执行的 SQL 文本、bind 参数，以及 batch()/exec() 调用次数，
// 从而在不依赖真实数据库的前提下钉死"必须走 db.batch，且不得调用
// BEGIN IMMEDIATE TRANSACTION"这一约束。

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

type CapturedStatement = { sql: string; args: unknown[] };

class TxStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: TxDb,
    readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  get capturedArgs(): unknown[] {
    return this.args;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ?")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("FROM reimbursement_envelope WHERE envelope_uuid = ?")) {
      return this.db.occupiedRow as T;
    }
    if (this.sql.includes("FROM envelope_attachment WHERE envelope_id = ?")) {
      return { cnt: this.db.attachmentCount } as T;
    }
    if (this.sql.includes("FROM reimbursement_batch_item bi")) {
      return this.db.boundItemRow as T;
    }
    if (this.sql.includes("FROM reimbursement_batch WHERE id = ?")) {
      return this.db.batchRow as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    return { meta: { changes: 1, last_row_id: 1 } };
  }
}

class TxDb {
  executed: CapturedStatement[] = [];
  execCalls: string[] = [];
  batchCalls: CapturedStatement[][] = [];

  envelopeRow: Record<string, unknown> | null = null;
  occupiedRow: Record<string, unknown> | null = null;
  attachmentCount = 0;
  batchRow: Record<string, unknown> | null = null;
  boundItemRow: Record<string, unknown> | null = null;

  prepare(sql: string) {
    return new TxStatement(this, sql);
  }

  async exec(sql: string) {
    this.execCalls.push(sql);
    return { count: 0, duration: 0 } as unknown as D1ExecResult;
  }

  async batch(statements: TxStatement[]) {
    const captured = statements.map((stmt) => ({ sql: stmt.sql, args: stmt.capturedArgs }));
    this.batchCalls.push(captured);
    this.executed.push(...captured);
    return statements.map(() => ({ meta: { changes: 1, last_row_id: 1 } }));
  }
}

const createEnv = (db: TxDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

// ─── rebind-uuid ──────────

const OLD_UUID = "11111111-1111-4111-8111-111111111111";
const NEXT_UUID = "22222222-2222-4222-8222-222222222222";

const buildPhysicalEnvelope = (): Record<string, unknown> => ({
  id: 1,
  envelope_no: "ENV-OLD-NO",
  envelope_uuid: OLD_UUID,
  channel: "physical",
  status: "draft",
  applicant_userid: "finance-a"
});

const requestRebindUuid = (db: TxDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/1/rebind-uuid",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        envelope_uuid: NEXT_UUID,
        reason: "实体信封二维码损坏，重新粘贴后需要绑定新 UUID"
      })
    },
    createEnv(db)
  );
};

describe("rebind-uuid：UUID 三步交换必须走 db.batch 原子提交", () => {
  it(
    "拆成多次 prepare().run() 会在 D1 生产环境留下 tempUuid 孤儿，实体信封扫码失联——" +
      "因此三步 UPDATE 必须在同一次 db.batch 调用内完成，且不得调用 BEGIN IMMEDIATE TRANSACTION",
    async () => {
      const db = new TxDb();
      db.envelopeRow = buildPhysicalEnvelope();
      db.occupiedRow = { id: 2, status: "unregistered", applicant_userid: "__UNASSIGNED__" };
      db.attachmentCount = 0;

      const response = await requestRebindUuid(db);
      expect(response.status).toBe(200);

      expect(db.execCalls).not.toContain("BEGIN IMMEDIATE TRANSACTION");
      expect(db.batchCalls.length).toBe(1);

      const statements = db.batchCalls[0];
      expect(statements.length).toBe(3);

      const rebindSql =
        "UPDATE reimbursement_envelope SET envelope_uuid = ?, envelope_no = ?, updated_at = ? WHERE id = ?";
      for (const stmt of statements) {
        expect(stmt.sql).toBe(rebindSql);
      }

      const [first, second, third] = statements;
      const tempUuid = first.args[0];
      const now = first.args[2];

      expect(first.args).toEqual([tempUuid, tempUuid, now, 2]);
      expect(second.args).toEqual([NEXT_UUID, NEXT_UUID, now, 1]);
      expect(third.args).toEqual([OLD_UUID, OLD_UUID, now, 2]);
      expect(tempUuid).not.toBe(NEXT_UUID);
      expect(tempUuid).not.toBe(OLD_UUID);

      const body = (await response.json()) as {
        success: boolean;
        data: {
          id: number;
          envelope_uuid: string;
          envelope_no: string;
          swapped_placeholder_id: number | null;
        };
      };
      expect(body).toEqual({
        success: true,
        data: {
          id: 1,
          envelope_uuid: NEXT_UUID,
          envelope_no: NEXT_UUID,
          swapped_placeholder_id: 2
        }
      });
    }
  );
});
