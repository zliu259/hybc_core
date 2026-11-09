import { describe, expect, it } from "vitest";

import { buildPaymentListWhere, toWhereSql } from "./payment-list-filters";

const reader =
  (query: Record<string, string>) =>
  (name: string): string | undefined =>
    query[name];

const build = (query: Record<string, string>) => buildPaymentListWhere(reader(query), "me");

describe("buildPaymentListWhere", () => {
  it("不带参数时只排除已取消的单据", () => {
    const result = build({});
    expect(result).toEqual({
      ok: true,
      where: { clauses: ["p.status != 'cancelled'"], params: [] }
    });
  });

  it("按 cancelled 筛选时不再排除已取消", () => {
    const result = build({ status: "Cancelled" });
    expect(result.ok && result.where.clauses).toEqual(["p.status = ?"]);
    expect(result.ok && result.where.params).toEqual(["cancelled"]);
  });

  it("原有参数的子句和绑定顺序不变", () => {
    const result = build({
      contract_id: "3",
      project_id: "7",
      project_name: "厂房",
      status: "approved",
      keyword: "PAY",
      legacy_data_id: "L-1",
      applicant_userid: "zhang",
      date_from: "2026-01-01",
      date_to: "2026-02-01"
    });
    expect(result.ok && result.where.params).toEqual([
      3,
      7,
      "%厂房%",
      "%厂房%",
      "approved",
      "%PAY%",
      "%PAY%",
      "L-1",
      "zhang",
      "2026-01-01",
      "2026-02-01"
    ]);
  });

  it("mine=true 时用本人身份，忽略 applicant_userid", () => {
    const result = build({ mine: "true", applicant_userid: "other" });
    expect(result.ok && result.where.params).toEqual(["me"]);
  });

  it("收款方按名称模糊匹配，走子查询不需要 JOIN", () => {
    const result = build({ payee_keyword: "  建材  " });
    expect(result.ok && result.where.clauses).toContain(
      "p.payee_id IN (SELECT id FROM payee WHERE name LIKE ?)"
    );
    expect(result.ok && result.where.params).toEqual(["%建材%"]);
  });

  it("金额区间两端都可选，0 也算有效下限", () => {
    const result = build({ amount_min: "0", amount_max: "5000.5" });
    expect(result.ok && result.where.clauses).toEqual([
      "p.status != 'cancelled'",
      "p.amount >= ?",
      "p.amount <= ?"
    ]);
    expect(result.ok && result.where.params).toEqual([0, 5000.5]);
  });

  it("申请日期和支付日期按北京时间的日期比较", () => {
    const result = build({
      created_from: "2026-11-01",
      created_to: "2026-11-09",
      paid_from: "2026-11-05"
    });
    expect(result.ok && result.where.clauses).toEqual([
      "p.status != 'cancelled'",
      "date(p.created_at, '+8 hours') >= ?",
      "date(p.created_at, '+8 hours') <= ?",
      "date(p.paid_at, '+8 hours') >= ?"
    ]);
    expect(result.ok && result.where.params).toEqual(["2026-11-01", "2026-11-09", "2026-11-05"]);
  });

  it("AI 风险状态只接受已知取值", () => {
    const result = build({ ai_risk_status: "failed" });
    expect(result.ok && result.where.params).toEqual(["failed"]);
    expect(build({ ai_risk_status: "bogus" })).toEqual({ ok: false, message: "AI 风险状态不正确" });
  });

  it.each([
    [{ amount_min: "abc" }, "最低金额必须是不小于 0 的数字"],
    [{ amount_max: "-1" }, "最高金额必须是不小于 0 的数字"],
    [{ amount_min: "100", amount_max: "50" }, "最低金额不能大于最高金额"],
    [{ created_from: "2026/11/01" }, "申请日期起格式应为 YYYY-MM-DD"],
    [{ paid_to: "2026-02-30" }, "支付日期止格式应为 YYYY-MM-DD"],
    [
      { created_from: "2026-11-09", created_to: "2026-11-01" },
      "申请日期的开始日期不能晚于结束日期"
    ],
    [{ payee_keyword: "字".repeat(101) }, "收款方不能超过 100 个字"]
  ])("参数不合法时拒绝：%o", (query, message) => {
    expect(build(query)).toEqual({ ok: false, message });
  });

  it("空白参数等同于没传", () => {
    const result = build({
      payee_keyword: "   ",
      amount_min: " ",
      created_from: "",
      ai_risk_status: " "
    });
    expect(result.ok && result.where.clauses).toEqual(["p.status != 'cancelled'"]);
  });
});

describe("toWhereSql", () => {
  it("用 AND 连接子句", () => {
    expect(toWhereSql({ clauses: ["a = ?", "b = ?"], params: [1, 2] })).toBe(
      " WHERE a = ? AND b = ?"
    );
  });

  it("没有子句时不输出 WHERE", () => {
    expect(toWhereSql({ clauses: [], params: [] })).toBe("");
  });
});
