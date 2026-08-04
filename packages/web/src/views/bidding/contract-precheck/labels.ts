import type { PrecheckSeverity, PrecheckStatus } from "@/api/contract-precheck";

export type TagType = "primary" | "success" | "warning" | "danger" | "info";

export const statusLabelMap: Record<PrecheckStatus, string> = {
  draft: "待预审",
  reviewing: "AI审计中",
  passed: "预审通过",
  reviewed: "存在明显错误",
  review_failed: "审计失败",
  signed: "已确认签署",
  transferred: "已转入合同",
  deleted: "已删除"
};

export const statusTagTypeMap: Record<PrecheckStatus, TagType> = {
  draft: "info",
  reviewing: "warning",
  passed: "success",
  reviewed: "danger",
  review_failed: "danger",
  signed: "primary",
  transferred: "success",
  deleted: "info"
};

export const severityLabelMap: Record<PrecheckSeverity, string> = {
  critical: "明显错误",
  major: "重要",
  minor: "提示"
};

export const severityTagTypeMap: Record<PrecheckSeverity, TagType> = {
  critical: "danger",
  major: "warning",
  minor: "info"
};

export const overallLabelMap: Record<string, string> = {
  pass: "未见问题",
  minor: "轻微问题",
  major: "重要问题",
  critical: "存在明显错误"
};

export const overallTagTypeMap: Record<string, TagType> = {
  pass: "success",
  minor: "info",
  major: "warning",
  critical: "danger"
};

export const dimensionLabelMap: Record<string, string> = {
  subject_signing: "主体与签署要件",
  clause_completeness: "条款完整性",
  amount_payment: "金额与支付",
  liability_balance: "权责对等",
  invalid_terms: "无效条款红线",
  stance_risk: "我方立场风险"
};

export const directionLabelMap: Record<string, string> = {
  inbound: "收款合同（我方乙方）",
  outbound: "付款合同（我方甲方）"
};

export const toLabel = (
  map: Record<string, string>,
  key: string | null | undefined
): string => {
  if (!key) return "-";
  return map[key] ?? key;
};

export const toTagType = (
  map: Record<string, TagType>,
  key: string | null | undefined
): TagType => {
  if (!key) return "info";
  return map[key] ?? "info";
};
