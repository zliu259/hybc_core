/**
 * AI 风控（payment_risk_assessment）与 AI 关卡（approval_ai_gate）共用的
 * 近期付款取数口径：有合同按合同聚合，否则按收款方聚合，排除本单。
 *
 * 排除 cancelled + rejected：被驳回的重试单是幽灵记录 —— duplicate_payment
 * 在拦截白名单内，同一笔款重提会被自己上次的失败记录喂出假重复信号
 * （SP-20260813-0006 已出现该信号）。调用方：ai-slot.ts、routes/payment.ts，
 * 两处口径必须一致。
 */
export const recentPaymentsQuery = (scope: "contract" | "payee"): string => {
  const scopeColumn = scope === "contract" ? "contract_id" : "payee_id";
  return `SELECT serial_no, amount, created_at FROM payment_request
           WHERE ${scopeColumn} = ? AND id != ? AND status NOT IN ('cancelled', 'rejected')
           ORDER BY created_at DESC LIMIT 10`;
};
