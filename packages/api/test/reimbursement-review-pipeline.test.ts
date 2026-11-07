import { describe, expect, it } from "vitest";

import { createTaskWithCompanions } from "../src/services/ai-slot";
import { ensureInvoiceReviews } from "../src/services/reimbursement/review-pipeline";
import {
  createMigratedDatabase,
  createReimbursementHarness,
  hasSqlite,
  readMigration
} from "./helpers/reimbursement-harness";

const seedWithAttachments = async (h, count = 2, fields = {}) => {
  const envelopeId = await h.seedEnvelope({ status: "submitted", amount: 100, ...fields });
  const attachmentIds = [];
  for (let index = 0; index < count; index += 1) {
    attachmentIds.push(await h.seedAttachment(envelopeId));
  }
  return { envelopeId, attachmentIds };
};

const insertReviewRow = (h, envelopeId, attachmentId, round, status = "pending") => {
  const now = new Date().toISOString();
  h.db
    .prepare(
      `INSERT INTO reimbursement_invoice_review
        (envelope_id, attachment_id, review_round, channel, task_status, created_at, updated_at)
       VALUES (?, ?, ?, 'electronic', ?, ?, ?)`
    )
    .run(envelopeId, attachmentId, round, status, now, now);
};

describe.skipIf(!hasSqlite)("ensureInvoiceReviews", () => {
  it("每个有效附件恰好一个任务一条识别行", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 2);
    await h.seedAttachment(envelopeId, { status: "deleted" });

    const result = await ensureInvoiceReviews(h.env, envelopeId);

    expect(result.created).toBe(2);
    expect(result.round).toBe(1);
    expect(h.listTasks("ocr_extract")).toHaveLength(2);
    const reviews = h.listReviews(envelopeId);
    expect(reviews.map((row) => row.attachment_id)).toEqual(attachmentIds);
    expect(reviews.every((row) => row.task_id !== null && row.task_status === "pending")).toBe(true);
    const envelope = h.getEnvelope(envelopeId);
    expect(envelope.ocr_status).toBe("pending");
    expect(envelope.ocr_task_id).toBe(result.latestTaskId);
    const payload = JSON.parse(h.listTasks("ocr_extract")[0].payload_json);
    expect(payload).toMatchObject({ envelope_id: envelopeId, attachment_id: attachmentIds[0], channel: "electronic" });
  });

  it("重复调用不多建", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedWithAttachments(h, 2);
    await ensureInvoiceReviews(h.env, envelopeId);
    const second = await ensureInvoiceReviews(h.env, envelopeId);
    expect(second.created).toBe(0);
    expect(h.listTasks("ocr_extract")).toHaveLength(2);
    expect(h.listReviews(envelopeId)).toHaveLength(2);
  });

  it("只补缺失的附件", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedWithAttachments(h, 1);
    await ensureInvoiceReviews(h.env, envelopeId);
    await h.seedAttachment(envelopeId);
    const second = await ensureInvoiceReviews(h.env, envelopeId);
    expect(second).toMatchObject({ round: 1, created: 1 });
    expect(h.listReviews(envelopeId)).toHaveLength(2);
  });

  it("已有识别行时不建任务", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 1);
    insertReviewRow(h, envelopeId, attachmentIds[0], 1);
    const result = await ensureInvoiceReviews(h.env, envelopeId);
    expect(result.created).toBe(0);
    expect(h.listTasks("ocr_extract")).toHaveLength(0);
  });

  it("failed 行不自动重建", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedWithAttachments(h, 1);
    await ensureInvoiceReviews(h.env, envelopeId);
    h.db.prepare("UPDATE reimbursement_invoice_review SET task_status = 'failed'").run();
    const again = await ensureInvoiceReviews(h.env, envelopeId);
    expect(again.created).toBe(0);
    expect(h.listTasks("ocr_extract")).toHaveLength(1);
  });

  it("forceNewRound 开新一轮并全部新建", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedWithAttachments(h, 2);
    await ensureInvoiceReviews(h.env, envelopeId);
    const result = await ensureInvoiceReviews(h.env, envelopeId, { forceNewRound: true });
    expect(result).toMatchObject({ round: 2, created: 2 });
    expect(h.listTasks("ocr_extract")).toHaveLength(4);
  });

  it("已废止和已删除的单不建任务", async () => {
    const h = createReimbursementHarness();
    for (const status of ["cancelled", "deleted"]) {
      const { envelopeId } = await seedWithAttachments(h, 1, { status });
      expect((await ensureInvoiceReviews(h.env, envelopeId)).created).toBe(0);
    }
    expect(h.listTasks("ocr_extract")).toHaveLength(0);
  });
});

describe.skipIf(!hasSqlite)("createTaskWithCompanions", () => {
  const baseRequest = (biz_id) => ({
    task_type: "ocr_extract",
    biz_type: "reimbursement_envelope",
    biz_id,
    priority: 5,
    payload: { envelope_id: biz_id },
    timeout_seconds: 300
  });

  const reviewInsert = (h, envelopeId, attachmentId, round) => (taskCode) => {
    const now = new Date().toISOString();
    return [
      h.env.DB.prepare(
        `INSERT INTO reimbursement_invoice_review
          (envelope_id, attachment_id, review_round, channel, task_id, task_status, created_at, updated_at)
         VALUES (?, ?, ?, 'electronic', (SELECT id FROM task_queue WHERE task_code = ?), 'pending', ?, ?)`
      ).bind(envelopeId, attachmentId, round, taskCode, now, now)
    ];
  };

  it("任务和附带语句一起写入", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 1);
    const task = await createTaskWithCompanions(
      h.env,
      baseRequest(envelopeId),
      reviewInsert(h, envelopeId, attachmentIds[0], 1)
    );
    expect(task.status).toBe("pending");
    expect(h.listReviews(envelopeId)[0].task_id).toBe(task.id);
    expect(h.listSentEvents().map((event) => event.type)).toContain("TASK_CREATED");
  });

  it("附带语句撞唯一约束时任务也不留下", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 1);
    insertReviewRow(h, envelopeId, attachmentIds[0], 1);
    const task = await createTaskWithCompanions(
      h.env,
      baseRequest(envelopeId),
      reviewInsert(h, envelopeId, attachmentIds[0], 1)
    );
    expect(task).toBeNull();
    expect(h.listTasks()).toHaveLength(0);
    expect(h.listReviews(envelopeId)).toHaveLength(1);
  });

  it("task_code 撞唯一约束时换一个再试", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 1);
    // COUNT+1 会算出 0002，正好被占用
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const now = d.toISOString();
    h.db
      .prepare(
        `INSERT INTO task_queue (task_code, task_type, biz_type, biz_id, payload_json, status, created_at, updated_at)
         VALUES (?, 'ocr_extract', 'other', 1, '{}', 'completed', ?, ?)`
      )
      .run(`TK-${date}-0002`, now, now);
    const task = await createTaskWithCompanions(
      h.env,
      baseRequest(envelopeId),
      reviewInsert(h, envelopeId, attachmentIds[0], 1)
    );
    expect(task.task_code).not.toBe(`TK-${date}-0002`);
    expect(h.listReviews(envelopeId)[0].task_id).toBe(task.id);
  });

  it("其他错误原样抛出，也不留下任务", async () => {
    const h = createReimbursementHarness();
    await expect(
      createTaskWithCompanions(h.env, baseRequest(1), () => [h.env.DB.prepare("INSERT INTO no_such_table VALUES (1)")])
    ).rejects.toThrow(/no_such_table/);
    expect(h.listTasks()).toHaveLength(0);
  });
});

describe.skipIf(!hasSqlite)("迁移 0092", () => {
  it("把同轮重复行挪走且不丢数据", async () => {
    const database = createMigratedDatabase({ stopBefore: "0092" });
    const h = createReimbursementHarness({ database });
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, 1);
    insertReviewRow(h, envelopeId, attachmentIds[0], 1, "failed");
    insertReviewRow(h, envelopeId, attachmentIds[0], 1, "completed");
    const before = h.listReviews(envelopeId);

    database.exec(readMigration("0092_reimbursement_review_unique.sql"));

    const after = h.listReviews(envelopeId);
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.id === before[1].id).review_round).toBe(1);
    expect(after.find((row) => row.id === before[0].id).review_round).toBe(-before[0].id);
    expect(() => insertReviewRow(h, envelopeId, attachmentIds[0], 1)).toThrow(/UNIQUE/);
  });
});
