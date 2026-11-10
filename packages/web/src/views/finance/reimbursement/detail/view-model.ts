import type {
  AttachmentReviewView,
  Guidance,
  GuidanceAction,
  ReimbursementEnvelopeDetail,
  ReviewTotals
} from "@/api/reimbursement";

// 报销详情页的排序、默认选中、合计显示。全是纯函数，结论文字由接口算好，这里只处理客户端才知道的上传中。

export type PickerSelection =
  | { kind: "info" }
  | { kind: "attachment"; attachmentId: number };

const BLOCKING_RISK_LEVELS = ["high", "medium"];
const PROBLEM_STATES = ["failed", "not_invoice", "no_amount"];
const NOT_SURELY_INVOICE_STATES = ["not_invoice", "no_amount"];
const SUBMIT_ACTIONS = ["submit", "resubmit"];

export const formatYuan = (value: number): string =>
  `¥${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const hasBlockingDuplicate = (view: AttachmentReviewView): boolean =>
  view.duplicates.some(item => BLOCKING_RISK_LEVELS.includes(item.risk_level));

const problemRank = (view: AttachmentReviewView): number => {
  if (hasBlockingDuplicate(view)) return 0;
  const index = PROBLEM_STATES.indexOf(view.state);
  if (index >= 0) return index + 1;
  if (view.merged_label) return PROBLEM_STATES.length + 1;
  if (view.attention) return PROBLEM_STATES.length + 2;
  return PROBLEM_STATES.length + 3;
};

export const sortAttachmentViews = (
  views: AttachmentReviewView[]
): AttachmentReviewView[] =>
  [...views].sort(
    (a, b) =>
      problemRank(a) - problemRank(b) || (b.amount ?? 0) - (a.amount ?? 0)
  );

/** 新建和编辑时默认显示要填的信息；办公室打开时默认显示发票，优先有问题的，其次金额最大的。 */
export const defaultSelection = (
  views: AttachmentReviewView[],
  usingOfficeGuidance: boolean,
  isEditableDraft: boolean
): PickerSelection => {
  if (isEditableDraft || !usingOfficeGuidance || views.length === 0) {
    return { kind: "info" };
  }
  return {
    kind: "attachment",
    attachmentId: sortAttachmentViews(views)[0].attachment_id
  };
};

const CREATE_GUIDANCE: Guidance = {
  tone: "normal",
  headline: "先选项目，再把发票传上来",
  next_step: "可以一次传多张。",
  note: null,
  actions: [{ key: "submit", label: "提交报销", disabled: true }]
};

const FALLBACK_GUIDANCE: Guidance = {
  tone: "normal",
  headline: "请核对报销信息",
  next_step: "",
  note: null,
  actions: []
};

const LOADING_GUIDANCE: Guidance = {
  tone: "normal",
  headline: "正在加载…",
  next_step: "",
  note: null,
  actions: []
};

const LOAD_FAILED_GUIDANCE: Guidance = {
  tone: "warn",
  headline: "这张报销没有加载出来",
  next_step: "请刷新页面重试。",
  note: null,
  actions: []
};

const withSubmitDisabled = (actions: GuidanceAction[]): GuidanceAction[] =>
  actions.map(action =>
    SUBMIT_ACTIONS.includes(action.key) ? { ...action, disabled: true } : action
  );

type GuidanceContext = {
  workspaceView: boolean;
  uploadingCount: number;
  isCreate: boolean;
  loadFailed?: boolean;
};

const pickServerGuidance = (
  detail: ReimbursementEnvelopeDetail | null,
  ctx: GuidanceContext
): Guidance => {
  if (ctx.isCreate) return CREATE_GUIDANCE;
  if (!detail) return ctx.loadFailed ? LOAD_FAILED_GUIDANCE : LOADING_GUIDANCE;
  const guidance = detail.guidance;
  if (!guidance) return FALLBACK_GUIDANCE;
  return ctx.workspaceView
    ? guidance.applicant
    : (guidance.office ?? guidance.applicant);
};

export const resolveGuidance = (
  detail: ReimbursementEnvelopeDetail | null,
  ctx: GuidanceContext
): Guidance => {
  const guidance = pickServerGuidance(detail, ctx);
  if (ctx.uploadingCount <= 0) return guidance;
  return {
    ...guidance,
    tone: "normal",
    headline: `还有 ${ctx.uploadingCount} 张发票没传完`,
    next_step: "传完确认金额，就可以提交了。",
    actions: withSubmitDisabled(guidance.actions)
  };
};

/** 已保存的金额优先；用户手动改过后不再跟着识别结果变。 */
export const declaredAmountDefault = (input: {
  storedAmount: number;
  extractedTotal: number;
  touched: boolean;
  currentValue: number;
}): number => {
  if (input.touched) return input.currentValue;
  return input.storedAmount > 0 ? input.storedAmount : input.extractedTotal;
};

const extractedText = (totals: ReviewTotals): string => {
  if (totals.recognized_count === 0) return "算不出";
  const missing = totals.attachment_count - totals.recognized_count;
  const total = formatYuan(totals.extracted_total);
  return missing > 0 ? `${total}，另有 ${missing} 个没有金额` : total;
};

export const totalsDisplay = (
  totals: ReviewTotals
): {
  extracted: string;
  declared: string;
  delta: string | null;
  tone: "ok" | "warn" | "none";
} => {
  const base = {
    extracted: extractedText(totals),
    declared: formatYuan(totals.declared_amount)
  };
  if (!totals.complete || totals.delta === null)
    return { ...base, delta: null, tone: "none" };
  if (!totals.mismatch) return { ...base, delta: "一致", tone: "ok" };
  const direction = totals.delta > 0 ? "多" : "少";
  return {
    ...base,
    delta: `${direction} ${formatYuan(Math.abs(totals.delta))}`,
    tone: "warn"
  };
};

export const pickerGroupTitle = (views: AttachmentReviewView[]): string =>
  views.some(
    view => NOT_SURELY_INVOICE_STATES.includes(view.state) || view.merged_label
  )
    ? `附件 ${views.length} 个`
    : `发票 ${views.length} 张`;

const STATE_TEXT: Record<string, string> = {
  recognizing: "识别中",
  not_invoice: "不是发票",
  no_amount: "没读到金额",
  failed: "没读出来",
  not_recognized: "未识别"
};

export const attachmentStatusText = (view: AttachmentReviewView): string =>
  view.state === "recognized" && view.amount !== null
    ? formatYuan(view.amount)
    : (STATE_TEXT[view.state] ?? "");

export const isProblemView = (view: AttachmentReviewView): boolean =>
  hasBlockingDuplicate(view) ||
  PROBLEM_STATES.includes(view.state) ||
  Boolean(view.merged_label);

export type EnvelopeForm = {
  project_id: number | undefined;
  applicant_userid: string;
  channel: "physical" | "electronic";
  bind_envelope_uuid: string;
  expense_date: string;
  amount: number;
  category: string;
  description: string;
};

export const createDefaultForm = (): EnvelopeForm => ({
  project_id: undefined,
  applicant_userid: "",
  channel: "physical",
  bind_envelope_uuid: "",
  expense_date: "",
  amount: 0,
  category: "",
  description: ""
});

export const buildEnvelopeForm = (
  detail: ReimbursementEnvelopeDetail
): EnvelopeForm => ({
  project_id: detail.project_id,
  applicant_userid: detail.applicant_userid,
  channel: detail.channel,
  bind_envelope_uuid: "",
  expense_date: detail.expense_date || "",
  amount: declaredAmountDefault({
    storedAmount: detail.amount,
    extractedTotal: detail.review_totals?.extracted_total ?? 0,
    touched: false,
    currentValue: 0
  }),
  category: detail.category || "",
  description: detail.description || ""
});

/** 自动带出的金额不算用户改动，否则不碰表单也会冒出「保存」。 */
export const isEnvelopeFormDirty = (
  form: EnvelopeForm,
  baseline: EnvelopeForm,
  amountTouched: boolean
): boolean =>
  (Object.keys(form) as (keyof EnvelopeForm)[]).some(key =>
    key === "amount"
      ? amountTouched && form.amount !== baseline.amount
      : form[key] !== baseline[key]
  );

/** 轮询刷新：不冲掉正在填的内容，手动改过的金额不覆盖。 */
export const refreshForm = (input: {
  current: EnvelopeForm;
  baseline: EnvelopeForm;
  server: ReimbursementEnvelopeDetail;
  amountTouched: boolean;
}): EnvelopeForm => {
  const next = buildEnvelopeForm(input.server);
  const amount = input.amountTouched ? input.current.amount : next.amount;
  const editing = isEnvelopeFormDirty(
    { ...input.current, amount: input.baseline.amount },
    input.baseline,
    false
  );
  return editing ? { ...input.current, amount } : { ...next, amount };
};

/**
 * 写回表单。没改过的金额不写：否则保存一次说明，金额就固定成当时的合计，后面再加发票也不跟着变。
 * 提交时要写，申报金额以提交时为准。
 */
export const buildEnvelopeUpdatePayload = (
  form: EnvelopeForm,
  options: { includeAmount: boolean }
) => ({
  project_id: form.project_id,
  applicant_userid: form.applicant_userid || undefined,
  expense_date: form.expense_date || undefined,
  amount: options.includeAmount ? form.amount : undefined,
  category: form.category || undefined,
  description: form.description || undefined
});

export type InfoSummary = { amount: string; meta: string };

/** 「报销信息」卡片上的摘要：金额一行，项目和填报人一行。看发票时也能看到报的是多少。 */
export const buildInfoSummary = (input: {
  amount: number;
  projectName: string | null;
  applicantName: string | null;
}): InfoSummary => {
  const meta = [
    input.projectName,
    input.applicantName ? `填报人 ${input.applicantName}` : null
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    amount: input.amount > 0 ? formatYuan(input.amount) : "还没填金额",
    meta: meta || "项目、填报人、说明"
  };
};

/** 还能改的单按表单里的金额算差额。接口算的是已保存的金额，新草稿是 0，会显示假的差额。 */
export const withDeclaredAmount = (
  totals: ReviewTotals,
  amount: number
): ReviewTotals => {
  if (!totals.complete)
    return { ...totals, declared_amount: amount, delta: null, mismatch: false };
  const delta = Number((totals.extracted_total - amount).toFixed(2));
  return {
    ...totals,
    declared_amount: amount,
    delta,
    mismatch: Math.abs(delta) > 0.01
  };
};

type DuplicateCheck = ReimbursementEnvelopeDetail["duplicate_checks"][number];

const evidenceAttachmentId = (check: DuplicateCheck): unknown => {
  try {
    return (
      JSON.parse(check.evidence_json ?? "null") as {
        attachment_id?: unknown;
      } | null
    )?.attachment_id;
  } catch {
    return undefined;
  }
};

/** 对应不到具体发票的重复（金额接近等），放在报销信息里。 */
export const wholeEnvelopeDuplicates = (
  checks: DuplicateCheck[]
): DuplicateCheck[] =>
  checks.filter(
    check =>
      BLOCKING_RISK_LEVELS.includes(check.risk_level) &&
      typeof evidenceAttachmentId(check) !== "number"
  );

export type MoreActionKey =
  | "rebind"
  | "switch_channel"
  | "split"
  | "rerun_all"
  | "void";

export type ActionDialogKind =
  | "verify"
  | "mark_mismatch"
  | "precheck_supplement"
  | "precheck_reject"
  | "void"
  | "rebind"
  | "rerun_all";
