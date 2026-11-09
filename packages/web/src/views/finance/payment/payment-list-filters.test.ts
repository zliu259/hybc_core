import { describe, expect, it } from "vitest";

import {
  createEmptyPaymentFilters,
  toPaymentListParams,
  validatePaymentFilters,
  type PaymentListFilters
} from "./payment-list-filters";

const withFilters = (
  patch: Partial<PaymentListFilters>
): PaymentListFilters => ({ ...createEmptyPaymentFilters(), ...patch });

describe("toPaymentListParams", () => {
  it("空表单不带任何筛选参数", () => {
    expect(toPaymentListParams(createEmptyPaymentFilters())).toEqual({});
  });

  it("文本去掉首尾空白，全空白视为没填", () => {
    expect(
      toPaymentListParams(
        withFilters({ payee_keyword: "  建材 ", keyword: "   " })
      )
    ).toEqual({ payee_keyword: "建材" });
  });

  it("金额 0 是有效值，清空后的 null 不传", () => {
    expect(
      toPaymentListParams(withFilters({ amount_min: 0, amount_max: null }))
    ).toEqual({ amount_min: 0 });
  });

  it("日期区间拆成起止两个参数", () => {
    expect(
      toPaymentListParams(
        withFilters({
          created_range: ["2026-11-01", "2026-11-09"],
          paid_range: ["2026-11-05", "2026-11-05"]
        })
      )
    ).toEqual({
      created_from: "2026-11-01",
      created_to: "2026-11-09",
      paid_from: "2026-11-05",
      paid_to: "2026-11-05"
    });
  });

  it("项目、申请人、AI 风险原样透传", () => {
    expect(
      toPaymentListParams(
        withFilters({
          project_id: 7,
          applicant_userid: "zhang",
          ai_risk_status: "failed"
        })
      )
    ).toEqual({
      project_id: 7,
      applicant_userid: "zhang",
      ai_risk_status: "failed"
    });
  });

  it("不改动传入的表单对象", () => {
    const filters = withFilters({ payee_keyword: " 李四 " });
    toPaymentListParams(filters);
    expect(filters.payee_keyword).toBe(" 李四 ");
  });
});

describe("validatePaymentFilters", () => {
  it("最低金额大于最高金额时给出提示", () => {
    expect(
      validatePaymentFilters(withFilters({ amount_min: 500, amount_max: 100 }))
    ).toBe("最低金额不能大于最高金额");
  });

  it("只填一端或相等时通过", () => {
    expect(validatePaymentFilters(withFilters({ amount_min: 500 }))).toBeNull();
    expect(
      validatePaymentFilters(withFilters({ amount_min: 100, amount_max: 100 }))
    ).toBeNull();
  });
});
