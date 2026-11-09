import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { paymentRoutes } from "../src/routes/payment";
import { createMigratedDatabase, createSqliteD1, hasSqlite } from "./helpers/reimbursement-harness";

// web 付款管理页的条件筛选：真实迁移 + node:sqlite 跑列表 SQL，确认收款方名称随行带回、
// 各筛选条件在列表和计数上口径一致。CI（Node 20）没有 node:sqlite 会跳过，推送前本地跑。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
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
  })
}));

const callList = (env, query) => {
  const app = new Hono();
  app.route("/payment", paymentRoutes);
  return app.request(`/payment?${query}`, { headers: { authorization: "Bearer test-token" } }, env);
};

const seed = () => {
  const database = createMigratedDatabase();
  const now = "2026-11-01T00:00:00.000Z";
  const insertPayee = database.prepare(
    "INSERT INTO payee (id, name, bank_name, bank_account, created_by_userid, created_at, updated_at) VALUES (?, ?, '某银行', '6222', 'finance-a', ?, ?)"
  );
  insertPayee.run(1, "东莞建材有限公司", now, now);
  insertPayee.run(2, "李四劳务队", now, now);

  const insertPayment = database.prepare(
    `INSERT INTO payment_request
      (serial_no, project_id, applicant_userid, expected_payment_date, category, payee_id, amount, amount_cn,
       content, payment_method, status, ai_risk_status, created_at, updated_at, paid_at)
     VALUES (?, 1, 'finance-a', '2026-11-20', '劳务费', ?, ?, '略', ?, 'bank_transfer', ?, ?, ?, ?, ?)`
  );
  // 北京时间 11-08 23:30 = UTC 11-08 15:30；北京时间 11-09 00:30 = UTC 11-08 16:30
  insertPayment.run(
    "PAY-1",
    1,
    1000,
    "钢筋",
    "paid",
    "completed",
    "2026-11-08T15:30:00.000Z",
    now,
    "2026-11-09"
  );
  insertPayment.run(
    "PAY-2",
    2,
    5000,
    "人工",
    "approved",
    "failed",
    "2026-11-08T16:30:00.000Z",
    now,
    null
  );
  insertPayment.run(
    "PAY-3",
    1,
    20000,
    "水泥",
    "draft",
    "none",
    "2026-11-02T02:00:00.000Z",
    now,
    null
  );
  insertPayment.run(
    "PAY-4",
    2,
    300,
    "已作废",
    "cancelled",
    "none",
    "2026-11-03T02:00:00.000Z",
    now,
    null
  );
  return { DB: createSqliteD1(database), KV: { get: async () => "session" } };
};

const listSerials = async (env, query) => {
  const res = await callList(env, query);
  expect(res.status).toBe(200);
  const body = await res.json();
  return {
    serials: body.data.map((row) => row.serial_no),
    total: body.pagination.total,
    rows: body.data
  };
};

describe.skipIf(!hasSqlite)("付款列表条件筛选（真实 SQL）", () => {
  it("每行带回收款方名称，已取消的默认不出现", async () => {
    const env = seed();
    const { rows, total } = await listSerials(env, "page=1&pageSize=20");
    expect(total).toBe(3);
    expect(rows.map((row) => [row.serial_no, row.payee_name])).toEqual([
      ["PAY-2", "李四劳务队"],
      ["PAY-1", "东莞建材有限公司"],
      ["PAY-3", "东莞建材有限公司"]
    ]);
  });

  it("收款方模糊匹配", async () => {
    const env = seed();
    const { serials, total } = await listSerials(
      env,
      `payee_keyword=${encodeURIComponent("建材")}`
    );
    expect(serials).toEqual(["PAY-1", "PAY-3"]);
    expect(total).toBe(2);
  });

  it("金额区间含两端", async () => {
    const env = seed();
    const { serials, total } = await listSerials(env, "amount_min=1000&amount_max=5000");
    expect(serials).toEqual(["PAY-2", "PAY-1"]);
    expect(total).toBe(2);
  });

  it("申请日期按北京时间切日", async () => {
    const env = seed();
    const day8 = await listSerials(env, "created_from=2026-11-08&created_to=2026-11-08");
    expect(day8.serials).toEqual(["PAY-1"]);
    const day9 = await listSerials(env, "created_from=2026-11-09&created_to=2026-11-09");
    expect(day9.serials).toEqual(["PAY-2"]);
  });

  it("支付日期兼容只填了日期的 paid_at，未付款的不出现", async () => {
    const env = seed();
    const { serials, total } = await listSerials(env, "paid_from=2026-11-09&paid_to=2026-11-09");
    expect(serials).toEqual(["PAY-1"]);
    expect(total).toBe(1);
  });

  it("AI 风险状态和阶段状态可以叠加", async () => {
    const env = seed();
    const failed = await listSerials(env, "ai_risk_status=failed");
    expect(failed.serials).toEqual(["PAY-2"]);
    const none = await listSerials(env, "ai_risk_status=none&status=draft");
    expect(none.serials).toEqual(["PAY-3"]);
  });

  it("参数不合法时 400，返回中文说明", async () => {
    const env = seed();
    const res = await callList(env, "amount_min=900&amount_max=100");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("最低金额不能大于最高金额");
  });
});
