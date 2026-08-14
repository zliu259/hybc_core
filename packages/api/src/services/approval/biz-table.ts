/**
 * 审批 biz_type → 业务表名映射。
 * operations.ts（人工退回/撤回）与 ai-gate-apply.ts（AI 关卡退回）共用；
 * 单独成文件是为了避免 engine → operations 的循环依赖。
 */
export const BIZ_TYPE_TABLE_MAP: Readonly<Record<string, string>> = {
  payment_request: "payment_request",
  outbound_contract: "contract",
  inbound_contract: "contract",
  reimbursement_batch: "reimbursement_batch",
  invoice_request: "invoice_request",
  stock_order: "stock_order",
  warehouse_asset_work_order: "warehouse_asset_work_order"
};
