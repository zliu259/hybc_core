import { describe, expect, it } from "vitest";

import { recentPaymentsQuery } from "./recent-payments";

describe("recentPaymentsQuery — AI 风控/关卡的近期付款取数口径", () => {
  it("排除已取消与已驳回单据（被驳重试是幽灵记录，会喂出假 duplicate_payment）", () => {
    for (const scope of ["contract", "payee"] as const) {
      const sql = recentPaymentsQuery(scope);
      expect(sql).toContain("status NOT IN ('cancelled', 'rejected')");
      expect(sql).not.toMatch(/status\s*!=\s*'cancelled'/);
    }
  });

  it("contract 口径按 contract_id 聚合，payee 口径按 payee_id 聚合，均排除本单", () => {
    expect(recentPaymentsQuery("contract")).toContain("contract_id = ?");
    expect(recentPaymentsQuery("payee")).toContain("payee_id = ?");
    for (const scope of ["contract", "payee"] as const) {
      const sql = recentPaymentsQuery(scope);
      expect(sql).toContain("id != ?");
      expect(sql).toContain("ORDER BY created_at DESC LIMIT 10");
    }
  });
});
