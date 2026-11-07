import { describe, expect, it } from "vitest";

import { createReimbursementHarness, hasSqlite } from "./helpers/reimbursement-harness";

describe.skipIf(!hasSqlite)("报销真实 SQL 测试工具", () => {
  it("跑完全部迁移后能写入和批量回滚", async () => {
    const h = createReimbursementHarness();
    const id = await h.seedEnvelope({ status: "draft", amount: 100 });
    const bad = h.env.DB.prepare("INSERT INTO no_such_table VALUES (1)");
    const ok = h.env.DB.prepare("UPDATE reimbursement_envelope SET amount = 1 WHERE id = ?").bind(id);
    await expect(h.env.DB.batch([ok, bad])).rejects.toThrow();
    const row = await h.env.DB.prepare("SELECT amount FROM reimbursement_envelope WHERE id = ?")
      .bind(id)
      .first();
    expect(row.amount).toBe(100);
  });

  it("run 返回 last_row_id 和 changes，first 查不到时返回 null", async () => {
    const h = createReimbursementHarness();
    const id = await h.seedEnvelope({ status: "draft" });
    const result = await h.env.DB.prepare("UPDATE reimbursement_envelope SET amount = 2 WHERE id = ?")
      .bind(id)
      .run();
    expect(result.meta.changes).toBe(1);
    const missing = await h.env.DB.prepare("SELECT id FROM reimbursement_envelope WHERE id = ?")
      .bind(id + 100)
      .first();
    expect(missing).toBeNull();
  });

  it("drainQueue 把事件交给真实消费者，消费后队列变空", async () => {
    const h = createReimbursementHarness();
    await h.env.EVENT_QUEUE.send({
      type: "TASK_COMPLETED",
      source: "test",
      payload: { task_id: 0 },
      timestamp: new Date().toISOString()
    });
    const drained = await h.drainQueue();
    expect(drained).toEqual({ acked: 1, retried: 0 });
    expect(await h.drainQueue()).toEqual({ acked: 0, retried: 0 });
  });

  it("FILES.head 只认测试预置的文件", async () => {
    const h = createReimbursementHarness();
    h.putFile("reimbursement/a.pdf", 123);
    expect((await h.env.FILES.head("reimbursement/a.pdf")).size).toBe(123);
    expect(await h.env.FILES.head("reimbursement/b.pdf")).toBeNull();
  });
});
