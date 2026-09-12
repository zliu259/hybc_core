import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

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

type Row = Record<string, unknown>;
type Executed = { sql: string; params: unknown[] };

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: FakeDb,
    private readonly sql: string
  ) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return (this.db.firstHandler(this.sql, this.params) as T | null) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { results: this.db.allHandler(this.sql, this.params) as T[] };
  }
  async run() {
    this.db.executed.push({ sql: this.sql, params: this.params });
    // 成批认领 UPDATE（SET batch_id = ?, status = 'batched'）绑定 [batchId, now, ...envelopeIds]，
    // 路由要求 changes === selected.length 才继续；其余语句维持默认单行 changes。
    const changes = this.sql.includes("SET batch_id = ?, status = 'batched'")
      ? this.params.length - 2
      : 1;
    return { meta: { changes, last_row_id: 1 } };
  }
}

export class FakeDb {
  executed: Executed[] = [];
  firstHandler: (sql: string, params: unknown[]) => Row | null = () => null;
  allHandler: (sql: string, params: unknown[]) => Row[] = () => [];
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
  async batch(statements: FakeStatement[]) {
    return statements.map(() => ({ meta: { changes: 1, last_row_id: 1 } }));
  }
  async exec() {
    return { count: 0, duration: 0 };
  }
}

const createEnv = (db: FakeDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const request = (db: FakeDb, path: string, init?: { method?: string; body?: string }) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    path,
    {
      method: init?.method ?? "GET",
      body: init?.body,
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      }
    },
    createEnv(db)
  );
};

const envelopeRow = (overrides: Row = {}): Row => ({
  id: 5,
  envelope_no: "e-5",
  envelope_uuid: "e-5",
  project_id: 144,
  applicant_userid: "LuShuMing",
  channel: "electronic",
  status: "received",
  precheck_status: "approved",
  batch_id: null,
  approval_instance_id: null,
  invoice_title_entity_id: null,
  invoice_title_name: null,
  invoice_title_source: null,
  ...overrides
});

describe("PUT /reimbursement/:id invoice_title_entity_id", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  it("办公室角色指定主体：写三列（来源 manual）并记审计", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) => {
      if (sql.includes("FROM reimbursement_envelope WHERE id = ?")) return envelopeRow();
      if (sql.includes("FROM entity WHERE id = ?")) {
        return { id: 11, entity_name: "北京鑫丰畅建设有限公司" };
      }
      return null;
    };
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 11 })
    });
    expect(response.status).toBe(200);
    const titleWrite = db.executed.find((item) => item.sql.includes("invoice_title_source = ?"));
    expect(titleWrite?.params.slice(0, 3)).toEqual([11, "北京鑫丰畅建设有限公司", "manual"]);
    expect(titleWrite?.params[4]).toBe(5);
    const audit = db.executed.find((item) => item.sql.includes("INSERT INTO api_audit_log"));
    expect(audit?.params).toContain("reimbursement.envelope.set_invoice_title");
  });

  it("传 null 清除三列", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?")
        ? envelopeRow({ invoice_title_entity_id: 11, invoice_title_source: "manual" })
        : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: null })
    });
    expect(response.status).toBe(200);
    const titleWrite = db.executed.find((item) => item.sql.includes("invoice_title_source = ?"));
    expect(titleWrite?.params.slice(0, 3)).toEqual([null, null, null]);
  });

  it("非 active 主体 → 400", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) => {
      if (sql.includes("FROM reimbursement_envelope WHERE id = ?")) return envelopeRow();
      if (sql.includes("FROM entity WHERE id = ?")) {
        // 只有带 status = 'active' 过滤的查询才会查不到停用主体
        return sql.includes("status = 'active'") ? null : { id: 999, entity_name: "已停用主体" };
      }
      return null;
    };
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 999 })
    });
    expect(response.status).toBe(400);
  });

  it("请求体不带该字段：不写抬头、不记审计", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?")
        ? envelopeRow({ invoice_title_entity_id: 11, invoice_title_source: "manual" })
        : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ category: "办公费用" })
    });
    expect(response.status).toBe(200);
    expect(db.executed.some((item) => item.sql.includes("invoice_title_source = ?"))).toBe(false);
    expect(db.executed.some((item) => item.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });

  it("非正整数（1.5 / 字符串 / true）→ 400，且不查主体", async () => {
    for (const value of [1.5, "11", true, 0, -3]) {
      const db = new FakeDb();
      db.firstHandler = (sql) =>
        sql.includes("FROM reimbursement_envelope WHERE id = ?") ? envelopeRow() : null;
      const response = await request(db, "/reimbursement/5", {
        method: "PUT",
        body: JSON.stringify({ invoice_title_entity_id: value })
      });
      expect(response.status).toBe(400);
      expect(db.executed.some((item) => item.sql.includes("FROM entity WHERE id = ?"))).toBe(false);
    }
  });

  it("申请人本人（operator）不能指定抬头 → 403", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "LuShuMing", roles: ["operator"] };
    const db = new FakeDb();
    db.firstHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope WHERE id = ?")
        ? envelopeRow({ status: "submitted" })
        : null;
    const response = await request(db, "/reimbursement/5", {
      method: "PUT",
      body: JSON.stringify({ invoice_title_entity_id: 11 })
    });
    expect(response.status).toBe(403);
    expect(db.executed.some((item) => item.sql.includes("invoice_title_source = ?"))).toBe(false);
  });
});

describe("GET /reimbursement/batch/candidates invoice_title_entity_id", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  const candidatesSql = (db: FakeDb) =>
    db.executed.find(
      (item) =>
        item.sql.includes("FROM reimbursement_envelope") && item.sql.includes("batch_id IS NULL")
    );

  it("none → IS NULL", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=none"
    );
    expect(response.status).toBe(200);
    expect(candidatesSql(db)?.sql).toContain("invoice_title_entity_id IS NULL");
    expect(candidatesSql(db)?.params).toEqual([144, "LuShuMing"]);
  });

  it("数字 → = ? 且绑定该 id", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=11"
    );
    expect(response.status).toBe(200);
    const executed = candidatesSql(db);
    expect(executed?.sql).toContain("invoice_title_entity_id = ?");
    expect(executed?.params).toEqual([144, "LuShuMing", 11]);
  });

  it("缺省 → 不加过滤", async () => {
    const db = new FakeDb();
    await request(db, "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing");
    expect(candidatesSql(db)?.sql).not.toContain("invoice_title_entity_id");
  });

  it("非法值 → 400", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=abc"
    );
    expect(response.status).toBe(400);
  });

  it("0 / -1 / 1.5 → 400", async () => {
    for (const raw of ["0", "-1", "1.5"]) {
      const db = new FakeDb();
      const response = await request(
        db,
        `/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=${raw}`
      );
      expect(response.status).toBe(400);
    }
  });

  it("首尾空白被裁剪", async () => {
    const db = new FakeDb();
    const response = await request(
      db,
      "/reimbursement/batch/candidates?project_id=144&applicant_userid=LuShuMing&invoice_title_entity_id=%2011%20"
    );
    expect(response.status).toBe(200);
    expect(candidatesSql(db)?.params).toEqual([144, "LuShuMing", 11]);
  });
});

describe("GET /reimbursement/batch/proposals 按抬头分组", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  it("同人同项目不同抬头拆成两组，组带抬头字段", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope e")
        ? [
            {
              id: 237,
              envelope_no: "e-237",
              project_id: 144,
              applicant_userid: "LuShuMing",
              amount: 1348,
              description: null,
              channel: "electronic",
              duplicate_risk_level: null,
              invoice_title_entity_id: 11,
              invoice_title_name: "北京鑫丰畅建设有限公司"
            },
            {
              id: 241,
              envelope_no: "e-241",
              project_id: 144,
              applicant_userid: "LuShuMing",
              amount: 18,
              description: null,
              channel: "electronic",
              duplicate_risk_level: null,
              invoice_title_entity_id: 6,
              invoice_title_name: "廊坊市丰畅市政工程有限公司"
            }
          ]
        : [];
    const response = await request(db, "/reimbursement/batch/proposals");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{
        invoice_title_entity_id: number | null;
        invoice_title_name: string | null;
        envelopes: Array<{ id: number; invoice_title_entity_id: number | null }>;
      }>;
    };
    expect(
      payload.data.map((g) => [
        g.invoice_title_entity_id,
        g.invoice_title_name,
        g.envelopes.map((e) => e.id)
      ])
    ).toEqual([
      [6, "廊坊市丰畅市政工程有限公司", [241]],
      [11, "北京鑫丰畅建设有限公司", [237]]
    ]);
    expect(payload.data[0].envelopes[0].invoice_title_entity_id).toBe(6);
  });
});

describe("POST /reimbursement/:id/split 抬头继承", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  it("子信封 INSERT 携带父信封的三列抬头", async () => {
    const db = new FakeDb();
    db.firstHandler = (sql) => {
      if (sql.includes("FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'")) {
        return envelopeRow({
          amount: 1348,
          status: "received",
          precheck_status: "approved",
          batch_id: null,
          approval_instance_id: null,
          channel: "electronic",
          envelope_uuid: "e-5",
          invoice_title_entity_id: 11,
          invoice_title_name: "北京鑫丰畅建设有限公司",
          invoice_title_source: "manual"
        });
      }
      // enqueueEnvelopeAiAudit / applyDuplicateChecks 发出的裸 SELECT（不带 AND status 过滤）。
      // 返回 null 使其在 `if (!envelope) return;` 处提前退出，从而不必伪造查重与
      // AI 审核任务队列（applyDuplicateChecks / createTask）的整条链路。
      return null;
    };
    const response = await request(db, "/reimbursement/5/split", {
      method: "POST",
      body: JSON.stringify({
        new_envelope: { project_id: 144, amount: 100 },
        original_amount: 1248,
        reason: "拆单测试"
      })
    });
    expect(response.status).toBe(201);
    const insert = db.executed.find((item) =>
      item.sql.includes("INSERT INTO reimbursement_envelope")
    );
    expect(insert?.sql).toContain(
      "invoice_title_entity_id, invoice_title_name, invoice_title_source"
    );
    const columns =
      insert?.sql
        .match(/\(([^)]*)\)\s*VALUES/)?.[1]
        .split(",")
        .map((s) => s.trim()) ?? [];
    const titleIndex = columns.indexOf("invoice_title_entity_id");
    // 'none' 字面量位于 precheck_status 位置，绑定下标要减 1
    const literalOffset = columns.indexOf("precheck_status") < titleIndex ? 1 : 0;
    expect(
      insert?.params.slice(titleIndex - literalOffset, titleIndex - literalOffset + 3)
    ).toEqual([11, "北京鑫丰畅建设有限公司", "manual"]);
  });
});

describe("POST /reimbursement/batch 混抬头软约束", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "finance-a", roles: ["finance"] };
  });

  const mixedEnvelopes = [
    envelopeRow({
      id: 237,
      amount: 1348,
      invoice_title_entity_id: 11,
      invoice_title_name: "北京鑫丰畅建设有限公司"
    }),
    envelopeRow({
      id: 241,
      amount: 18,
      invoice_title_entity_id: 6,
      invoice_title_name: "廊坊市丰畅市政工程有限公司"
    })
  ];

  it("抬头不一致且无理由 → 400 MIXED_INVOICE_TITLE，附各抬头计数，且未写库", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) => (sql.includes("FROM reimbursement_envelope") ? mixedEnvelopes : []);
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({
        project_id: 144,
        applicant_userid: "LuShuMing",
        envelope_ids: [237, 241]
      })
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: {
        code: string;
        message: string;
        title_counts: Array<{ entity_id: number | null; count: number }>;
      };
    };
    expect(payload.error.code).toBe("MIXED_INVOICE_TITLE");
    expect(payload.error.message).toContain("2–200");
    expect(payload.error.title_counts).toHaveLength(2);
    expect(db.executed.some((item) => item.sql.includes("INSERT INTO reimbursement_batch"))).toBe(
      false
    );
    expect(db.executed.some((item) => item.sql.includes("api_idempotency_request"))).toBe(false);
  });

  it("理由过短同样 400", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) => (sql.includes("FROM reimbursement_envelope") ? mixedEnvelopes : []);
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({
        project_id: 144,
        applicant_userid: "LuShuMing",
        envelope_ids: [237, 241],
        mixed_title_reason: "急"
      })
    });
    expect(response.status).toBe(400);
  });

  it("全部未识别不算混合：单条信封可创建，批次抬头与理由都为 null", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope") ? [envelopeRow({ id: 1, amount: 10 })] : [];
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({ project_id: 144, applicant_userid: "LuShuMing", envelope_ids: [1] })
    });
    expect(response.status).toBe(201);
    const insert = db.executed.find((item) => item.sql.includes("INSERT INTO reimbursement_batch"));
    const columns =
      insert?.sql
        .match(/\(([^)]*)\)\s*VALUES/)?.[1]
        .split(",")
        .map((s) => s.trim()) ?? [];
    const literalsBefore = (index: number) =>
      ["status", "ai_audit_status"].filter((col) => columns.indexOf(col) < index).length;
    const titleIndex = columns.indexOf("invoice_title_entity_id");
    const bindIndex = titleIndex - literalsBefore(titleIndex);
    expect(insert?.params.slice(bindIndex, bindIndex + 2)).toEqual([null, null]);
  });

  it("抬头一致：批次落库该主体 id，混合理由为 null", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) =>
      sql.includes("FROM reimbursement_envelope")
        ? [
            envelopeRow({
              id: 1,
              amount: 10,
              invoice_title_entity_id: 11,
              invoice_title_name: "北京鑫丰畅建设有限公司"
            }),
            envelopeRow({
              id: 2,
              amount: 20,
              invoice_title_entity_id: 11,
              invoice_title_name: "北京鑫丰畅建设有限公司"
            })
          ]
        : [];
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({ project_id: 144, applicant_userid: "LuShuMing", envelope_ids: [1, 2] })
    });
    expect(response.status).toBe(201);
    const insert = db.executed.find((item) => item.sql.includes("INSERT INTO reimbursement_batch"));
    const columns =
      insert?.sql
        .match(/\(([^)]*)\)\s*VALUES/)?.[1]
        .split(",")
        .map((s) => s.trim()) ?? [];
    const literalsBefore = (index: number) =>
      ["status", "ai_audit_status"].filter((col) => columns.indexOf(col) < index).length;
    const titleIndex = columns.indexOf("invoice_title_entity_id");
    const bindIndex = titleIndex - literalsBefore(titleIndex);
    expect(insert?.params.slice(bindIndex, bindIndex + 2)).toEqual([11, null]);
  });

  it("混抬头带理由：批次抬头为 null，理由落库", async () => {
    const db = new FakeDb();
    db.allHandler = (sql) => (sql.includes("FROM reimbursement_envelope") ? mixedEnvelopes : []);
    const response = await request(db, "/reimbursement/batch", {
      method: "POST",
      body: JSON.stringify({
        project_id: 144,
        applicant_userid: "LuShuMing",
        envelope_ids: [237, 241],
        mixed_title_reason: "两家公司合并报销测试"
      })
    });
    expect(response.status).toBe(201);
    const insert = db.executed.find((item) => item.sql.includes("INSERT INTO reimbursement_batch"));
    const columns =
      insert?.sql
        .match(/\(([^)]*)\)\s*VALUES/)?.[1]
        .split(",")
        .map((s) => s.trim()) ?? [];
    const literalsBefore = (index: number) =>
      ["status", "ai_audit_status"].filter((col) => columns.indexOf(col) < index).length;
    const titleIndex = columns.indexOf("invoice_title_entity_id");
    const bindIndex = titleIndex - literalsBefore(titleIndex);
    expect(insert?.params.slice(bindIndex, bindIndex + 2)).toEqual([null, "两家公司合并报销测试"]);
  });
});
