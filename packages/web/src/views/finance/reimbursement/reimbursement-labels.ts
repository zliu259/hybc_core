import type { ReimbursementEnvelope } from "@/api/reimbursement";

export type ReimbursementTagType =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export const reimbursementStatusTagType: Record<string, ReimbursementTagType> =
  {
    unregistered: "info",
    draft: "info",
    submitted: "warning",
    received: "success",
    batched: "primary",
    pending_approval: "warning",
    approved: "success",
    paid: "primary",
    rejected: "danger",
    cancelled: "info"
  };

const riskTagTypeMap: Record<string, ReimbursementTagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toDuplicateCount = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const duplicateRiskLabel = (level: unknown): string => {
  if (level === "high") return "高风险重复";
  if (level === "medium") return "中风险重复";
  if (level === "low") return "低风险重复";
  return "重复风险";
};

const toDuplicateRiskTagType = (level: unknown): ReimbursementTagType => {
  if (typeof level !== "string") return "warning";
  return riskTagTypeMap[level] ?? "warning";
};

export const rowAnomalyTags = (
  row: ReimbursementEnvelope
): Array<{ label: string; type: ReimbursementTagType }> => {
  const tags: Array<{ label: string; type: ReimbursementTagType }> = [];
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  if (duplicateCount > 0) {
    tags.push({
      label: `${duplicateRiskLabel(row.duplicate_risk_level)} x${duplicateCount}`,
      type: toDuplicateRiskTagType(row.duplicate_risk_level)
    });
  }
  if (row.verification_status === "mismatch") {
    tags.push({ label: "收件核对异常", type: "danger" });
  }
  if (row.precheck_status === "supplement") {
    tags.push({ label: "待补充材料", type: "warning" });
  }
  if (row.precheck_status === "rejected") {
    tags.push({ label: "复核驳回", type: "danger" });
  }
  return tags;
};

export const isHighRiskRow = (row: ReimbursementEnvelope): boolean => {
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  return (
    (duplicateCount > 0 && row.duplicate_risk_level === "high") ||
    row.verification_status === "mismatch" ||
    row.precheck_status === "rejected"
  );
};

export const tableRowClassName = ({
  row
}: {
  row: ReimbursementEnvelope;
}): string => (isHighRiskRow(row) ? "reimbursement-row-high-risk" : "");
