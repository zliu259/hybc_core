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
      currentSource: null,
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0
    });
    expect(update).toEqual({ entityId: 11, name: "北京鑫丰畅建设有限公司", source: "ocr" });
    const write = db.executed.find((item) => item.sql.includes("UPDATE reimbursement_envelope"));
    expect(write?.sql).toContain("invoice_title_entity_id = ?");
    expect(write?.sql).toContain("!= 'manual'");
    expect(write?.params).toEqual([11, "北京鑫丰畅建设有限公司", "ocr", 237]);
  });

  it("手工指定过：不查主体、不写库", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "manual",
      buyerName: "北京鑫丰畅建设有限公司",
      pendingCount: 0
    });
    expect(update).toBeNull();
    expect(db.executed).toHaveLength(0);
  });

  it("识别仍在进行：不写库", async () => {
    const db = new FakeDb();
    await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 1
    });
    expect(db.executed).toHaveLength(0);
  });

  it("全部完成且无抬头：清空三列（不查主体）", async () => {
    const db = new FakeDb();
    const update = await syncEnvelopeInvoiceTitle(asD1(db), {
      envelopeId: 237,
      currentSource: "ocr",
      buyerName: null,
      pendingCount: 0
    });
    expect(update).toEqual({ entityId: null, name: null, source: null });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].params).toEqual([null, null, null, 237]);
  });
});
