import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { handleError } from "../middleware/error";
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

// Task 5：submit-approval 依赖审批引擎解析路由模板、生成流水号等大量真实 DB 交互，
// 与本文件要验证的「db.batch 守卫内嵌」无关，因此整体 mock 掉，只关心其返回值形状。
vi.mock("../services/approval/engine", () => ({
  submitForApproval: async () => ({
    id: 999,
    instance_no: "SP-20260710-0001"
  })
}));

vi.mock("../services/approval/operations", () => ({
  resubmit: async () => {}
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
    if (this.sql.includes("FROM approval_instance WHERE id = ?")) {
      return this.db.approvalInstanceRow as T;
    }
    if (this.sql.includes("FROM entity_bank_account WHERE id = ?")) {
      return this.db.bankAccountRow as T;
    }
    if (this.sql.includes("FROM entity WHERE id = ?")) {
      return this.db.entityRow as T;
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
  approvalInstanceRow: Record<string, unknown> | null = null;
  entityRow: Record<string, unknown> | null = null;
  bankAccountRow: Record<string, unknown> | null = null;

  // Task 5：让测试可以模拟「守卫不成立」——batch() 内每条语句实际执行（影响 0 行），
  // 而不是像默认桩那样一律返回 changes: 1。仅当设置时才覆盖默认行为。
  batchResultOverride: Array<{ meta: { changes: number; last_row_id?: number } }> | null = null;

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
    if (this.batchResultOverride) {
      return this.batchResultOverride;
    }
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

// ─── basic-info ──────────

const buildBoundItem = (): Record<string, unknown> => ({
  batch_item_id: 100,
  id: 5,
  project_id: 1,
  applicant_userid: "finance-a",
  invoice_no: "INV-OLD",
  expense_date: "2026-07-01",
  amount: 100,
  category: "material",
  description: "old desc"
});

const requestBasicInfo = (db: TxDb, body: Record<string, unknown>) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/batch/10/items/5/basic-info",
    {
      method: "PUT",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

describe("basic-info：批次条目基础信息编辑必须在同一次 db.batch 内重算总额", () => {
  it(
    "先 SELECT SUM/COUNT 再 UPDATE 批次总额，在降级模式下会让信封金额与批次总额漂移——" +
      "因此总额/条数必须改写为 UPDATE 内的子查询，与另外两条 UPDATE 一起进同一次 db.batch",
    async () => {
      const db = new TxDb();
      db.batchRow = { id: 10, status: "draft" };
      db.boundItemRow = buildBoundItem();

      const response = await requestBasicInfo(db, { amount: 555.55 });
      expect(response.status).toBe(200);

      expect(db.execCalls).not.toContain("BEGIN IMMEDIATE TRANSACTION");
      expect(db.batchCalls.length).toBe(1);

      const statements = db.batchCalls[0];
      expect(statements.length).toBe(3);

      const [envelopeUpdate, itemUpdate, batchUpdate] = statements;

      expect(envelopeUpdate.sql).toContain("UPDATE reimbursement_envelope");
      const now = envelopeUpdate.args[6];
      expect(typeof now).toBe("string");
      expect(envelopeUpdate.args).toEqual([
        "INV-OLD",
        "INV-OLD",
        "2026-07-01",
        555.55,
        "material",
        "old desc",
        now,
        5
      ]);

      expect(itemUpdate.sql).toContain("UPDATE reimbursement_batch_item");
      expect(itemUpdate.sql).toContain("WHERE batch_id = ? AND envelope_id = ?");
      expect(itemUpdate.args).toEqual([555.55, 10, 5]);

      expect(batchUpdate.sql).toContain("UPDATE reimbursement_batch");
      expect(batchUpdate.sql).toMatch(/SUM\(amount\)/);
      expect(batchUpdate.sql).toMatch(/COUNT\(\*\)/);
      // 总额/条数由子查询在同一原子序列内重算，而非先读一次再回写——
      // 因此 batch_id 作为子查询参数出现两次，updated_at 与信封更新共用同一个 now。
      expect(batchUpdate.args).toEqual([10, 10, now, 10]);

      const body = (await response.json()) as {
        success: boolean;
        data: {
          envelope_id: number;
          invoice_no: string;
          expense_date: string;
          amount: number;
          category: string;
          description: string;
        };
      };
      expect(body).toEqual({
        success: true,
        data: {
          envelope_id: 5,
          invoice_no: "INV-OLD",
          expense_date: "2026-07-01",
          amount: 555.55,
          category: "material",
          description: "old desc"
        }
      });
    }
  );
});

// ─── submit-approval / mark-paid（Task 5：守卫内嵌 + 全原子）──────────
//
// 这两个端点在守卫成立时要写两张表（信封 + 批次），且守卫依赖批次的「旧」状态。
// 带守卫的 UPDATE 匹配 0 行属于「成功执行、影响 0 行」而非错误，db.batch 不会因此
// 回滚——所以守卫必须复制进 batch 内的每一条语句，并把「改变守卫所依赖状态」的那条
// （批次 UPDATE）排在最后，这样 EXISTS 子查询判断的是尚未被同一 batch 改写的旧状态。

const buildSubmitApprovalBatch = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 10,
  batch_no: "PB-20260710-0001",
  status: "draft",
  applicant_userid: "finance-a",
  project_id: 1,
  total_amount: 1000,
  item_count: 2,
  payment_method: "transfer",
  payment_entity_id: null,
  payment_entity_bank_account_id: null,
  payment_account: null,
  payee_id: null,
  approval_instance_id: null,
  ...overrides
});

const requestSubmitApproval = (
  db: TxDb,
  batchId: number,
  body: Record<string, unknown> = {}
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  // 生产环境的完整 app（src/index.ts）挂载了 app.onError(handleError)，把守卫
  // 失败时抛出的 Error 转换成 JSON 500 响应——这里同样挂载，让测试断言的是
  // 真实部署行为，而不是 Hono 默认的纯文本 500（子路由单独跑时的假象）。
  app.onError(handleError);
  return app.request(
    `/reimbursement/batch/${batchId}/submit-approval`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

describe("submit-approval 主路径（守卫 status='draft'）：必须走 db.batch 且守卫内嵌", () => {
  it("守卫成立：信封与批次 UPDATE 在同一次 db.batch 内原子写入，批次 UPDATE 排最后", async () => {
    const db = new TxDb();
    db.batchRow = buildSubmitApprovalBatch();

    const response = await requestSubmitApproval(db, 10, {});
    expect(response.status).toBe(200);

    expect(db.execCalls).not.toContain("BEGIN IMMEDIATE TRANSACTION");
    expect(db.batchCalls.length).toBe(1);

    const statements = db.batchCalls[0];
    expect(statements.length).toBe(2);
    const [envelopeUpdate, batchUpdate] = statements;

    // 信封 UPDATE 的守卫复制了批次的旧状态判断
    expect(envelopeUpdate.sql).toContain("UPDATE reimbursement_envelope");
    expect(envelopeUpdate.sql).toContain(
      "EXISTS (SELECT 1 FROM reimbursement_batch WHERE id = ? AND status = 'draft')"
    );

    // 改变守卫所依赖状态的批次 UPDATE 是 batch 的最后一条
    expect(batchUpdate.sql).toContain("UPDATE reimbursement_batch");
    expect(batchUpdate.sql).toContain("WHERE id = ? AND status = 'draft'");
    expect(statements[statements.length - 1]).toBe(batchUpdate);

    expect(envelopeUpdate.args).toEqual([999, envelopeUpdate.args[1], 10, 10]);
    const now = envelopeUpdate.args[1];
    expect(typeof now).toBe("string");
    expect(batchUpdate.args).toEqual([999, "transfer", null, null, null, null, now, 10]);

    const body = (await response.json()) as {
      success: boolean;
      data: { approval_instance_id: number; instance_no: string };
    };
    expect(body).toEqual({
      success: true,
      data: { approval_instance_id: 999, instance_no: "SP-20260710-0001" }
    });
  });

  it(
    "守卫不成立（并发下批次已不是 draft）：db.batch 内每条语句都影响 0 行——" +
      "零写入，且不做任何补偿性写入，按原有行为向上抛出错误",
    async () => {
      const db = new TxDb();
      db.batchRow = buildSubmitApprovalBatch();
      db.batchResultOverride = [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];

      const response = await requestSubmitApproval(db, 10, {});

      // 原有实现在守卫失败时 throw Error，被外层 catch 撤销幂等记录后重新抛出，
      // 最终由全局 onError 转换为 500——本次改造不得改变这一响应形状。
      expect(response.status).toBe(500);
      const body = (await response.json()) as { ok: boolean; error: { message: string } };
      expect(body).toEqual({
        ok: false,
        error: { message: "Batch is no longer in draft status" }
      });

      // 零写入：db.executed 里只有这一次 batch 调用产生的 2 条语句，
      // 没有额外的审计日志 / 事件日志 / 补偿写入。
      expect(db.batchCalls.length).toBe(1);
      expect(db.executed.length).toBe(2);
    }
  );
});

describe("submit-approval resubmit 路径：原本无守卫，只需合入同一次 db.batch", () => {
  it("原有实现对批次 UPDATE 没有 status 守卫（仅 WHERE id = ?）——保持无守卫，两条 UPDATE 合并进一次 db.batch", async () => {
    const db = new TxDb();
    db.batchRow = buildSubmitApprovalBatch({ approval_instance_id: 42, status: "draft" });
    db.approvalInstanceRow = { status: "returned" };

    const response = await requestSubmitApproval(db, 10, {});
    expect(response.status).toBe(200);

    expect(db.execCalls).not.toContain("BEGIN IMMEDIATE TRANSACTION");
    expect(db.batchCalls.length).toBe(1);

    const statements = db.batchCalls[0];
    expect(statements.length).toBe(2);
    const [batchUpdate, envelopeUpdate] = statements;

    expect(batchUpdate.sql).toContain("UPDATE reimbursement_batch");
    expect(batchUpdate.sql).toContain("WHERE id = ?");
    // 原有语义本就没有守卫——不得凭空新增 AND status = ... 判断
    expect(batchUpdate.sql).not.toMatch(/AND status/);

    expect(envelopeUpdate.sql).toContain("UPDATE reimbursement_envelope");
    expect(envelopeUpdate.sql).toContain("WHERE batch_id = ?");
    expect(envelopeUpdate.sql).not.toMatch(/EXISTS/);

    const now = batchUpdate.args[5];
    expect(typeof now).toBe("string");
    expect(batchUpdate.args).toEqual(["transfer", null, null, null, null, now, 10]);
    expect(envelopeUpdate.args).toEqual([42, now, 10]);

    const body = (await response.json()) as {
      success: boolean;
      data: { approval_instance_id: number; instance_no: string; resubmitted?: boolean };
    };
    expect(body).toEqual({
      success: true,
      data: { approval_instance_id: 42, instance_no: "", resubmitted: true }
    });
  });
});

const buildMarkPaidBatch = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 20,
  batch_no: "PB-20260710-0002",
  status: "approved",
  total_amount: 2000,
  ...overrides
});

const requestMarkPaid = (db: TxDb, batchId: number, body: Record<string, unknown>) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  // 见 requestSubmitApproval 上方注释：挂载真实的全局错误处理，断言真实部署行为。
  app.onError(handleError);
  return app.request(
    `/reimbursement/batch/${batchId}/mark-paid`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

describe("mark-paid（守卫 status='approved'）：必须走 db.batch 且守卫内嵌", () => {
  const markPaidBody = {
    paid_at: "2026-07-10T08:00:00.000Z",
    payment_reference: "PAY-REF-0001",
    payment_entity_id: 1,
    payment_entity_bank_account_id: 2
  };

  it("守卫成立：信封与批次 UPDATE 在同一次 db.batch 内原子写入，批次 UPDATE 排最后", async () => {
    const db = new TxDb();
    db.batchRow = buildMarkPaidBatch();
    db.entityRow = { id: 1, entity_name: "恒越百川" };
    db.bankAccountRow = { id: 2, entity_id: 1, bank_name: "工商银行", account_no: "1234567890" };

    const response = await requestMarkPaid(db, 20, markPaidBody);
    expect(response.status).toBe(200);

    expect(db.execCalls).not.toContain("BEGIN IMMEDIATE TRANSACTION");
    expect(db.batchCalls.length).toBe(1);

    const statements = db.batchCalls[0];
    expect(statements.length).toBe(2);
    const [envelopeUpdate, batchUpdate] = statements;

    // 先改信封，其守卫依赖批次的「旧」状态（此刻尚未被下一条改写）
    expect(envelopeUpdate.sql).toContain("UPDATE reimbursement_envelope");
    expect(envelopeUpdate.sql).toContain("SET status = 'paid'");
    expect(envelopeUpdate.sql).toContain("WHERE batch_id = ?");
    expect(envelopeUpdate.sql).toContain(
      "EXISTS (SELECT 1 FROM reimbursement_batch WHERE id = ? AND status = 'approved')"
    );

    // 改变守卫所依赖状态的批次 UPDATE 是 batch 的最后一条，同一守卫
    expect(batchUpdate.sql).toContain("UPDATE reimbursement_batch");
    expect(batchUpdate.sql).toContain("WHERE id = ? AND status = 'approved'");
    expect(statements[statements.length - 1]).toBe(batchUpdate);

    const now = envelopeUpdate.args[0];
    expect(typeof now).toBe("string");
    expect(envelopeUpdate.args).toEqual([now, 20, 20]);

    // 逐列核对批次 UPDATE 的所有列：paid_at / payment_reference / payment_account /
    // payment_entity_id / payment_entity_bank_account_id / payment_vouchers_json / updated_at
    expect(batchUpdate.args).toEqual([
      "2026-07-10T08:00:00.000Z",
      "PAY-REF-0001",
      "恒越百川 / 工商银行 / 1234567890",
      1,
      2,
      null,
      now,
      20
    ]);

    const body = (await response.json()) as { success: boolean };
    expect(body).toEqual({ success: true });
  });

  it(
    "守卫不成立（并发下批次已不是 approved）：db.batch 内每条语句都影响 0 行——" +
      "零写入，且不做任何补偿性写入（尤其不自动撤销 paid），按原有行为向上抛出错误",
    async () => {
      const db = new TxDb();
      db.batchRow = buildMarkPaidBatch();
      db.entityRow = { id: 1, entity_name: "恒越百川" };
      db.bankAccountRow = { id: 2, entity_id: 1, bank_name: "工商银行", account_no: "1234567890" };
      db.batchResultOverride = [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];

      const response = await requestMarkPaid(db, 20, markPaidBody);

      // 原有实现在守卫失败时 throw Error，被外层 catch 撤销幂等记录后重新抛出，
      // 最终由全局 onError 转换为 500——本次改造不得改变这一响应形状。
      expect(response.status).toBe(500);
      const body = (await response.json()) as { ok: boolean; error: { message: string } };
      expect(body).toEqual({
        ok: false,
        error: { message: "Batch is no longer approved" }
      });

      // 零写入：db.executed 里只有这一次 batch 调用产生的 2 条语句，
      // 没有额外的审计日志 / 事件日志 / 补偿写入，更没有任何撤销 paid 状态的写入。
      expect(db.batchCalls.length).toBe(1);
      expect(db.executed.length).toBe(2);
    }
  );
});
