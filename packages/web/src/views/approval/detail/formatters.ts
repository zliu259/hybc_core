import { toChineseAmount } from "@/utils/amount-cn";
import type { AttachmentItem, RemarkEdit, TagType } from "./types";

// 页面按金额现算大写，不读 amount_cn：存量里有写错的旧值。
export { toChineseAmount };

export const formatAmount = (amount: number | null | undefined): string => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/** 带大写的金额文本，用于明细里的次要金额（原合同金额等）。 */
export const formatAmountWithUpper = (
  amount: number | null | undefined
): string => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  return `${formatAmount(amount)}（${toChineseAmount(amount)}）`;
};

export const formatFileSize = (bytes: number | null | undefined): string => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const paymentCategoryLabelMap: Record<string, string> = {
  special_approval: "特殊审批",
  admin_fee: "行政费",
  labor_fee: "劳务费",
  machinery_fee: "机械费",
  material_fee: "材料费",
  other_fee: "其他费用",
  specialApproval: "特殊审批",
  adminFee: "行政费",
  laborFee: "劳务费",
  machineryFee: "机械费",
  materialFee: "材料费",
  otherFee: "其他费用",
  // 发单台写入的合同付款阶段
  prepayment: "预付款",
  progress: "进度款",
  settlement: "结算款"
};

const paymentMethodLabelMap: Record<string, string> = {
  bank_transfer: "对公转账",
  transfer: "对公转账",
  personal_transfer: "转账",
  cash: "现金",
  bill: "票据",
  other: "其他"
};

export const toPaymentCategoryLabel = (
  value: string | null | undefined
): string => {
  if (!value) return "-";
  return paymentCategoryLabelMap[value] ?? value;
};

export const toPaymentMethodLabel = (
  value: string | null | undefined
): string => {
  if (!value) return "-";
  return paymentMethodLabelMap[value] ?? value;
};

export const normalizePaymentMethodValue = (
  value: string | null | undefined
): string => {
  if (!value) return "";
  if (value === "transfer" || value === "bank_transfer" || value === "对公转账")
    return "transfer";
  if (value === "personal_transfer" || value === "转账")
    return "personal_transfer";
  if (value === "cash" || value === "现金") return "cash";
  if (value === "bill" || value === "票据") return "bill";
  if (value === "other" || value === "其他") return "other";
  return "";
};

export const toContractDirectionLabel = (direction: unknown): string => {
  if (direction === "outbound") return "对外付款";
  if (direction === "inbound") return "收款";
  if (typeof direction === "string" && direction) return direction;
  return "-";
};

export const toContractDirectionTagType = (direction: unknown): TagType => {
  if (direction === "outbound") return "warning";
  if (direction === "inbound") return "success";
  return "info";
};

export const toInvoiceTypeLabel = (
  value: string | null | undefined
): string => {
  if (value === "electronic") return "电子发票";
  if (value === "special") return "增值税专票";
  if (value === "normal") return "增值税普票";
  return value || "-";
};

const INVOICE_RISK_LABELS: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险"
};
const INVOICE_RISK_TAGS: Record<string, TagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

export const toInvoiceRiskLabel = (value: unknown): string =>
  typeof value === "string" ? (INVOICE_RISK_LABELS[value] ?? "-") : "-";

export const toInvoiceRiskTagType = (value: unknown): TagType =>
  typeof value === "string" ? (INVOICE_RISK_TAGS[value] ?? "info") : "info";

export const parseJsonObject = (
  raw: string | null | undefined
): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

export type InvoiceItemRow = {
  name: string;
  specification: string;
  unit: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const parseInvoiceItems = (
  raw: string | null | undefined
): InvoiceItemRow[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item): InvoiceItemRow => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const quantity = toNumberOrNull(row.quantity);
      const unitPrice = toNumberOrNull(row.unit_price);
      const explicitAmount = toNumberOrNull(row.amount);
      return {
        name: typeof row.name === "string" ? row.name : "",
        specification:
          typeof row.specification === "string" ? row.specification : "",
        unit: typeof row.unit === "string" ? row.unit : "",
        quantity,
        unit_price: unitPrice,
        amount:
          explicitAmount ??
          (quantity !== null && unitPrice !== null
            ? quantity * unitPrice
            : null)
      };
    });
  } catch {
    return [];
  }
};

export const parseAttachments = (
  raw: string | null | undefined
): AttachmentItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): AttachmentItem[] => {
      if (typeof item === "string") {
        return [{ file_key: item, file_name: item }];
      }
      if (!item || typeof item !== "object") return [];
      const row = item as {
        file_key?: string;
        key?: string;
        file_name?: string;
        name?: string;
        file_size?: number;
        size?: number;
      };
      const key = row.file_key ?? row.key;
      if (!key) return [];
      return [
        {
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          file_size: row.file_size ?? row.size
        }
      ];
    });
  } catch {
    return [];
  }
};

const REMARK_EDIT_LINE = /^\[超管修改 ([^\]]+)\] ([^：:]+)[：:](.*)$/;

/** 把备注里系统追加的「[超管修改 …]」日志行分离出来，备注区只显示发起人写的内容。 */
export const splitRemark = (
  remark: string | null | undefined
): { text: string; edits: RemarkEdit[] } => {
  const edits: RemarkEdit[] = [];
  const kept: string[] = [];
  for (const line of (remark ?? "").split("\n")) {
    const match = line.trim().match(REMARK_EDIT_LINE);
    if (match) {
      edits.push({ at: match[1], by: match[2].trim(), note: match[3].trim() });
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join("\n").trim(), edits };
};

/** 是否能在抽屉里内嵌预览；其余类型只能下载后打开。 */
export const canPreviewInline = (fileName: string): boolean =>
  /\.(pdf|png|jpe?g|webp|gif|txt)$/i.test(fileName);

/** 审批意见只是「同意」这类字样时，不必在动作标签旁再重复一遍。 */
const REDUNDANT_COMMENTS = new Set(["同意", "通过", "已阅", "ok", "OK"]);

export const isMeaningfulComment = (comment: string | null | undefined) => {
  const text = (comment ?? "").trim();
  return !!text && !REDUNDANT_COMMENTS.has(text);
};
