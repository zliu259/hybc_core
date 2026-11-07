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
const SUBMIT_ACTIONS = ["submit", "resubmit"];

export const formatYuan = (value: number): string =>
  `¥${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const hasBlockingDuplicate = (view: AttachmentReviewView): boolean =>
  view.duplicates.some(item => BLOCKING_RISK_LEVELS.includes(item.risk_level));

const problemRank = (view: AttachmentReviewView): number => {
  if (hasBlockingDuplicate(view)) return 0;
  const index = PROBLEM_STATES.indexOf(view.state);
  if (index >= 0) return index + 1;
  if (view.attention) return PROBLEM_STATES.length + 1;
  return PROBLEM_STATES.length + 2;
};

export const sortAttachmentViews = (
  views: AttachmentReviewView[]
): AttachmentReviewView[] =>
  [...views].sort(
    (a, b) => problemRank(a) - problemRank(b) || (b.amount ?? 0) - (a.amount ?? 0)
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
  return { kind: "attachment", attachmentId: sortAttachmentViews(views)[0].attachment_id };
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

const withSubmitDisabled = (actions: GuidanceAction[]): GuidanceAction[] =>
  actions.map(action =>
    SUBMIT_ACTIONS.includes(action.key) ? { ...action, disabled: true } : action
  );

const pickServerGuidance = (
  detail: ReimbursementEnvelopeDetail | null,
  workspaceView: boolean,
  isCreate: boolean
): Guidance => {
  if (isCreate || !detail) return CREATE_GUIDANCE;
  const guidance = detail.guidance;
  if (!guidance) return FALLBACK_GUIDANCE;
  return workspaceView ? guidance.applicant : (guidance.office ?? guidance.applicant);
};

export const resolveGuidance = (
  detail: ReimbursementEnvelopeDetail | null,
  ctx: { workspaceView: boolean; uploadingCount: number; isCreate: boolean }
): Guidance => {
  const guidance = pickServerGuidance(detail, ctx.workspaceView, ctx.isCreate);
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
  const base = { extracted: extractedText(totals), declared: formatYuan(totals.declared_amount) };
  if (!totals.complete || totals.delta === null) return { ...base, delta: null, tone: "none" };
  if (!totals.mismatch) return { ...base, delta: "一致", tone: "ok" };
  const direction = totals.delta > 0 ? "多" : "少";
  return { ...base, delta: `${direction} ${formatYuan(Math.abs(totals.delta))}`, tone: "warn" };
};

export const pickerGroupTitle = (views: AttachmentReviewView[]): string =>
  views.some(view => view.state === "not_invoice")
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
  hasBlockingDuplicate(view) || PROBLEM_STATES.includes(view.state);
