import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reimbursementRoutes } from "../src/routes/reimbursement";
import { reconcileReimbursementReviews } from "../src/services/reimbursement/review-reconcile";
import { createReimbursementHarness, hasSqlite } from "./helpers/reimbursement-harness";

const mockAuth = vi.hoisted(() => ({
  payload: {
    sub: "u1",
    username: "u1",
    nickname: "U1",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  }
}));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => mockAuth.payload
}));

const submit = (h, id, { body = {}, idempotencyKey } = {}) => {
  const app = new Hono();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    `/reimbursement/${id}/submit`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: JSON.stringify(body)
    },
    h.env
  );
};

const seedDraft = async (h, count = 2, fields = {}) => {
  const id = await h.seedEnvelope({ status: "draft", amount: 100, ...fields });
  const attachmentIds = [];
  for (let index = 0; index < count; index += 1) {
    attachmentIds.push(await h.seedAttachment(id));
  }
  return { id, attachmentIds };
};

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const createHarness = () => {
  const h = createReimbursementHarness();
  h.env.KV.get = async () => "session";
  return h;
};

describe.skipIf(!hasSqlite)("报销提交链路", () => {
  beforeEach(() => {
    mockAuth.payload = { ...mockAuth.payload, sub: "u1", roles: ["operator"] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok"))
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("提交请求不建任务", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h);
    const response = await submit(h, id);
    expect(response.status).toBe(200);
    expect(h.listTasks()).toHaveLength(0);
    expect(h.listSentEvents().map((event) => event.type)).toContain("REIMBURSEMENT_ENVELOPE_SUBMITTED");
    const submitted = h.listSentEvents().find((event) => event.type === "REIMBURSEMENT_ENVELOPE_SUBMITTED");
    expect(submitted.payload).toMatchObject({ envelope_id: id, submitted_by: "u1" });
    expect(h.getEnvelope(id)).toMatchObject({
      status: "submitted",
      precheck_status: "pending",
      duplicate_check_status: "pending"
    });
  });

  it("发事件失败提交仍成功", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h);
    h.setQueueSendFailure(true);
    h.db.exec("DROP TABLE event_log");
    const response = await submit(h, id);
    expect(response.status).toBe(200);
    expect(h.getEnvelope(id).status).toBe("submitted");
  });

  it("队列消费后每个附件都有任务", async () => {
    const h = createHarness();
    const { id, attachmentIds } = await seedDraft(h, 30);
    await submit(h, id);
    await h.drainQueue();
    expect(h.listTasks("ocr_extract")).toHaveLength(30);
    expect(h.listReviews(id).map((row) => row.attachment_id)).toEqual(attachmentIds);
    expect(h.getEnvelope(id).ocr_status).toBe("pending");
    expect(fetch).toHaveBeenCalled();
  });

  it("队列重投不多建", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 3);
    await submit(h, id);
    const events = h.listSentEvents();
    await h.drainQueue();
    for (const event of events) await h.env.EVENT_QUEUE.send(event);
    await h.drainQueue();
    expect(h.listTasks("ocr_extract")).toHaveLength(3);
    expect(h.listReviews(id)).toHaveLength(3);
  });

  it("提交中断后 Cron 补齐", async () => {
    const h = createHarness();
    const { id, attachmentIds } = await seedDraft(h, 3);
    h.db.prepare("UPDATE reimbursement_envelope SET status = 'submitted' WHERE id = ?").run(id);
    const result = await reconcileReimbursementReviews(h.env);
    expect(result.ensured).toBe(1);
    expect(h.listReviews(id).map((row) => row.attachment_id)).toEqual(attachmentIds);
    expect(h.listReviews(id).every((row) => row.task_id !== null)).toBe(true);
  });

  it("只建了一部分时 Cron 只补缺的", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1);
    h.db.prepare("UPDATE reimbursement_envelope SET status = 'submitted' WHERE id = ?").run(id);
    await reconcileReimbursementReviews(h.env);
    await h.seedAttachment(id);
    await reconcileReimbursementReviews(h.env);
    expect(h.listTasks("ocr_extract")).toHaveLength(2);
  });

  it("Cron 不碰老草稿", async () => {
    const h = createHarness();
    const old = await seedDraft(h, 1);
    h.db.prepare("UPDATE envelope_attachment SET created_at = ? WHERE envelope_id = ?").run(hoursAgo(48), old.id);
    const fresh = await seedDraft(h, 1);
    h.db.prepare("UPDATE envelope_attachment SET created_at = ? WHERE envelope_id = ?").run(hoursAgo(1), fresh.id);
    await reconcileReimbursementReviews(h.env);
    expect(h.listReviews(old.id)).toHaveLength(0);
    expect(h.listReviews(fresh.id)).toHaveLength(1);
  });

  it("Cron 不碰已复核通过、已成批和没有文件的附件", async () => {
    const h = createHarness();
    const approved = await seedDraft(h, 1, { status: "received", precheck_status: "approved" });
    const batched = await seedDraft(h, 1, { status: "received", batch_id: 9 });
    const blank = await h.seedEnvelope({ status: "submitted" });
    await h.seedAttachment(blank, { file_key: " " });
    const result = await reconcileReimbursementReviews(h.env);
    expect(result.ensured).toBe(0);
    expect(h.listReviews(approved.id)).toHaveLength(0);
    expect(h.listReviews(batched.id)).toHaveLength(0);
    expect(h.listTasks()).toHaveLength(0);
  });

  it("Cron 每次最多处理 limit 单", async () => {
    const h = createHarness();
    for (let index = 0; index < 3; index += 1) {
      await seedDraft(h, 1, { status: "submitted" });
    }
    const result = await reconcileReimbursementReviews(h.env, 2);
    expect(result.ensured).toBe(2);
    expect(h.listTasks("ocr_extract")).toHaveLength(2);
  });

  it("Cron 同步任务已结束的单", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1, { status: "submitted" });
    await reconcileReimbursementReviews(h.env);
    const [row] = h.listReviews(id);
    await h.finishTask(row.task_id, "completed", { amount_with_tax: 100 });
    const result = await reconcileReimbursementReviews(h.env);
    expect(result.synced).toBe(1);
    expect(h.listReviews(id)[0]).toMatchObject({ task_status: "completed", invoice_amount: 100 });
    expect((await reconcileReimbursementReviews(h.env)).synced).toBe(0);
  });

  it("Cron 不被旧轮次的残留行卡住", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1, { status: "submitted" });
    await reconcileReimbursementReviews(h.env);
    const [row] = h.listReviews(id);
    await h.finishTask(row.task_id, "completed", { amount_with_tax: 100 });
    h.db.prepare("UPDATE reimbursement_invoice_review SET review_round = 1").run();
    const now = new Date().toISOString();
    h.db
      .prepare(
        `INSERT INTO reimbursement_invoice_review
          (envelope_id, attachment_id, review_round, channel, task_id, task_status, created_at, updated_at)
         VALUES (?, ?, 2, 'electronic', NULL, 'pending', ?, ?)`
      )
      .run(id, row.attachment_id, now, now);
    expect((await reconcileReimbursementReviews(h.env)).synced).toBe(0);
  });

  it("Cron 里一单出错不影响其他单，也不抛出", async () => {
    const h = createHarness();
    await seedDraft(h, 1, { status: "submitted" });
    const realPrepare = h.env.DB.prepare;
    h.env.DB.prepare = (sql) => {
      if (sql.includes("FROM reimbursement_envelope e")) throw new Error("boom");
      return realPrepare(sql);
    };
    await expect(reconcileReimbursementReviews(h.env)).resolves.toEqual({ ensured: 0, synced: 0 });
  });

  it("TASK_COMPLETED 触发同步", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1);
    await submit(h, id);
    await h.drainQueue();
    const [row] = h.listReviews(id);
    await h.finishTask(row.task_id, "completed", { amount_with_tax: 100 });
    await h.env.EVENT_QUEUE.send({
      type: "TASK_COMPLETED",
      source: "ai-slot",
      payload: { task_id: row.task_id, task_type: "ocr_extract", biz_type: "reimbursement_envelope", biz_id: id },
      timestamp: new Date().toISOString()
    });
    await h.drainQueue();
    expect(h.listReviews(id)[0].task_status).toBe("completed");
    expect(h.getEnvelope(id).ocr_status).toBe("completed");
    expect(h.getEnvelope(id).duplicate_check_status).toBe("completed");
  });

  describe("旧路径 PUT 传附件", () => {
    const put = (h, id, attachments) => {
      const app = new Hono();
      app.route("/reimbursement", reimbursementRoutes);
      return app.request(
        `/reimbursement/${id}`,
        {
          method: "PUT",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ attachments })
        },
        h.env
      );
    };
    const file = { file_key: "reimbursement/new.pdf", file_name: "new.pdf", attachment_type: "invoice" };

    it.each(["supplement", "rejected"])("把 %s 的单交回办公室", async (precheck_status) => {
      const h = createHarness();
      const { id } = await seedDraft(h, 1, { status: "submitted", precheck_status });
      const response = await put(h, id, [file]);
      expect(response.status).toBe(200);
      expect(h.getEnvelope(id).precheck_status).toBe("pending");
      expect(h.listTasks("ocr_extract")).toHaveLength(2);
      expect(h.listTasks("reimbursement_anomaly")).toHaveLength(0);
    });

    it("已复核通过的单退回待复核", async () => {
      mockAuth.payload = { ...mockAuth.payload, sub: "office", roles: ["finance"] };
      const h = createHarness();
      const { id } = await seedDraft(h, 1, { status: "received", precheck_status: "approved" });
      await put(h, id, [file]);
      expect(h.getEnvelope(id).precheck_status).toBe("pending");
    });

    it("草稿的 precheck_status 不变，也不开新轮", async () => {
      const h = createHarness();
      const { id } = await seedDraft(h, 1, { status: "draft", precheck_status: "none" });
      await put(h, id, [file]);
      expect(h.getEnvelope(id).precheck_status).toBe("none");
      expect(h.listReviews(id).every((row) => row.review_round === 1)).toBe(true);
      expect(h.listReviews(id)).toHaveLength(2);
    });
  });

  describe("重新提交", () => {
    const seedReturned = async (h, precheck_status) => {
      const seeded = await seedDraft(h, 1, {
        status: "submitted",
        precheck_status,
        precheck_comment: "请补发票",
        verification_status: "mismatch"
      });
      return seeded;
    };

    it.each(["supplement", "rejected"])("%s 的单重新提交回到办公室", async (precheck_status) => {
      const h = createHarness();
      const { id } = await seedReturned(h, precheck_status);
      const response = await submit(h, id);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data).toEqual({ id, status: "submitted", resubmitted: true });
      expect(h.getEnvelope(id)).toMatchObject({
        status: "submitted",
        precheck_status: "pending",
        verification_status: "pending"
      });
      const audit = h.db
        .prepare("SELECT * FROM api_audit_log WHERE action = 'reimbursement.envelope.resubmit' AND target_id = ?")
        .get(String(id));
      expect(audit).toBeTruthy();
      expect(audit.actor_userid).toBe("u1");
      const event = h.listSentEvents().find((item) => item.type === "REIMBURSEMENT_ENVELOPE_SUBMITTED");
      expect(event.payload.envelope_id).toBe(id);
    });

    it("重新提交后消费队列会补上新加附件的识别", async () => {
      const h = createHarness();
      const { id } = await seedReturned(h, "supplement");
      await submit(h, id);
      await h.drainQueue();
      expect(h.listReviews(id)).toHaveLength(1);
    });

    it("普通已提交的单仍返回 already_submitted", async () => {
      const h = createHarness();
      const { id } = await seedDraft(h, 1, { status: "submitted", precheck_status: "pending", verification_status: "verified" });
      const response = await submit(h, id);
      const payload = await response.json();
      expect(payload.data).toMatchObject({ already_submitted: true });
      expect(payload.data.resubmitted).toBeUndefined();
      expect(h.getEnvelope(id).verification_status).toBe("verified");
      expect(h.listSentEvents()).toHaveLength(0);
    });

    it("重新提交也要过查重", async () => {
      const h = createHarness();
      const now = new Date().toISOString();
      const other = await h.seedEnvelope({ status: "submitted", invoice_no: "DUP", amount: 9, created_at: now });
      expect(other).toBeGreaterThan(0);
      const { id } = await seedDraft(h, 1, {
        status: "submitted",
        precheck_status: "supplement",
        invoice_no: "DUP",
        amount: 500
      });
      const response = await submit(h, id);
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.data.require_force_submit).toBe(true);
      expect(h.getEnvelope(id).precheck_status).toBe("supplement");

      const forced = await submit(h, id, { body: { force_submit: true, force_submit_reason: "确认不是重复" } });
      expect(forced.status).toBe(200);
      expect(h.getEnvelope(id)).toMatchObject({
        precheck_status: "pending",
        duplicate_override_requested: 1,
        duplicate_override_reason: "确认不是重复"
      });
    });

    it("重新提交时没有附件要先传", async () => {
      const h = createHarness();
      const id = await h.seedEnvelope({ status: "submitted", precheck_status: "supplement" });
      const response = await submit(h, id);
      expect(response.status).toBe(400);
      expect(h.getEnvelope(id).precheck_status).toBe("supplement");
    });

    it("同一个 Key 重放返回同样结果，不再改状态", async () => {
      const h = createHarness();
      const { id } = await seedReturned(h, "supplement");
      await submit(h, id, { idempotencyKey: "re-1" });
      h.db.prepare("UPDATE reimbursement_envelope SET precheck_status = 'supplement' WHERE id = ?").run(id);
      const replay = await submit(h, id, { idempotencyKey: "re-1" });
      const payload = await replay.json();
      expect(payload.data.resubmitted).toBe(true);
      expect(h.getEnvelope(id).precheck_status).toBe("supplement");
    });

    it("被退回的单中断后用同一个 Key 重试，真正完成重新提交", async () => {
      const h = createHarness();
      const { id } = await seedReturned(h, "supplement");
      const now = new Date().toISOString();
      h.db
        .prepare(
          `INSERT INTO api_idempotency_request (scope, actor_key, idempotency_key, status, created_at, updated_at)
           VALUES (?, 'u1', 're-2', 'pending', ?, ?)`
        )
        .run(`reimbursement:submit:${id}`, now, now);
      const response = await submit(h, id, { idempotencyKey: "re-2" });
      expect(response.status).toBe(200);
      expect((await response.json()).data.resubmitted).toBe(true);
      expect(h.getEnvelope(id).precheck_status).toBe("pending");
    });
  });

  it("提交被中断后同一个 Idempotency-Key 重试成功", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1, { status: "submitted", precheck_status: "pending" });
    const now = new Date().toISOString();
    h.db
      .prepare(
        `INSERT INTO api_idempotency_request (scope, actor_key, idempotency_key, status, created_at, updated_at)
         VALUES (?, 'u1', 'key-1', 'pending', ?, ?)`
      )
      .run(`reimbursement:submit:${id}`, now, now);
    const response = await submit(h, id, { idempotencyKey: "key-1" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toMatchObject({ id, status: "submitted", already_submitted: true });
    const row = h.db.prepare("SELECT status FROM api_idempotency_request WHERE idempotency_key = 'key-1'").get();
    expect(row.status).toBe("completed");
  });

  it("没有提交成功时同一个 Key 仍返回 409", async () => {
    const h = createHarness();
    const { id } = await seedDraft(h, 1);
    const now = new Date().toISOString();
    h.db
      .prepare(
        `INSERT INTO api_idempotency_request (scope, actor_key, idempotency_key, status, created_at, updated_at)
         VALUES (?, 'u1', 'key-2', 'pending', ?, ?)`
      )
      .run(`reimbursement:submit:${id}`, now, now);
    const response = await submit(h, id, { idempotencyKey: "key-2" });
    expect(response.status).toBe(409);
  });
});
