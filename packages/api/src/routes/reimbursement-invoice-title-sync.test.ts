import { describe, expect, it } from "vitest";

import { syncEnvelopeInvoiceTitle } from "./reimbursement-invoice-title-sync";

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
  async all<T>(): Promise<{ results: T[] }> {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { results: this.db.entities as T[] };
  }
  async run() {
    this.db.executed.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1, last_row_id: 0 } };
  }
}

class FakeDb {
  executed: Executed[] = [];
  entities: Array<{ id: number; entity_name: string; status: string }> = [
    { id: 11, entity_name: "北京鑫丰畅建设有限公司", status: "active" }
  ];
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
}

const asD1 = (db: FakeDb) => db as unknown as D1Database;

describe("syncEnvelopeInvoiceTitle", () => {
  it("有抬头且未手工指定：查主体并写入三列，带 manual 守卫", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: null,
      currentName: null,
      currentSource: null,
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0,
      completedCount: 1
    });
    expect(update).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
    const write = db.executed.find((item) => item.sql.includes("UPDATE reimbursement_envelope"));
    expect(write?.sql).toContain("invoice_title_entity_id = ?");
    expect(write?.sql).toContain("!= 'manual'");
    expect(write?.sql).toContain("WHERE id = ?");
    expect(write?.params).toEqual([11, "北京鑫丰畅建设有限公司", "ocr", 237]);
    const entityQuery = db.executed.find((item) => item.sql.includes("FROM entity"));
    expect(entityQuery?.sql).toContain("status = 'active'");
  });

  it("手工指定过：不查主体、不写库", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: null,
      currentName: null,
      currentSource: "manual",
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0,
      completedCount: 1
    });
    expect(update).toBeNull();
    expect(db.executed).toHaveLength(0);
  });

  it("识别仍在进行：不写库", async () => {
    const db = new FakeDb();
    await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: null,
      currentName: null,
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 1,
      completedCount: 0
    });
    expect(db.executed).toHaveLength(0);
  });

  it("全部完成且无抬头：清空三列（不查主体）", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: 6,
      currentName: "廊坊市丰畅市政工程有限公司",
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 0,
      completedCount: 1
    });
    expect(update).toEqual({ entityId: null, name: null, source: null });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].params).toEqual([null, null, null, 237]);
  });

  it("已成批/审批中/已付款的信封：不查主体、不写库", async () => {
    for (const status of ["batched", "pending_approval", "approved", "paid"]) {
      const db = new FakeDb();
      const update = await syncEnvelopeInvoiceTitle(asD1(db), {
        envelopeId: 237,
        currentStatus: status,
        currentEntityId: null,
        currentName: null,
        currentSource: null,
        buyerName: "北京鑫丰畅建设有限公司",
        pendingCount: 0,
        completedCount: 1
      });
      expect(update).toBeNull();
      expect(db.executed).toHaveLength(0);
    }
  });

  it("本轮全部失败：不清空已有抬头", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: 11,
      currentName: "北京鑫丰畅建设有限公司",
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 0,
      completedCount: 0
    });
    expect(update).toBeNull();
    expect(db.executed).toHaveLength(0);
  });

  it("识别结果与已存值相同：只查主体、不写库", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: 11,
      currentName: "北京鑫丰畅建设有限公司",
      currentSource: "ocr",
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0,
      completedCount: 1
    });
    expect(update).toBeNull();
    expect(db.executed.some((item) => item.sql.includes("UPDATE"))).toBe(false);
  });

  it("识别结果变化：覆盖旧的 ocr 值", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentStatus: "received",
      currentEntityId: 6,
      currentName: "廊坊市丰畅市政工程有限公司",
      currentSource: "ocr",
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0,
      completedCount: 1
    });
    expect(update).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
    const write = db.executed.find((item) => item.sql.includes("UPDATE reimbursement_envelope"));
    expect(write?.params).toEqual([11, "北京鑫丰畅建设有限公司", "ocr", 237]);
  });
});
