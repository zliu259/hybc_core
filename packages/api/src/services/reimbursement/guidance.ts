import { isBlockingRiskLevel } from "../../routes/reimbursement-duplicate-scan";
import type { ReimbursementEnvelope } from "../../types/reimbursement";
import type { AttachmentReviewView, ReviewTotals } from "./attachment-state";

// 详情页第一眼看到的一句结论和该做什么。两端说法完全一样，这里算好随 GET /:id 返回。
// 文字逐字来自设计文档第 6 节。actions 第一个是主按钮；路由的权限检查不变，这里不替代授权。

export type GuidanceActionKey =
  | "verify"
  | "mark_mismatch"
  | "precheck_approve"
  | "precheck_supplement"
  | "precheck_reject"
  | "submit"
  | "resubmit"
  | "rerecognize_failed"
  | "scan_register"
  | "view_batch"
  | "open_batching";

export interface GuidanceAction {
  key: GuidanceActionKey;
  label: string;
  disabled?: boolean;
}

export interface Guidance {
  tone: "normal" | "warn" | "done";
  headline: string;
  next_step: string;
  note: string | null;
  actions: GuidanceAction[];
}

export interface EnvelopeGuidance {
  applicant: Guidance;
  office: Guidance | null;
}

export interface EnvelopeGuidanceInput {
  envelope: Pick<
    ReimbursementEnvelope,
    | "status"
    | "channel"
    | "amount"
    | "envelope_uuid"
    | "precheck_status"
    | "precheck_comment"
    | "verification_status"
    | "verification_note"
    | "batch_id"
    | "duplicate_check_status"
  > & { void_reason: string | null };
  views: AttachmentReviewView[];
  totals: ReviewTotals;
  /** 阻断级且没有 attachment_id 的整单匹配 */
  envelopeDuplicateCount: number;
  einvoiceDetected: boolean;
  batchStatus: string | null;
  canOfficeAudit: boolean;
}

const ACTION_LABELS: Record<GuidanceActionKey, string> = {
  verify: "核查签收",
  mark_mismatch: "标记异常",
  precheck_approve: "复核通过",
  precheck_supplement: "要求补充",
  precheck_reject: "驳回",
  submit: "提交报销",
  resubmit: "重新提交",
  rerecognize_failed: "重新识别",
  scan_register: "扫码登记",
  view_batch: "查看批次",
  open_batching: "去成批"
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const formatYuan = (value: number): string =>
  `¥${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const guidance = (
  tone: Guidance["tone"],
  headline: string,
  nextStep: string,
  actionKeys: GuidanceActionKey[] = []
): Guidance => ({
  tone,
  headline,
  next_step: nextStep,
  note: null,
  actions: actionKeys.map((key) => ({ key, label: ACTION_LABELS[key] }))
});

/** 把人写的原话接到固定说法前面。原话可能自带句号，统一去掉再接。 */
const withLeadingText = (text: string | null | undefined, joiner: string, rest: string): string => {
  const cleaned = text?.trim().replace(/[。，；,.;\s]+$/, "");
  return cleaned ? `${cleaned}${joiner}${rest}` : rest;
};

interface Facts {
  duplicateViews: number;
  wholeEnvelopeDuplicate: boolean;
  failed: number;
  recognizing: number;
  noAmount: number;
  notInvoice: number;
  missingAmount: number;
  count: number;
  mergedLabels: string[];
}

const collectFacts = (input: EnvelopeGuidanceInput): Facts => {
  const { totals, views, envelopeDuplicateCount } = input;
  const duplicateViews = views.filter((view) =>
    view.duplicates.some((duplicate) => isBlockingRiskLevel(duplicate.risk_level))
  ).length;
  return {
    duplicateViews,
    wholeEnvelopeDuplicate: duplicateViews === 0 && envelopeDuplicateCount > 0,
    failed: totals.failed_count,
    recognizing: totals.recognizing_count,
    noAmount: totals.no_amount_count,
    notInvoice: totals.not_invoice_count,
    missingAmount: totals.no_amount_count + totals.not_invoice_count,
    count: totals.attachment_count,
    mergedLabels: views.map((view) => view.merged_label).filter((label): label is string => Boolean(label))
  };
};

const hasDuplicate = (facts: Facts): boolean => facts.duplicateViews > 0 || facts.wholeEnvelopeDuplicate;

const duplicateHeadline = (facts: Facts, perInvoice: string): string =>
  facts.wholeEnvelopeDuplicate ? "这张报销疑似和其他报销重复" : perInvoice;

const duplicateTarget = (facts: Facts): string => {
  if (facts.wholeEnvelopeDuplicate) return "报销信息里列出的记录";
  return facts.duplicateViews > 1 ? "标出的这几张" : "标出的那张";
};

/** 合并文件的金额能对上，但没法逐张查重，不能说成「都识别了」。 */
const hasMergedFile = (facts: Facts): boolean => facts.mergedLabels.length > 0;

const mergedSubject = (facts: Facts): string =>
  facts.mergedLabels.length === 1
    ? `1 个文件${facts.mergedLabels[0]}`
    : `${facts.mergedLabels.length} 个文件各含多张发票`;

const mergedHeadline = (facts: Facts): string => `${mergedSubject(facts)}，系统没法逐张查重`;

/** 所有人看到一样的说法，优先于两张表。 */
const sharedGuidance = (input: EnvelopeGuidanceInput): Guidance | null => {
  const { envelope, batchStatus } = input;
  if (envelope.status === "received" && envelope.batch_id && batchStatus === "rejected") {
    return guidance("warn", "所在批次被驳回", "办公室到批次详情处理；申请人现在不用做什么。", ["view_batch"]);
  }
  switch (envelope.status) {
    case "batched":
    case "pending_approval":
      return guidance("normal", "已进入批次，审批中", "现在不用做什么。", ["view_batch"]);
    case "approved":
      return guidance("normal", "审批通过，等待打款", "现在不用做什么。", ["view_batch"]);
    case "paid":
      return guidance("done", `已打款 ${formatYuan(envelope.amount)}`, "流程已结束。");
    case "cancelled":
      return guidance("done", "这张报销已废止", withLeadingText(envelope.void_reason, "，", "不再流转。"));
    case "rejected":
      return guidance("warn", "这张报销已驳回", "流程已结束。");
    default:
      return null;
  }
};

const draftGuidance = (input: EnvelopeGuidanceInput, facts: Facts): Guidance => {
  const { envelope, totals, einvoiceDetected } = input;
  if (facts.count === 0) {
    const empty = guidance("normal", "还差发票，传完就能提交", "把发票传上来，可以一次传多张。", ["submit"]);
    return { ...empty, actions: empty.actions.map((action) => ({ ...action, disabled: true })) };
  }
  if (envelope.channel === "physical" && !UUID_REGEX.test(envelope.envelope_uuid ?? "")) {
    return guidance("normal", "还没绑定信封识别号", "扫码或填入识别号后才能提交。", ["scan_register"]);
  }
  if (envelope.channel === "physical" && einvoiceDetected) {
    return guidance("warn", "这个实物信封里有电子发票", "请新建一张电子发票报销，或联系财务切换通道。", ["submit"]);
  }
  if (hasDuplicate(facts)) {
    return guidance(
      "warn",
      duplicateHeadline(facts, `${facts.duplicateViews} 张发票疑似重复报销`),
      `先看${duplicateTarget(facts)}，确认不是重复再提交。`,
      ["submit"]
    );
  }
  if (facts.failed > 0) {
    return guidance("warn", `${facts.failed} 张发票没读出来`, "可以重新识别，或自己填写报销金额。", [
      "rerecognize_failed",
      "submit"
    ]);
  }
  if (facts.recognizing > 0) {
    return guidance(
      "normal",
      `还有 ${facts.recognizing} 张发票在识别`,
      "可以等识别完再确认金额，也可以自己填好直接提交。",
      ["submit"]
    );
  }
  if (hasMergedFile(facts)) {
    return guidance("warn", mergedHeadline(facts), "请拆成单张重新上传，这样才能查重。", ["submit"]);
  }
  if (facts.missingAmount > 0) {
    const amountStep = envelope.amount > 0 ? `请确认报销金额 ${formatYuan(envelope.amount)}` : "请自己填写报销金额";
    return guidance("warn", `${facts.missingAmount} 个附件没读出金额`, `${amountStep}，办公室会核对原件。`, ["submit"]);
  }
  return guidance(
    "normal",
    `${facts.count} 张发票都识别了，票面合计 ${formatYuan(totals.extracted_total)}`,
    "确认金额，就可以提交了。",
    ["submit"]
  );
};

const applicantGuidance = (input: EnvelopeGuidanceInput, facts: Facts): Guidance => {
  const { envelope } = input;
  if (envelope.status === "unregistered") {
    return guidance("normal", "这个信封还没登记", "扫码绑定填报人后就能填写。", ["scan_register"]);
  }
  if (envelope.status === "draft") return draftGuidance(input, facts);
  if (envelope.precheck_status === "supplement") {
    return guidance(
      "normal",
      "办公室要求补充材料",
      withLeadingText(envelope.precheck_comment, "，", "补完重新提交。"),
      ["resubmit"]
    );
  }
  if (envelope.precheck_status === "rejected") {
    return guidance(
      "warn",
      "办公室驳回了这张报销",
      withLeadingText(envelope.precheck_comment, "，", "改好后可以重新提交。"),
      ["resubmit"]
    );
  }
  if (envelope.verification_status === "mismatch") {
    return guidance(
      "warn",
      "办公室核查发现问题",
      withLeadingText(envelope.verification_note, "。", "等办公室联系你。")
    );
  }
  if (envelope.status === "submitted") {
    return guidance(
      "normal",
      "已提交，等办公室核查",
      envelope.channel === "physical" ? "现在不用做什么。实物信封记得寄给办公室。" : "现在不用做什么。"
    );
  }
  if (envelope.status === "received" && envelope.precheck_status === "approved") {
    return guidance("normal", "办公室已复核，等待成批", "现在不用做什么。");
  }
  if (envelope.status === "received") {
    return guidance("normal", "办公室已签收，正在复核", "现在不用做什么。");
  }
  return guidance("normal", "这张报销正在处理", "现在不用做什么。");
};

const submittedOfficeGuidance = (input: EnvelopeGuidanceInput, facts: Facts): Guidance => {
  const { envelope, totals, einvoiceDetected } = input;
  const verifyActions: GuidanceActionKey[] = ["verify", "mark_mismatch"];
  const checkOriginal = `请按原件核对 ${formatYuan(envelope.amount)}，没问题就签收。`;

  if (hasDuplicate(facts)) {
    return guidance(
      "warn",
      duplicateHeadline(facts, `${facts.duplicateViews} 张发票疑似重复报销`),
      `先看${duplicateTarget(facts)}，确认后再签收。`,
      verifyActions
    );
  }
  if (einvoiceDetected) {
    return guidance(
      "warn",
      "实物信封里有电子发票",
      "复核时会被拦下。可以驳回让申请人改走电子通道，财务可填理由放行。",
      verifyActions
    );
  }
  if (facts.count === 0) {
    return guidance("warn", "这张报销没有附件", "要求申请人补充后再签收。", ["precheck_supplement", "mark_mismatch"]);
  }
  if (facts.failed > 0) {
    return guidance("warn", `${facts.failed} 张发票没读出来`, `请直接看原件，或重新识别这 ${facts.failed} 张。`, [
      "rerecognize_failed",
      "verify"
    ]);
  }
  if (facts.recognizing > 0) {
    return guidance("normal", `还有 ${facts.recognizing} 张发票在识别`, "可以先看原件，识别完会自动更新。", verifyActions);
  }
  if (hasMergedFile(facts)) {
    return guidance("warn", mergedHeadline(facts), "请逐张核对原件，确认没有重复就签收，不对就标记异常。", verifyActions);
  }
  if (totals.recognized_count === 0) {
    const headline =
      facts.noAmount === 0
        ? `${facts.notInvoice} 个附件是手写收据，系统算不出合计`
        : `${facts.count} 个附件没读出金额，系统算不出合计`;
    return guidance("warn", headline, checkOriginal, verifyActions);
  }
  if (!totals.complete) {
    return guidance("warn", `${facts.count - totals.recognized_count} 个附件没有金额，合计可能不全`, checkOriginal, verifyActions);
  }
  if (totals.mismatch && totals.delta !== null) {
    const direction = totals.delta > 0 ? "多" : "少";
    return guidance(
      "warn",
      `${facts.count} 张发票都识别了，但票面合计比申报${direction} ${formatYuan(Math.abs(totals.delta))}`,
      "请核对差额，确认没问题就签收，不对就标记异常。",
      verifyActions
    );
  }
  return guidance("normal", `${facts.count} 张发票都识别了，金额和申报一致`, "核对原件没问题就签收。", verifyActions);
};

const receivedOfficeGuidance = (input: EnvelopeGuidanceInput, facts: Facts): Guidance => {
  const { envelope, einvoiceDetected } = input;
  if (envelope.precheck_status === "approved") {
    return guidance("normal", "已复核通过，等待成批", "到报销批次里成批送审。", ["open_batching"]);
  }
  if (facts.recognizing > 0) {
    return guidance("normal", "已签收，还在识别", "识别完才能复核通过。", ["precheck_supplement", "precheck_reject"]);
  }
  const reviewActions: GuidanceActionKey[] = ["precheck_approve", "precheck_supplement", "precheck_reject"];
  if (hasDuplicate(facts)) {
    return guidance(
      "warn",
      duplicateHeadline(facts, `已签收，但 ${facts.duplicateViews} 张发票疑似重复`),
      `先看${duplicateTarget(facts)}，确认不是重复才能通过。`,
      reviewActions
    );
  }
  if (einvoiceDetected) {
    return guidance("warn", "已签收，但实物信封里有电子发票", "驳回让申请人改走电子通道，财务可填理由放行。", [
      "precheck_reject",
      "precheck_supplement",
      "precheck_approve"
    ]);
  }
  if (hasMergedFile(facts)) {
    return guidance("warn", `已签收，但 ${mergedSubject(facts)}`, "请逐张核对原件，确认没有重复再通过。", reviewActions);
  }
  return guidance("normal", "已签收，等你复核", "确认无误就通过，缺材料就要求补充。", reviewActions);
};

const attentionNote = (views: AttachmentReviewView[]): string | null => {
  const reasons = views.map((view) => view.attention).filter((reason): reason is string => Boolean(reason));
  return reasons.length > 0 ? `需要留意：${reasons.join("；")}` : null;
};

const officeGuidance = (input: EnvelopeGuidanceInput, facts: Facts): Guidance => {
  const { envelope } = input;
  if (envelope.precheck_status === "supplement" || envelope.precheck_status === "rejected") {
    return guidance("normal", "已退回申请人，等对方补充", "现在不用做什么。");
  }
  if (envelope.verification_status === "mismatch") {
    return guidance(
      "warn",
      "已标记核查异常",
      withLeadingText(envelope.verification_note, "。", "和申请人核对后，可以重新签收或要求补充。"),
      ["verify", "precheck_supplement", "precheck_reject"]
    );
  }
  return envelope.status === "received"
    ? receivedOfficeGuidance(input, facts)
    : submittedOfficeGuidance(input, facts);
};

export const buildEnvelopeGuidance = (input: EnvelopeGuidanceInput): EnvelopeGuidance => {
  const shared = sharedGuidance(input);
  if (shared) {
    return { applicant: shared, office: input.canOfficeAudit ? shared : null };
  }

  const facts = collectFacts(input);
  const applicant = applicantGuidance(input, facts);
  const isPreSubmit = input.envelope.status === "draft" || input.envelope.status === "unregistered";
  if (isPreSubmit || !input.canOfficeAudit) {
    return { applicant, office: null };
  }
  return {
    applicant,
    office: { ...officeGuidance(input, facts), note: attentionNote(input.views) }
  };
};
