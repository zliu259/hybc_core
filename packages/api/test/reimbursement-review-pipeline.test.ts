import { describe, expect, it } from "vitest";

import { createTaskWithCompanions } from "../src/services/ai-slot";
import { ensureInvoiceReviews, syncEnvelopeAuditState } from "../src/services/reimbursement/review-pipeline";
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

describe.skipIf(!hasSqlite)("syncEnvelopeAuditState", () => {
  const seedRecognized = async (h, amounts, fields = {}) => {
    const { envelopeId, attachmentIds } = await seedWithAttachments(h, amounts.length, fields);
    await ensureInvoiceReviews(h.env, envelopeId);
    const reviews = h.listReviews(envelopeId);
    for (let index = 0; index < amounts.length; index += 1) {
      if (amounts[index] === undefined) continue;
      await h.finishTask(reviews[index].task_id, "completed", { amount_with_tax: amounts[index], invoice_no: `N${index}` });
    }
    await syncEnvelopeAuditState(h.env, envelopeId);
    return { envelopeId, attachmentIds, reviews };
  };

  const silentReview = (h, envelopeId) => JSON.parse(h.getEnvelope(envelopeId).silent_review_result);

  it("删除附件后合计和结论更新", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedRecognized(h, [100, 50], { amount: 100 });
    expect(silentReview(h, envelopeId).amount_consistency.extracted_total).toBe(150);
    expect(silentReview(h, envelopeId).amount_consistency.mismatch).toBe(true);

    h.db.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?").run(attachmentIds[1]);
    await syncEnvelopeAuditState(h.env, envelopeId);

    const review = silentReview(h, envelopeId);
    expect(review.amount_consistency.extracted_total).toBe(100);
    expect(review.amount_consistency.mismatch).toBe(false);
    expect(review.invoice_review.total).toBe(1);
  });

  it("结论不再冻结，AI 合理性结果保留", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedRecognized(h, [100], { amount: 100 });
    const stored = { ...silentReview(h, envelopeId), ai_reasonability: { summary: "合理" }, ai_reasonability_summary: "合理" };
    h.db.prepare("UPDATE reimbursement_envelope SET silent_review_result = ? WHERE id = ?").run(JSON.stringify(stored), envelopeId);

    await h.seedAttachment(envelopeId);
    await ensureInvoiceReviews(h.env, envelopeId);
    const added = h.listReviews(envelopeId)[1];
    await h.finishTask(added.task_id, "completed", { amount_with_tax: 20 });
    await syncEnvelopeAuditState(h.env, envelopeId);

    const review = silentReview(h, envelopeId);
    expect(review.invoice_review.total).toBe(2);
    expect(review.amount_consistency.extracted_total).toBe(120);
    expect(review.summary).toContain("不一致");
    expect(review.ai_reasonability).toEqual({ summary: "合理" });
    expect(review.ai_reasonability_summary).toBe("合理");
  });

  it("有附件没有识别行时 ocr_status 是 pending", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedRecognized(h, [100], { amount: 100 });
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("completed");
    await h.seedAttachment(envelopeId);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("pending");
    expect(h.getEnvelope(envelopeId).duplicate_check_status).toBe("pending");
  });

  it("没读全不报金额不一致", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, reviews } = await seedRecognized(h, [100, undefined], { amount: 300 });
    await h.finishTask(reviews[1].task_id, "completed", { raw_text_summary: "手写收据" });
    await syncEnvelopeAuditState(h.env, envelopeId);
    const review = silentReview(h, envelopeId);
    expect(review.summary).not.toContain("不一致");
    expect(review.amount_consistency.mismatch).toBe(false);
    expect(review.amount_consistency.conclusion).not.toContain("不一致");
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("completed");
  });

  it("全部读出且一致时结论不提不一致", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedRecognized(h, [100], { amount: 100 });
    const review = silentReview(h, envelopeId);
    expect(review.summary).not.toContain("不一致");
    expect(review.amount_consistency).toMatchObject({ delta: 0, mismatch: false, conclusion: "票据合计与申报金额一致" });
  });

  it("差额的符号保持申报减票面", async () => {
    const h = createReimbursementHarness();
    const { envelopeId } = await seedRecognized(h, [100], { amount: 90 });
    expect(silentReview(h, envelopeId).amount_consistency.delta).toBe(-10);
  });

  it("有重试额度的 timeout 不标 failed", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, reviews } = await seedRecognized(h, [undefined], { amount: 100 });
    h.db.prepare("UPDATE task_queue SET status = 'timeout', retry_count = 1, max_retries = 3 WHERE id = ?").run(reviews[0].task_id);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.listReviews(envelopeId)[0].task_status).not.toBe("failed");
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("pending");
  });

  it("重试用完的 timeout 标 failed", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, reviews } = await seedRecognized(h, [undefined], { amount: 100 });
    h.db.prepare("UPDATE task_queue SET status = 'timeout', retry_count = 3, max_retries = 3 WHERE id = ?").run(reviews[0].task_id);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.listReviews(envelopeId)[0].task_status).toBe("failed");
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("failed");
  });

  it("failed 行的任务后来完成了能写回结果", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, reviews } = await seedRecognized(h, [undefined], { amount: 100 });
    h.db.prepare("UPDATE reimbursement_invoice_review SET task_status = 'failed' WHERE id = ?").run(reviews[0].id);
    await h.finishTask(reviews[0].task_id, "completed", { amount_with_tax: 100, invoice_no: "A1" });
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.listReviews(envelopeId)[0]).toMatchObject({ task_status: "completed", invoice_amount: 100, invoice_no: "A1" });
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("completed");
  });

  it("failed 行的任务被重新排队后回到识别中", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, reviews } = await seedRecognized(h, [undefined], { amount: 100 });
    h.db.prepare("UPDATE reimbursement_invoice_review SET task_status = 'failed' WHERE id = ?").run(reviews[0].id);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.listReviews(envelopeId)[0].task_status).toBe("pending");
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("pending");
  });

  it("全部删除后不再显示识别中或失败", async () => {
    const h = createReimbursementHarness();
    const { envelopeId, attachmentIds } = await seedRecognized(h, [undefined], { amount: 100 });
    h.db.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?").run(attachmentIds[0]);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(h.getEnvelope(envelopeId).ocr_status).toBe("none");
    expect(h.getEnvelope(envelopeId).duplicate_check_status).toBe("completed");
  });
});
