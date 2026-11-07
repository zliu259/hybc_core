import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const asUser = (sub, roles = ["operator"]) => {
  mockAuth.payload = { ...mockAuth.payload, sub, roles };
};

const setup = () => {
  const h = createRouteHarness();
  return { h, file: (key, size = 100) => { h.putFile(key, size); return { file_key: key, file_name: key.split("/").at(-1) }; } };
};

const attach = (h, id, attachments) => callReimbursement(h, "POST", `/${id}/attachments`, { attachments });

describe.skipIf(!hasSqlite)("POST /:id/attachments", () => {
  beforeEach(() => {
    asUser("u1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("绑定后建识别任务，不跑合理性，不开新轮", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "submitted", precheck_status: "pending" });
    const first = await attach(h, id, [file("reimbursement/a.pdf"), file("reimbursement/b.pdf")]);
    expect(first.status).toBe(200);
    const payload = await first.json();
    expect(payload.data.attachment_ids).toHaveLength(2);
    await attach(h, id, [file("reimbursement/c.pdf")]);
    expect(h.listTasks("ocr_extract")).toHaveLength(3);
    expect(h.listTasks("reimbursement_anomaly")).toHaveLength(0);
    expect(h.listReviews(id).every((row) => row.review_round === 1)).toBe(true);
    const attachment = h.db.prepare("SELECT * FROM envelope_attachment WHERE envelope_id = ? ORDER BY id").get(id);
    expect(attachment).toMatchObject({ attachment_type: "invoice", file_size: 100 });
  });

  it("相同 file_key 重试返回已有记录", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "draft" });
    const body = [file("reimbursement/a.pdf")];
    const first = await (await attach(h, id, body)).json();
    const second = await (await attach(h, id, body)).json();
    expect(second.data.attachment_ids).toEqual(first.data.attachment_ids);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM envelope_attachment WHERE envelope_id = ?").get(id).n).toBe(1);
    expect(h.listTasks("ocr_extract")).toHaveLength(1);
  });

  it("规则不通过返回 400 且不写入", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "draft" });
    h.putFile("reimbursement/a.heic", 100);
    const response = await attach(h, id, [{ file_key: "reimbursement/a.heic", file_name: "a.heic" }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("只支持 PDF、JPG、PNG");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM envelope_attachment").get().n).toBe(0);
  });

  it("空列表返回 400", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "draft" });
    expect((await attach(h, id, [])).status).toBe(400);
  });

  it("已复核通过的单增附件后退出成批候选", async () => {
    const { h, file } = setup();
    asUser("office", ["finance"]);
    const id = await h.seedEnvelope({ status: "received", precheck_status: "approved", project_id: 5, applicant_userid: "u1" });
    await h.seedAttachment(id);
    const before = await callReimbursement(h, "GET", "/batch/candidates?project_id=5&applicant_userid=u1");
    expect((await before.json()).data.map((row) => row.id)).toContain(id);

    const response = await attach(h, id, [file("reimbursement/a.pdf")]);
    expect(response.status).toBe(200);
    expect(h.getEnvelope(id).precheck_status).toBe("pending");
    const after = await callReimbursement(h, "GET", "/batch/candidates?project_id=5&applicant_userid=u1");
    expect((await after.json()).data.map((row) => row.id)).not.toContain(id);
  });

  it("被退回的单增附件不自动交回", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "submitted", precheck_status: "supplement" });
    await attach(h, id, [file("reimbursement/a.pdf")]);
    expect(h.getEnvelope(id).precheck_status).toBe("supplement");
  });

  it.each([
    ["draft", "u1", ["operator"], 200],
    ["unregistered", "office", ["finance"], 200],
    ["submitted", "u1", ["operator"], 200],
    ["submitted", "office", ["manager"], 200],
    ["submitted", "other", ["operator"], 403],
    ["received", "u1", ["operator"], 400],
    ["received", "office", ["finance"], 200],
    ["batched", "office", ["finance"], 400],
    ["paid", "office", ["finance"], 400],
    ["cancelled", "office", ["finance"], 400]
  ])("%s 状态 %s 添加返回 %i 的权限", async (status, sub, roles, expected) => {
    const { h, file } = setup();
    asUser(sub, roles);
    const id = await h.seedEnvelope({ status, applicant_userid: "u1" });
    expect((await attach(h, id, [file("reimbursement/a.pdf")])).status).toBe(expected);
  });

  it("已在批次里的单不能加附件", async () => {
    const { h, file } = setup();
    asUser("office", ["finance"]);
    const id = await h.seedEnvelope({ status: "received", batch_id: 3 });
    expect((await attach(h, id, [file("reimbursement/a.pdf")])).status).toBe(400);
  });
});

describe.skipIf(!hasSqlite)("POST /:id/attachments/:attachmentId/delete", () => {
  beforeEach(() => {
    asUser("u1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });
  afterEach(() => vi.unstubAllGlobals());

  const remove = (h, id, attachmentId) => callReimbursement(h, "POST", `/${id}/attachments/${attachmentId}/delete`, {});

  it.each([
    [{ status: "draft" }, 200],
    [{ status: "unregistered" }, 200],
    [{ status: "submitted", precheck_status: "supplement" }, 200],
    [{ status: "submitted", precheck_status: "rejected" }, 200],
    [{ status: "submitted", precheck_status: "pending" }, 400],
    [{ status: "received", precheck_status: "approved" }, 400],
    [{ status: "paid" }, 400]
  ])("%j 删除返回 %i", async (fields, expected) => {
    const { h } = setup();
    const id = await h.seedEnvelope(fields);
    const attachmentId = await h.seedAttachment(id);
    expect((await remove(h, id, attachmentId)).status).toBe(expected);
    const row = h.db.prepare("SELECT status FROM envelope_attachment WHERE id = ?").get(attachmentId);
    expect(row.status).toBe(expected === 200 ? "deleted" : "active");
  });

  it("别人的单不能删", async () => {
    const { h } = setup();
    asUser("other");
    const id = await h.seedEnvelope({ status: "draft", applicant_userid: "u1" });
    const attachmentId = await h.seedAttachment(id);
    expect((await remove(h, id, attachmentId)).status).toBe(403);
  });

  it("删除后合计立刻更新", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "draft", amount: 100 });
    const { data } = await (await attach(h, id, [file("reimbursement/a.pdf"), file("reimbursement/b.pdf")])).json();
    for (const row of h.listReviews(id)) {
      await h.finishTask(row.task_id, "completed", { amount_with_tax: 50 });
    }
    await remove(h, id, data.attachment_ids[1]);
    const review = JSON.parse(h.getEnvelope(id).silent_review_result);
    expect(review.amount_consistency.extracted_total).toBe(50);
  });
});

describe.skipIf(!hasSqlite)("POST /:id/attachments/:attachmentId/rerecognize", () => {
  beforeEach(() => {
    asUser("u1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });
  afterEach(() => vi.unstubAllGlobals());

  const rerecognize = (h, id, attachmentId) =>
    callReimbursement(h, "POST", `/${id}/attachments/${attachmentId}/rerecognize`, {});

  const seedFailed = async (h, fields = {}) => {
    const { ensureInvoiceReviews } = await import("../src/services/reimbursement/review-pipeline");
    const id = await h.seedEnvelope({ status: "draft", amount: 100, applicant_userid: "u1", ...fields });
    const attachmentId = await h.seedAttachment(id);
    await ensureInvoiceReviews(h.env, id);
    const [row] = h.listReviews(id);
    await h.finishTask(row.task_id, "failed");
    h.db.prepare("UPDATE reimbursement_invoice_review SET task_status = 'failed' WHERE id = ?").run(row.id);
    return { id, attachmentId, row };
  };

  it("只对 failed：同一行新 task_id、状态 pending", async () => {
    const { h } = setup();
    const { id, attachmentId, row } = await seedFailed(h);
    const response = await rerecognize(h, id, attachmentId);
    expect(response.status).toBe(200);
    const payload = await response.json();
    const [updated] = h.listReviews(id);
    expect(h.listReviews(id)).toHaveLength(1);
    expect(updated.id).toBe(row.id);
    expect(updated.task_id).toBe(payload.data.task_id);
    expect(updated.task_id).not.toBe(row.task_id);
    expect(updated.task_status).toBe("pending");
    expect(h.getEnvelope(id).ocr_status).toBe("pending");
    expect(fetch).toHaveBeenCalled();
  });

  it("读到结果后写回同一行", async () => {
    const { h } = setup();
    const { id, attachmentId } = await seedFailed(h);
    const payload = await (await rerecognize(h, id, attachmentId)).json();
    await h.finishTask(payload.data.task_id, "completed", { amount_with_tax: 100 });
    const detail = await callReimbursement(h, "GET", `/${id}`);
    expect(detail.status).toBe(200);
    expect(h.listReviews(id)[0]).toMatchObject({ task_status: "completed", invoice_amount: 100 });
  });

  it("已识别的不能重新识别", async () => {
    const { h } = setup();
    const { id, attachmentId, row } = await seedFailed(h);
    await h.finishTask(row.task_id, "completed", { amount_with_tax: 100 });
    const response = await rerecognize(h, id, attachmentId);
    expect(response.status).toBe(400);
    expect(h.listTasks("ocr_extract")).toHaveLength(1);
  });

  it("已复核通过的不行", async () => {
    const { h } = setup();
    asUser("office", ["finance"]);
    const { id, attachmentId } = await seedFailed(h, { status: "received", precheck_status: "approved" });
    expect((await rerecognize(h, id, attachmentId)).status).toBe(400);
  });

  it("已删的附件 404", async () => {
    const { h } = setup();
    const { id, attachmentId } = await seedFailed(h);
    h.db.prepare("UPDATE envelope_attachment SET status = 'deleted' WHERE id = ?").run(attachmentId);
    expect((await rerecognize(h, id, attachmentId)).status).toBe(404);
  });

  it.each([
    [{ status: "draft" }, "u1", ["operator"], 200],
    [{ status: "submitted", precheck_status: "supplement" }, "u1", ["operator"], 200],
    [{ status: "submitted", precheck_status: "rejected" }, "u1", ["operator"], 200],
    [{ status: "submitted", precheck_status: "pending" }, "u1", ["operator"], 403],
    [{ status: "received", precheck_status: "pending" }, "u1", ["operator"], 403],
    [{ status: "draft" }, "other", ["operator"], 403],
    [{ status: "submitted", precheck_status: "pending" }, "office", ["finance"], 200],
    [{ status: "received", precheck_status: "pending" }, "office", ["manager"], 200],
    [{ status: "paid", precheck_status: "approved" }, "office", ["finance"], 400]
  ])("%j 用户 %s 返回 %i 的权限", async (fields, sub, roles, expected) => {
    const { h } = setup();
    const { id, attachmentId } = await seedFailed(h, fields);
    asUser(sub, roles);
    expect((await rerecognize(h, id, attachmentId)).status).toBe(expected);
  });
});

describe.skipIf(!hasSqlite)("其他路径共用规则", () => {
  beforeEach(() => {
    asUser("u1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POST / 带附件走同样的规则并建识别任务", async () => {
    const { h, file } = setup();
    h.putFile("reimbursement/a.heic", 10);
    const rejected = await callReimbursement(h, "POST", "", {
      project_id: 1,
      channel: "electronic",
      attachments: [{ file_key: "reimbursement/a.heic", file_name: "a.heic" }]
    });
    expect(rejected.status).toBe(400);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM reimbursement_envelope").get().n).toBe(0);

    const created = await callReimbursement(h, "POST", "", {
      project_id: 1,
      channel: "electronic",
      attachments: [file("reimbursement/a.pdf")]
    });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(h.listReviews(data.id)).toHaveLength(1);
    expect(h.db.prepare("SELECT attachment_type, file_size FROM envelope_attachment").get()).toMatchObject({ file_size: 100 });
  });

  it("PUT 带附件走同样的规则并建识别任务，重试不重复绑定", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "draft" });
    h.putFile("reimbursement/a.heic", 10);
    const rejected = await callReimbursement(h, "PUT", `/${id}`, {
      attachments: [{ file_key: "reimbursement/a.heic", file_name: "a.heic" }]
    });
    expect(rejected.status).toBe(400);
    const attachments = [file("reimbursement/a.pdf")];
    await callReimbursement(h, "PUT", `/${id}`, { attachments });
    await callReimbursement(h, "PUT", `/${id}`, { attachments });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM envelope_attachment WHERE envelope_id = ?").get(id).n).toBe(1);
    expect(h.listReviews(id)).toHaveLength(1);
  });

  it("POST /scan 带附件走同样的规则并建识别任务", async () => {
    const { h, file } = setup();
    const id = await h.seedEnvelope({ status: "draft", channel: "physical" });
    const { envelope_uuid } = h.getEnvelope(id);
    h.putFile("reimbursement/a.heic", 10);
    const rejected = await callReimbursement(h, "POST", "/scan", {
      envelope_uuid,
      attachments: [{ file_key: "reimbursement/a.heic", file_name: "a.heic" }]
    });
    expect(rejected.status).toBe(400);
    const scanned = await callReimbursement(h, "POST", "/scan", { envelope_uuid, attachments: [file("reimbursement/a.pdf")] });
    expect(scanned.status).toBe(200);
    expect(h.listReviews(id)).toHaveLength(1);
  });

  it("/electronic-upload 只加格式检查，其他不变", async () => {
    const { h, file } = setup();
    h.putFile("reimbursement/a.heic", 10);
    const rejected = await callReimbursement(h, "POST", "/electronic-upload", {
      project_id: 1,
      file_key: "reimbursement/a.heic",
      file_name: "a.heic"
    });
    expect(rejected.status).toBe(400);
    const created = await callReimbursement(h, "POST", "/electronic-upload", {
      project_id: 1,
      ...file("reimbursement/a.pdf")
    });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    const again = await callReimbursement(h, "POST", "/electronic-upload", {
      project_id: 1,
      envelope_id: data.id,
      ...file("reimbursement/b.pdf")
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ENVELOPE_HAS_ACTIVE_INVOICE");
  });
});

describe.skipIf(!hasSqlite)("POST /:id/void", () => {
  beforeEach(() => asUser("admin", ["super_admin"]));

  const voidEnvelope = (h, id, body) => callReimbursement(h, "POST", `/${id}/void`, body);

  it("废止时保存原因并写进审计", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "submitted" });
    const response = await voidEnvelope(h, id, { reason: "  重复提交 " });
    expect(response.status).toBe(200);
    expect(h.getEnvelope(id)).toMatchObject({ status: "cancelled", void_reason: "重复提交" });
    const audit = h.db
      .prepare("SELECT detail_json FROM api_audit_log WHERE action = 'reimbursement.envelope.void' AND target_id = ?")
      .get(String(id));
    expect(JSON.parse(audit.detail_json).reason).toBe("重复提交");
  });

  it("不传原因仍能废止", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "submitted" });
    expect((await voidEnvelope(h, id, {})).status).toBe(200);
    expect(h.getEnvelope(id)).toMatchObject({ status: "cancelled", void_reason: null });
  });

  it("没有请求体也能废止", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "submitted" });
    expect((await voidEnvelope(h, id, undefined)).status).toBe(200);
  });

  it("原因超过 200 字拒绝", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "submitted" });
    expect((await voidEnvelope(h, id, { reason: "很".repeat(201) })).status).toBe(400);
    expect(h.getEnvelope(id).status).toBe("submitted");
  });

  it("原因不是字符串拒绝", async () => {
    const { h } = setup();
    const id = await h.seedEnvelope({ status: "submitted" });
    expect((await voidEnvelope(h, id, { reason: 1 })).status).toBe(400);
  });
});
