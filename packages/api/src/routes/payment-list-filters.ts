// 付款列表（GET /payment）的筛选条件：把查询参数翻译成 WHERE 子句和绑定参数。
// 列表 SQL 和计数 SQL 共用同一组子句，保证分页总数和列表口径一致。
// 子句里只引用 payment_request 别名 p，计数 SQL 不需要 JOIN 其他表。

export type PaymentListQueryReader = (name: string) => string | undefined;

export interface PaymentListWhere {
  clauses: string[];
  params: (string | number)[];
}

export type PaymentListWhereResult =
  | { ok: true; where: PaymentListWhere }
  | { ok: false; message: string };

export const PAYMENT_AI_RISK_STATUSES = ["none", "pending", "completed", "failed"] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 100;

const isValidDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

type FieldResult<T> = { ok: true; value: T | undefined } | { ok: false; message: string };

const readText = (
  read: PaymentListQueryReader,
  name: string,
  label: string
): FieldResult<string> => {
  const value = read(name)?.trim();
  if (!value) return { ok: true, value: undefined };
  if (value.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: `${label}不能超过 ${MAX_TEXT_LENGTH} 个字` };
  }
  return { ok: true, value };
};

const readAmount = (
  read: PaymentListQueryReader,
  name: string,
  label: string
): FieldResult<number> => {
  const raw = read(name)?.trim();
  if (!raw) return { ok: true, value: undefined };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: `${label}必须是不小于 0 的数字` };
  }
  return { ok: true, value };
};

const readDate = (
  read: PaymentListQueryReader,
  name: string,
  label: string
): FieldResult<string> => {
  const value = read(name)?.trim();
  if (!value) return { ok: true, value: undefined };
  if (!isValidDate(value)) {
    return { ok: false, message: `${label}格式应为 YYYY-MM-DD` };
  }
  return { ok: true, value };
};

/**
 * 时间戳按北京时间的日期比较：库里的 created_at / paid_at 是带 Z 的 ISO 时间
 * （标记付款时手填的 paid_at 是纯日期），页面上也按北京时间显示，所以先加 8 小时再取日期。
 */
const beijingDateOf = (column: string): string => `date(${column}, '+8 hours')`;

/**
 * 解析付款列表的筛选参数。参数不合法时返回 ok:false 和给用户看的中文说明，不拼任何 SQL。
 * authSub 只在 mine=true 时使用（只看本人提交的单据）。
 */
export const buildPaymentListWhere = (
  read: PaymentListQueryReader,
  authSub: string
): PaymentListWhereResult => {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: string, ...values: (string | number)[]) => {
    clauses.push(clause);
    params.push(...values);
  };

  const status = read("status")?.trim().toLowerCase() || "";
  // 已取消的单据只有明确按 cancelled 筛选时才出现
  if (status !== "cancelled") add("p.status != 'cancelled'");

  const contractId = read("contract_id");
  if (contractId) add("p.contract_id = ?", Number(contractId));

  const projectId = read("project_id");
  if (projectId) add("p.project_id = ?", Number(projectId));

  const projectName = read("project_name");
  if (projectName) {
    add(
      "p.project_id IN (SELECT id FROM project WHERE project_name LIKE ? OR project_code LIKE ?)",
      `%${projectName}%`,
      `%${projectName}%`
    );
  }

  if (status) add("p.status = ?", status);

  const keyword = read("keyword");
  if (keyword) add("(p.serial_no LIKE ? OR p.content LIKE ?)", `%${keyword}%`, `%${keyword}%`);

  const legacyDataId = read("legacy_data_id");
  if (legacyDataId) add("p.legacy_data_id = ?", legacyDataId);

  const applicantUserid = read("applicant_userid");
  if (read("mine") === "true") {
    add("p.applicant_userid = ?", authSub);
  } else if (applicantUserid) {
    add("p.applicant_userid = ?", applicantUserid);
  }

  const dateFrom = read("date_from");
  if (dateFrom) add("p.expected_payment_date >= ?", dateFrom);
  const dateTo = read("date_to");
  if (dateTo) add("p.expected_payment_date <= ?", dateTo);

  // ── 付款管理页的条件筛选 ──
  const payeeKeyword = readText(read, "payee_keyword", "收款方");
  if (!payeeKeyword.ok) return payeeKeyword;
  if (payeeKeyword.value) {
    add("p.payee_id IN (SELECT id FROM payee WHERE name LIKE ?)", `%${payeeKeyword.value}%`);
  }

  const amountMin = readAmount(read, "amount_min", "最低金额");
  if (!amountMin.ok) return amountMin;
  const amountMax = readAmount(read, "amount_max", "最高金额");
  if (!amountMax.ok) return amountMax;
  if (
    amountMin.value !== undefined &&
    amountMax.value !== undefined &&
    amountMin.value > amountMax.value
  ) {
    return { ok: false, message: "最低金额不能大于最高金额" };
  }
  if (amountMin.value !== undefined) add("p.amount >= ?", amountMin.value);
  if (amountMax.value !== undefined) add("p.amount <= ?", amountMax.value);

  const dateRanges = [
    { column: "p.created_at", from: "created_from", to: "created_to", label: "申请日期" },
    { column: "p.paid_at", from: "paid_from", to: "paid_to", label: "支付日期" }
  ];
  for (const range of dateRanges) {
    const from = readDate(read, range.from, `${range.label}起`);
    if (!from.ok) return from;
    const to = readDate(read, range.to, `${range.label}止`);
    if (!to.ok) return to;
    if (from.value && to.value && from.value > to.value) {
      return { ok: false, message: `${range.label}的开始日期不能晚于结束日期` };
    }
    if (from.value) add(`${beijingDateOf(range.column)} >= ?`, from.value);
    if (to.value) add(`${beijingDateOf(range.column)} <= ?`, to.value);
  }

  const aiRiskStatus = read("ai_risk_status")?.trim();
  if (aiRiskStatus) {
    if (!(PAYMENT_AI_RISK_STATUSES as readonly string[]).includes(aiRiskStatus)) {
      return { ok: false, message: "AI 风险状态不正确" };
    }
    add("p.ai_risk_status = ?", aiRiskStatus);
  }

  return { ok: true, where: { clauses, params } };
};

export const toWhereSql = (where: PaymentListWhere): string =>
  where.clauses.length > 0 ? ` WHERE ${where.clauses.join(" AND ")}` : "";
