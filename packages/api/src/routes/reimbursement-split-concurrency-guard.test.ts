import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

// 复现拆单并发闸门（POST /:id/split）的乐观锁校验:
// 拆单必然改写 amount 或 precheck_status 至少一列,所以闸门 WHERE 必须同时携带这两列的
// 快照比对,否则两个并发拆单都能用同一份 status/batch_id/approval_instance_id 通过闸门,
// 各自成功执行 UPDATE + INSERT,产生两张子信封与错乱的原单金额。
// 本测试仿照 reimbursement-detail-status-guard.test.ts 的做法:驱动真实的 Hono 路由,
// 用假 D1 捕获实际执行的 SQL 文本与绑定参数,再对捕获结果做正则/相等断言,
// 从而在不依赖真实数据库的前提下钉死闸门 SQL 的形状。

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

class GuardStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: GuardDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")) {
      return this.db.envelopeRow as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    // 这就是并发闸门语句:同时改写 amount 与 precheck_status 的那条 UPDATE。
    if (this.sql.includes("SET amount = ?") && this.sql.includes("precheck_status = 'none'")) {
      return { meta: { changes: this.db.gateChanges, last_row_id: 1 } };
    }
    return { meta: { changes: 1, last_row_id: 1 } };
  }
}

class GuardDb {
  executed: CapturedStatement[] = [];
  envelopeRow: Record<string, unknown> = {};
  // 默认模拟"闸门命中 0 行"——即并发场景下第二个请求应该看到的结果。
  gateChanges = 0;

  prepare(sql: string) {
    return new GuardStatement(this, sql);
  }

  async exec() {
    return { count: 0, duration: 0 } as unknown as D1ExecResult;
  }
}

const ENVELOPE_AMOUNT_SNAPSHOT = 555.55;
const ENVELOPE_PRECHECK_SNAPSHOT = "approved";

const buildEnvelope = (): Record<string, unknown> => ({
  id: 321,
  status: "received",
  batch_id: null,
  approval_instance_id: null,
  amount: ENVELOPE_AMOUNT_SNAPSHOT,
  precheck_status: ENVELOPE_PRECHECK_SNAPSHOT
});

const createEnv = (db: GuardDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSplit = (db: GuardDb) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/321/split",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        original_amount: 200,
        new_envelope: { project_id: 1, amount: 300 },
        attachment_ids: [],
        reason: "concurrency-guard-test"
      })
    },
    createEnv(db)
  );
};

const gateStatement = (db: GuardDb) =>
  db.executed.find(
    (item) =>
      item.sql.includes("UPDATE reimbursement_envelope") &&
      item.sql.includes("SET amount = ?") &&
      item.sql.includes("precheck_status = 'none'")
  );

// 只取 WHERE 关键字之后的部分,避免把 SET 子句里同样写着 "amount = ?" 的赋值误判成校验条件。
const whereClauseOf = (sql: string): string => {
  const index = sql.search(/\bWHERE\b/i);
  return index === -1 ? "" : sql.slice(index);
};

describe("reimbursement split concurrency gate must snapshot-compare amount and precheck_status", () => {
  it("includes amount and precheck_status equality checks in the gate WHERE clause", async () => {
    const db = new GuardDb();
    db.envelopeRow = buildEnvelope();
    db.gateChanges = 0;

    await requestSplit(db);

    const gate = gateStatement(db);
    expect(gate, "Expected the split gate UPDATE to be executed").toBeDefined();

    const where = whereClauseOf(gate!.sql);
    expect(
      where,
      "Removing the amount snapshot check from the gate WHERE clause reopens the split-vs-split race: " +
        "two concurrent /:id/split requests both pass 'status = ?' and each create a child envelope, " +
        "leaving duplicate child envelopes and a corrupted original amount."
    ).toMatch(/\bamount\s*=\s*\?/);
    expect(
      where,
      "Removing the precheck_status snapshot check from the gate WHERE clause reopens the same " +
        "split-vs-split race window (amount alone is not always sufficient, see code comment)."
    ).toMatch(/\bprecheck_status\s*=\s*\?/);
    expect(where, "batch_id IS NULL guard must remain (prevents split-vs-batch race)").toMatch(
      /\bbatch_id\s+IS\s+NULL\b/i
    );
    expect(
      where,
      "approval_instance_id IS NULL guard must remain (prevents split-vs-submit race)"
    ).toMatch(/\bapproval_instance_id\s+IS\s+NULL\b/i);
    expect(where, "status = ? guard must remain").toMatch(/\bstatus\s*=\s*\?/);
  });

  it("binds the pre-transaction amount/precheck_status snapshot as the last two gate parameters", async () => {
    const db = new GuardDb();
    db.envelopeRow = buildEnvelope();
    db.gateChanges = 0;

    await requestSplit(db);

    const gate = gateStatement(db);
    expect(gate).toBeDefined();
    expect(
      gate!.args.length,
      "Expected 6 bind params: original_amount, now, id, status, amount snapshot, precheck_status snapshot"
    ).toBe(6);
    expect(gate!.args[4], "5th bind param must be the envelope's snapshotted amount").toBe(
      ENVELOPE_AMOUNT_SNAPSHOT
    );
    expect(
      gate!.args[5],
      "6th bind param must be the envelope's snapshotted precheck_status"
    ).toBe(ENVELOPE_PRECHECK_SNAPSHOT);
  });

  it("aborts the split (no child envelope inserted) when the gate reports zero rows changed", async () => {
    const db = new GuardDb();
    db.envelopeRow = buildEnvelope();
    db.gateChanges = 0;

    const response = await requestSplit(db);

    expect(response.status).toBeGreaterThanOrEqual(400);
    const inserted = db.executed.some((item) =>
      item.sql.includes("INSERT INTO reimbursement_envelope")
    );
    expect(inserted, "No child envelope should be inserted when the gate aborts").toBe(false);
  });
});
