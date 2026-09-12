import type { ReimbursementEnvelope } from "@/api/reimbursement";
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice";

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

export type ReimbursementAnomalyTag = {
  label: string;
  type: ReimbursementTagType;
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

export const reimbursementStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已提交",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已驳回",
    cancelled: "已废止",
    deleted: "已删除"
  };
  if (!v) return "草稿";
  return m[v] ?? v;
};

export const reimbursementPrecheckStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    none: "未复核",
    pending: "待复核",
    approved: "复核通过",
    supplement: "待补充",
    rejected: "复核驳回"
  };
  if (!v) return "未复核";
  return m[v] ?? v;
};

export const reimbursementVerificationStatusLabel = (
  v?: string | null
): string => {
  const m: Record<string, string> = {
    pending: "待核对",
    verified: "核对通过",
    mismatch: "核对异常"
  };
  if (!v) return "待核对";
  return m[v] ?? v;
};

export const invoiceTitleSourceLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    ocr: "OCR识别",
    manual: "手工指定"
  };
  if (!v) return "未识别";
  return m[v] ?? v;
};

export const reimbursementTaskStatusLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    none: "未触发",
    pending: "排队中",
    assigned: "已分派",
    running: "处理中",
    queued: "排队中",
    completed: "已完成",
    failed: "失败"
  };
  if (!v) return "未触发";
  return m[v] ?? v;
};

export const attachmentTypeLabel = (v?: string | null): string => {
  const m: Record<string, string> = {
    invoice: "发票",
    receipt: "凭证",
    contract: "合同",
    other: "其他"
  };
  if (!v) return "其他";
  return m[v] ?? v;
};

export const precheckActionLabel = (
  action: "approved" | "supplement" | "rejected"
): string => {
  const m = {
    approved: "复核通过",
    supplement: "要求补充材料",
    rejected: "复核驳回"
  } as const;
  return m[action];
};

export const rowAnomalyTags = (
  row: ReimbursementEnvelope
): ReimbursementAnomalyTag[] => {
  const tags: ReimbursementAnomalyTag[] = [];
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  if (duplicateCount > 0) {
    tags.push({
      label: `${duplicateRiskLabel(row.duplicate_risk_level)} x${duplicateCount}`,
      type: toDuplicateRiskTagType(row.duplicate_risk_level)
    });
  }
  if (
    detectEInvoiceInPhysical({
      channel: row.channel,
      ocrResultJson: row.ocr_result_json ?? null,
      invoiceUniqueNoHint: row.ocr_invoice_unique_no_hint ?? null
    })
  ) {
    tags.push({ label: "电子发票混入", type: "danger" });
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
