import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureInvoiceReviews,
  syncEnvelopeAuditState
} from "../src/services/reimbursement/review-pipeline";
import { hasSqlite } from "./helpers/reimbursement-harness";
import { callReimbursement, createRouteHarness } from "./helpers/reimbursement-routes";

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

const INVOICE = { invoice_no: "INV001", issue_date: "2026-10-01", amount_with_tax: 100 };

const seedRecognized = async (h, invoices, fields = {}) => {
  const envelopeId = await h.seedEnvelope({ status: "submitted", amount: 300, ...fields });
  const attachmentIds = [];
  for (let index = 0; index < invoices.length; index += 1) {
    attachmentIds.push(await h.seedAttachment(envelopeId));
  }
  await ensureInvoiceReviews(h.env, envelopeId);
  const reviews = h.listReviews(envelopeId);
  for (let index = 0; index < invoices.length; index += 1) {
    await h.finishTask(reviews[index].task_id, "completed", invoices[index]);
  }
  await syncEnvelopeAuditState(h.env, envelopeId);
  return { envelopeId, attachmentIds, reviews };
};

const listDuplicates = (h, envelopeId) =>
  h.db
    .prepare("SELECT * FROM reimbursement_duplicate_check WHERE envelope_id = ? ORDER BY id")
    .all(envelopeId)
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence_json) }));

describe.skipIf(!hasSqlite)("报销查重", () => {
  beforeEach(() => {
    mockAuth.payload = { ...mockAuth.payload, sub: "u1", roles: ["operator"] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok"))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同一单传两次同一张发票能查出", async () => {
    const h = createRouteHarness();
    const { envelopeId, attachmentIds } = await seedRecognized(h, [INVOICE, INVOICE]);
    const duplicates = listDuplicates(h, envelopeId).filter((row) => row.match_type === "same_envelope");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ risk_level: "high", matched_envelope_id: envelopeId });
    expect(duplicates[0].evidence).toMatchObject({
      attachment_id: attachmentIds[0],
      other_attachment_id: attachmentIds[1]
    });
  });

  it("同一单传三次只报两条", async () => {
    const h = createRouteHarness();
    const { envelopeId } = await seedRecognized(h, [INVOICE, INVOICE, INVOICE]);
    expect(listDuplicates(h, envelopeId).filter((row) => row.match_type === "same_envelope")).toHaveLength(2);
  });

  it("同一单里二维码相同也算重复，同一对不重复报", async () => {
    const h = createRouteHarness();
    const scanned = { ...INVOICE, qr_code_text: "same-qr" };
    const { envelopeId } = await seedRecognized(h, [scanned, scanned]);
    expect(listDuplicates(h, envelopeId).filter((row) => row.match_type === "same_envelope")).toHaveLength(1);
    const qrOnly = await seedRecognized(h, [{ qr_code_text: "qr-b" }, { qr_code_text: "qr-b" }]);
    expect(listDuplicates(h, qrOnly.envelopeId).filter((row) => row.match_type === "same_envelope")).toHaveLength(1);
  });

  it("没有发票号的两张不互报", async () => {
    const h = createRouteHarness();
    const { envelopeId } = await seedRecognized(h, [{ amount_with_tax: 100 }, { amount_with_tax: 100 }]);
    expect(listDuplicates(h, envelopeId).filter((row) => row.match_type === "same_envelope")).toHaveLength(0);
  });

  it("已删其中一张后不再报", async () => {
    const h = createRouteHarness();
    const { envelopeId, attachmentIds } = await seedRecognized(h, [INVOICE, INVOICE]);
    h.db.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?").run(attachmentIds[1]);
    await syncEnvelopeAuditState(h.env, envelopeId);
    expect(listDuplicates(h, envelopeId).filter((row) => row.match_type === "same_envelope")).toHaveLength(0);
  });

  it("和已提交的单比", async () => {
    const h = createRouteHarness();
    const other = await seedRecognized(h, [INVOICE], { amount: 7777 });
    const mine = await seedRecognized(h, [INVOICE], { amount: 8888 });
    const [duplicate] = listDuplicates(h, mine.envelopeId).filter((row) => row.match_type === "invoice_no_date");
    expect(duplicate.matched_envelope_id).toBe(other.envelopeId);
    expect(duplicate.evidence.attachment_id).toBe(mine.attachmentIds[0]);
  });

  it("二维码重复也带 attachment_id", async () => {
    const h = createRouteHarness();
    await seedRecognized(h, [{ qr_code_text: "qr-a" }], { amount: 7777 });
    const mine = await seedRecognized(h, [{ qr_code_text: "qr-a" }], { amount: 8888 });
    const [duplicate] = listDuplicates(h, mine.envelopeId).filter((row) => row.match_type === "qr_hash");
    expect(duplicate.evidence.attachment_id).toBe(mine.attachmentIds[0]);
  });

  it("唯一编号重复带上来源附件", async () => {
    const h = createRouteHarness();
    await h.seedEnvelope({ status: "submitted", invoice_unique_no: "U123", amount: 5 });
    const mine = await seedRecognized(h, [{ invoice_unique_no: "U123", amount_with_tax: 100 }], { amount: 9999 });
    const [duplicate] = listDuplicates(h, mine.envelopeId).filter((row) => row.match_type === "exact");
    expect(duplicate.evidence.attachment_id).toBe(mine.attachmentIds[0]);
  });

  describe.each([
    ["draft"],
    ["unregistered"],
    ["cancelled"],
    ["deleted"]
  ])("不和 %s 状态的单比", (status) => {
    it("发票号加日期", async () => {
      const h = createRouteHarness();
      const other = await seedRecognized(h, [INVOICE], { amount: 7777 });
      h.db.prepare("UPDATE reimbursement_envelope SET status = ? WHERE id = ?").run(status, other.envelopeId);
      const mine = await seedRecognized(h, [INVOICE], { amount: 8888 });
      expect(listDuplicates(h, mine.envelopeId)).toHaveLength(0);
    });

    it("二维码", async () => {
      const h = createRouteHarness();
      const other = await seedRecognized(h, [{ qr_code_text: "qr-c" }], { amount: 7777 });
      h.db.prepare("UPDATE reimbursement_envelope SET status = ? WHERE id = ?").run(status, other.envelopeId);
      const mine = await seedRecognized(h, [{ qr_code_text: "qr-c" }], { amount: 8888 });
      expect(listDuplicates(h, mine.envelopeId)).toHaveLength(0);
    });

    it("唯一编号", async () => {
      const h = createRouteHarness();
      await h.seedEnvelope({ status, invoice_unique_no: "U456", amount: 5 });
      const mine = await seedRecognized(h, [{ invoice_unique_no: "U456", amount_with_tax: 100 }], { amount: 9999 });
      expect(listDuplicates(h, mine.envelopeId)).toHaveLength(0);
    });

    it("金额接近", async () => {
      const h = createRouteHarness();
      await h.seedEnvelope({ status, amount: 300, applicant_userid: "u1", expense_date: "2026-10-01" });
      const mine = await seedRecognized(h, [{ amount_with_tax: 300 }], { amount: 300, expense_date: "2026-10-01" });
      expect(listDuplicates(h, mine.envelopeId)).toHaveLength(0);
    });
  });

  it("不和别单已删的附件比", async () => {
    const h = createRouteHarness();
    const other = await seedRecognized(h, [INVOICE], { amount: 7777 });
    h.db.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?").run(other.attachmentIds[0]);
    const mine = await seedRecognized(h, [INVOICE], { amount: 8888 });
    expect(listDuplicates(h, mine.envelopeId)).toHaveLength(0);
  });

  it("两张草稿同发票，后提交的报", async () => {
    const h = createRouteHarness();
    const first = await seedRecognized(h, [INVOICE], { status: "draft", amount: 7777 });
    const second = await seedRecognized(h, [INVOICE], { status: "draft", amount: 8888 });
    const firstResponse = await callReimbursement(h, "POST", `/${first.envelopeId}/submit`, {});
    expect(firstResponse.status).toBe(200);
    const secondResponse = await callReimbursement(h, "POST", `/${second.envelopeId}/submit`, {});
    expect(secondResponse.status).toBe(409);
    const payload = await secondResponse.json();
    expect(payload.data.require_force_submit).toBe(true);
    expect(h.getEnvelope(second.envelopeId).status).toBe("draft");
  });

  it("拆单后两边不互报", async () => {
    const h = createRouteHarness();
    const source = await seedRecognized(h, [INVOICE, { invoice_no: "INV002", issue_date: "2026-10-02", amount_with_tax: 200 }], {
      amount: 300
    });
    const child = await h.seedEnvelope({ status: "submitted", amount: 100, split_from_envelope_id: source.envelopeId });
    h.db.prepare("UPDATE envelope_attachment SET envelope_id = ? WHERE id = ?").run(child, source.attachmentIds[0]);
    h.db.prepare("UPDATE reimbursement_envelope SET amount = 200 WHERE id = ?").run(source.envelopeId);

    await ensureInvoiceReviews(h.env, source.envelopeId, { forceNewRound: true });
    await ensureInvoiceReviews(h.env, child, { forceNewRound: true });
    const sourceReview = h.listReviews(source.envelopeId).at(-1);
    const childReview = h.listReviews(child).at(-1);
    await h.finishTask(sourceReview.task_id, "completed", { invoice_no: "INV002", issue_date: "2026-10-02", amount_with_tax: 200 });
    await h.finishTask(childReview.task_id, "completed", INVOICE);
    await syncEnvelopeAuditState(h.env, source.envelopeId);
    await syncEnvelopeAuditState(h.env, child);

    expect(listDuplicates(h, source.envelopeId)).toHaveLength(0);
    expect(listDuplicates(h, child)).toHaveLength(0);
    expect(h.getEnvelope(source.envelopeId).ocr_status).toBe("completed");
    expect(h.getEnvelope(child).ocr_status).toBe("completed");
    expect(JSON.parse(h.getEnvelope(child).silent_review_result).amount_consistency.extracted_total).toBe(100);
  });

  it("拆单后金额相同的两边也不互报金额接近", async () => {
    const h = createRouteHarness();
    const parent = await h.seedEnvelope({ status: "submitted", amount: 100, expense_date: "2026-10-01" });
    const childA = await h.seedEnvelope({
      status: "submitted",
      amount: 100,
      expense_date: "2026-10-01",
      split_from_envelope_id: parent
    });
    const childB = await h.seedEnvelope({
      status: "draft",
      amount: 100,
      expense_date: "2026-10-01",
      split_from_envelope_id: parent
    });
    await h.seedAttachment(childB);
    const response = await callReimbursement(h, "POST", `/${childB}/submit`, {});
    expect(response.status).toBe(200);
    expect(listDuplicates(h, childB)).toHaveLength(0);
    expect(childA).toBeGreaterThan(0);
  });

  it("提交时算每张发票", async () => {
    const h = createRouteHarness();
    const mine = await seedRecognized(h, [INVOICE, INVOICE], { status: "draft", amount: 200 });
    const response = await callReimbursement(h, "POST", `/${mine.envelopeId}/submit`, {});
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.data.duplicate_count).toBeGreaterThanOrEqual(1);
    expect(payload.data.require_force_submit).toBe(true);
  });

  it("提交时能读到刚完成但还没同步的识别结果", async () => {
    const h = createRouteHarness();
    const envelopeId = await h.seedEnvelope({ status: "draft", amount: 200 });
    await h.seedAttachment(envelopeId);
    await h.seedAttachment(envelopeId);
    await ensureInvoiceReviews(h.env, envelopeId);
    for (const row of h.listReviews(envelopeId)) {
      await h.finishTask(row.task_id, "completed", INVOICE);
    }
    const response = await callReimbursement(h, "POST", `/${envelopeId}/submit`, {});
    expect(response.status).toBe(409);
  });

  describe("复核通过", () => {
    const approve = (h, id) => callReimbursement(h, "POST", `/${id}/precheck`, { action: "approved" });

    beforeEach(() => {
      mockAuth.payload = { ...mockAuth.payload, sub: "office", roles: ["finance"] };
    });

    const seedAnomaly = (h, id, status) => {
      const now = new Date().toISOString();
      h.db
        .prepare(
          `INSERT INTO task_queue (task_code, task_type, biz_type, biz_id, payload_json, status, created_at, updated_at)
           VALUES (?, 'reimbursement_anomaly', 'reimbursement_envelope', ?, '{}', ?, ?, ?)`
        )
        .run(`TK-A-${id}-${status}`, id, status, now, now);
    };

    it("只等识别，合理性审查还在跑不拦", async () => {
      const h = createRouteHarness();
      const mine = await seedRecognized(h, [{ amount_with_tax: 300 }], { status: "received" });
      seedAnomaly(h, mine.envelopeId, "running");
      const response = await approve(h, mine.envelopeId);
      expect(response.status).toBe(200);
      expect(h.getEnvelope(mine.envelopeId).precheck_status).toBe("approved");
    });

    it("合理性任务失败不拦复核", async () => {
      const h = createRouteHarness();
      const mine = await seedRecognized(h, [{ amount_with_tax: 300 }], { status: "received" });
      seedAnomaly(h, mine.envelopeId, "failed");
      await syncEnvelopeAuditState(h.env, mine.envelopeId);
      expect(h.getEnvelope(mine.envelopeId).duplicate_check_status).toBe("completed");
      const response = await approve(h, mine.envelopeId);
      expect(response.status).toBe(200);
    });

    it("合理性任务早于识别完成时不算查重完成", async () => {
      const h = createRouteHarness();
      const envelopeId = await h.seedEnvelope({ status: "received", amount: 300 });
      await h.seedAttachment(envelopeId);
      await ensureInvoiceReviews(h.env, envelopeId);
      const now = new Date().toISOString();
      h.db
        .prepare(
          `INSERT INTO task_queue (task_code, task_type, biz_type, biz_id, payload_json, status, result_json, created_at, updated_at)
           VALUES ('TK-A-early', 'reimbursement_anomaly', 'reimbursement_envelope', ?, '{}', 'completed', ?, ?, ?)`
        )
        .run(envelopeId, JSON.stringify({ output: JSON.stringify({ summary: "合理" }) }), now, now);
      await syncEnvelopeAuditState(h.env, envelopeId);
      expect(h.getEnvelope(envelopeId).duplicate_check_status).toBe("pending");
    });

    it("识别没结束时复核返回等待，响应结构不变", async () => {
      const h = createRouteHarness();
      const envelopeId = await h.seedEnvelope({ status: "received", amount: 300 });
      await h.seedAttachment(envelopeId);
      await ensureInvoiceReviews(h.env, envelopeId);
      const taskId = h.listReviews(envelopeId)[0].task_id;
      const response = await approve(h, envelopeId);
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.data).toEqual({ wait_for_audit: true, audit_triggered: false, task_id: taskId });
      expect(h.listTasks("ocr_extract")).toHaveLength(1);
    });

    it("等待时补上缺失的识别任务", async () => {
      const h = createRouteHarness();
      const envelopeId = await h.seedEnvelope({ status: "received", amount: 300, duplicate_check_status: "pending" });
      await h.seedAttachment(envelopeId);
      const response = await approve(h, envelopeId);
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.data).toMatchObject({ wait_for_audit: true, audit_triggered: true });
      expect(h.listTasks("ocr_extract")).toHaveLength(1);
      expect(payload.data.task_id).toBe(h.listTasks("ocr_extract")[0].id);
    });

    it("没有附件的单不会永远等待", async () => {
      const h = createRouteHarness();
      const envelopeId = await h.seedEnvelope({ status: "received", amount: 300, duplicate_check_status: "pending" });
      const response = await approve(h, envelopeId);
      expect(response.status).toBe(200);
    });

    it("同单重复也要放行才能复核通过", async () => {
      const h = createRouteHarness();
      const mine = await seedRecognized(h, [INVOICE, INVOICE], { status: "received", amount: 200 });
      const response = await approve(h, mine.envelopeId);
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.data.duplicate_risk_unconfirmed).toBe(true);
    });

    it("旧的单任务路径完成后查重也算完成", async () => {
      const h = createRouteHarness();
      const envelopeId = await h.seedEnvelope({
        status: "received",
        amount: 300,
        duplicate_check_status: "pending",
        ocr_status: "pending"
      });
      const now = new Date().toISOString();
      const taskId = Number(
        h.db
          .prepare(
            `INSERT INTO task_queue (task_code, task_type, biz_type, biz_id, payload_json, status, result_json, created_at, updated_at)
             VALUES ('TK-LEGACY', 'ocr_extract', 'reimbursement_envelope', ?, '{}', 'completed', ?, ?, ?)`
          )
          .run(envelopeId, JSON.stringify({ output: JSON.stringify({ invoice_no: "L1" }) }), now, now).lastInsertRowid
      );
      h.db.prepare("UPDATE reimbursement_envelope SET ocr_task_id = ? WHERE id = ?").run(taskId, envelopeId);
      await syncEnvelopeAuditState(h.env, envelopeId);
      expect(h.getEnvelope(envelopeId)).toMatchObject({ ocr_status: "completed", duplicate_check_status: "completed" });
    });
  });
});
