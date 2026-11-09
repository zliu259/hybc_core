import type { PaymentListFilterParams } from "@/api/payment";

/** 日期区间：el-date-picker type="daterange" + value-format="YYYY-MM-DD" 的取值 */
export type DateRange = [string, string] | null;

/** 付款管理页筛选栏的表单状态 */
export interface PaymentListFilters {
  project_id: number | undefined;
  applicant_userid: string;
  payee_keyword: string;
  keyword: string;
  /** el-input-number 清空后是 null */
  amount_min: number | null | undefined;
  amount_max: number | null | undefined;
  created_range: DateRange;
  paid_range: DateRange;
  ai_risk_status: string;
}

export const AI_RISK_FILTER_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "none", label: "未触发" },
  { value: "pending", label: "评估中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "评估失败" }
];

export const createEmptyPaymentFilters = (): PaymentListFilters => ({
  project_id: undefined,
  applicant_userid: "",
  payee_keyword: "",
  keyword: "",
  amount_min: undefined,
  amount_max: undefined,
  created_range: null,
  paid_range: null,
  ai_risk_status: ""
});

const hasAmount = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const textOrUndefined = (value: string): string | undefined =>
  value.trim() || undefined;

/** 提交前校验；返回给用户看的提示，没问题返回 null */
export const validatePaymentFilters = (
  filters: PaymentListFilters
): string | null => {
  if (
    hasAmount(filters.amount_min) &&
    hasAmount(filters.amount_max) &&
    filters.amount_min > filters.amount_max
  ) {
    return "最低金额不能大于最高金额";
  }
  return null;
};

/** 表单状态 → 列表接口参数：去掉空值，日期区间拆成起止两个参数 */
export const toPaymentListParams = (
  filters: PaymentListFilters
): PaymentListFilterParams => {
  const params: PaymentListFilterParams = {
    project_id: filters.project_id,
    applicant_userid: textOrUndefined(filters.applicant_userid),
    payee_keyword: textOrUndefined(filters.payee_keyword),
    keyword: textOrUndefined(filters.keyword),
    amount_min: hasAmount(filters.amount_min) ? filters.amount_min : undefined,
    amount_max: hasAmount(filters.amount_max) ? filters.amount_max : undefined,
    created_from: filters.created_range?.[0],
    created_to: filters.created_range?.[1],
    paid_from: filters.paid_range?.[0],
    paid_to: filters.paid_range?.[1],
    ai_risk_status: filters.ai_risk_status || undefined
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  ) as PaymentListFilterParams;
};
