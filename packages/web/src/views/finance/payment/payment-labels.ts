export type PaymentTagType =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export const paymentStatusTagType: Record<string, PaymentTagType> = {
  draft: "info",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger",
  cancelled: "info"
};

export const paymentStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  approved: "已审批",
  paid: "已付款",
  rejected: "已拒绝",
  cancelled: "已取消"
};

export const paymentMethodLabelMap: Record<string, string> = {
  bank_transfer: "对公转账",
  cash: "现金",
  bill: "票据",
  other: "其他",
  对公转账: "对公转账",
  现金: "现金",
  票据: "票据",
  其他: "其他"
};

export const toPaymentStatusLabel = (
  value: string | null | undefined
): string => (value ? (paymentStatusLabelMap[value] ?? value) : "-");

export const toPaymentMethodLabel = (
  value: string | null | undefined
): string => (value ? (paymentMethodLabelMap[value] ?? value) : "-");

export const formatBeijingDateTime = (
  value: string | null | undefined
): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    .replace(/\//g, "-");
};
