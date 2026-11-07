/**
 * 小程序报销页的视图模型。结论和该做什么由接口算好（guidance.applicant），这里只负责
 * 「还在上传」这一条客户端才知道的覆盖，以及把上传项和附件状态合成一个文件列表。
 */
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const BLOCKING_RISK_LEVELS = ["high", "medium"];

const SUBMIT_KEYS = ["submit", "resubmit"];

const STATE_TEXT = {
  recognizing: "识别中",
  not_invoice: "不是发票",
  no_amount: "没读到金额",
  failed: "没读出来",
  not_recognized: "未识别"
};

const PROBLEM_STATES = ["failed", "not_invoice", "no_amount"];

const UPLOAD_STATUS_TEXT = {
  waiting: "等待上传",
  uploading: "正在上传",
  failed: "上传失败"
};

const formatYuan = (value) => {
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimal] = fixed.split(".");
  return `¥${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
};

const validatePickedFile = (name, size) => {
  const text = String(name || "");
  const dot = text.lastIndexOf(".");
  const extension = dot >= 0 ? text.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) return `${text}：只支持 PDF、JPG、PNG`;
  if (typeof size === "number" && size > MAX_FILE_BYTES) return `${text}：不能超过 20MB`;
  return null;
};

/** 已保存的金额优先于识别合计；用户手动改过后不再跟着识别结果变。 */
const resolveDeclaredAmount = ({ storedAmount, extractedTotal, touched, currentValue }) => {
  if (touched) return currentValue;
  return Number(storedAmount) > 0 ? Number(storedAmount) : Number(extractedTotal) || 0;
};

const blockingDuplicate = (view) =>
  (view.duplicates || []).find((item) => BLOCKING_RISK_LEVELS.includes(item.risk_level)) || null;

const rowPriority = (view) => {
  if (PROBLEM_STATES.includes(view.state) || blockingDuplicate(view) || view.merged_label) return 0;
  if (view.state === "recognizing" || view.state === "not_recognized") return 1;
  return 2;
};

const toAttachmentRow = (view) => {
  const duplicate = blockingDuplicate(view);
  const isProblem = PROBLEM_STATES.includes(view.state) || Boolean(duplicate) || Boolean(view.merged_label);
  return {
    key: `a${view.attachment_id}`,
    kind: "attachment",
    attachmentId: view.attachment_id,
    fileKey: view.file_key,
    fileName: view.file_name,
    name: view.display_name,
    statusText: view.state === "recognized" ? formatYuan(view.amount) : STATE_TEXT[view.state] || "",
    tone: isProblem ? "warn" : "normal",
    canRerecognize: view.state === "failed",
    duplicateText: duplicate ? duplicate.summary || "疑似重复" : "",
    mergedText: view.merged_label ? `这个文件${view.merged_label}，系统没法逐张查重` : "",
    invoiceNo: view.invoice_no,
    invoiceDate: view.invoice_date,
    sellerName: view.seller_name,
    rawTextSummary: view.raw_text_summary
  };
};

const toUploadRow = (item) => ({
  key: item.localId,
  kind: "upload",
  localId: item.localId,
  name: item.name,
  statusText: UPLOAD_STATUS_TEXT[item.status] || "",
  error: item.error || "",
  tone: item.status === "failed" ? "warn" : "normal",
  canRetry: item.status === "failed"
});

const buildRows = (views, unfinishedUploads) => {
  const sorted = views
    .slice()
    .sort((a, b) => rowPriority(a) - rowPriority(b) || (b.amount || 0) - (a.amount || 0));
  return [...unfinishedUploads.map(toUploadRow), ...sorted.map(toAttachmentRow)];
};

const buildTotalsText = (totals) => {
  if (!totals || totals.attachment_count === 0) return "";
  if (totals.recognized_count === 0) return "票面合计算不出";
  const text = `票面合计 ${formatYuan(totals.extracted_total)}`;
  const missing = totals.attachment_count - totals.recognized_count;
  return missing > 0 ? `${text}，另有 ${missing} 个没有金额` : text;
};

const disableAll = (actions) => actions.map((action) => ({ ...action, disabled: true }));

const resolveGuidance = (detail, options) => {
  if (!detail && options.opening) {
    return options.openFailed
      ? { tone: "warn", headline: "这张报销没有加载出来", next_step: "请返回后重新打开。", actions: [] }
      : { tone: "normal", headline: "正在加载…", next_step: "", actions: [] };
  }
  if (!detail) {
    return {
      tone: "normal",
      headline: "先选项目，再把发票传上来",
      next_step: "可以一次传多张。",
      actions: disableAll([{ key: "submit", label: "提交报销" }])
    };
  }
  if (detail.guidance && detail.guidance.applicant) return detail.guidance.applicant;
  // 新版小程序配旧接口：不给错的结论，只保留能提交的入口
  return {
    tone: "normal",
    headline: "请核对报销信息",
    next_step: "",
    actions: ["draft", "unregistered"].includes(detail.status) ? [{ key: "submit", label: "提交报销" }] : []
  };
};

const buildReimbursementView = (detail, options = {}) => {
  const uploadItems = options.uploadItems || [];
  const unfinished = uploadItems.filter((item) => item.status !== "done");
  const guidance = resolveGuidance(detail, options);
  const totals = detail ? detail.review_totals : null;
  const actions = unfinished.length > 0 ? disableAll(guidance.actions) : guidance.actions;

  return {
    headline: unfinished.length > 0 ? `还有 ${unfinished.length} 张发票没传完` : guidance.headline,
    nextStep: unfinished.length > 0 ? "传完确认金额，就可以提交了。" : guidance.next_step,
    tone: unfinished.length > 0 ? "normal" : guidance.tone,
    actions,
    rows: buildRows(detail ? detail.attachment_views || [] : [], unfinished),
    totalsText: buildTotalsText(totals),
    canSubmit: actions.some((action) => SUBMIT_KEYS.includes(action.key) && !action.disabled),
    declaredAmountDefault: resolveDeclaredAmount({
      storedAmount: detail ? detail.amount : 0,
      extractedTotal: totals ? totals.extracted_total : 0,
      touched: false,
      currentValue: 0
    })
  };
};

module.exports = {
  buildReimbursementView,
  formatYuan,
  resolveDeclaredAmount,
  validatePickedFile
};
