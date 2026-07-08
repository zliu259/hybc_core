import type { RouteLocationRaw } from "vue-router";

/**
 * 根据审批实例携带的业务类型/业务单 ID 解析业务单编辑入口路由。
 *
 * 用于「等待我处理（被退回）」等场景：从审批实例直达可编辑的业务单页面。
 * 返回 null 表示该业务类型暂无可直达的编辑页（如 receipt_refund 需要
 * 额外上下文），调用方应退回到审批详情页入口。
 */
export const resolveBizEditRoute = (
  bizType: string,
  bizId: number,
  bizSummary?: string | null
): RouteLocationRaw | null => {
  if (bizType === "payment_request") {
    return `/workspace/payment/detail/${bizId}`;
  }
  if (bizType === "outbound_contract" || bizType === "inbound_contract") {
    return `/finance/contract/detail/${bizId}`;
  }
  if (bizType === "reimbursement_batch") {
    return `/finance/reimbursement/batch/${bizId}`;
  }
  if (bizType === "invoice_request") {
    // biz_summary 形如 "IR-xxxx | 客户名"，取单号作为列表页检索词
    const keyword = (bizSummary ?? "").split("|")[0]?.trim() ?? "";
    return keyword
      ? { path: "/finance/receipt/invoice", query: { keyword } }
      : "/finance/receipt/invoice";
  }
  if (bizType === "stock_order") {
    return "/warehouse/stock-order";
  }
  if (bizType === "warehouse_asset_work_order") {
    return "/warehouse-assets/work-order";
  }
  return null;
};
