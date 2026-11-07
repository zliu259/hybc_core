const { request } = require("../../utils/request");
const { rawErrorText } = require("../../utils/error-message");
const { statusLabel } = require("../../utils/enum-labels");
const { uploadFileToR2 } = require("../../utils/upload");
const { openQueryAttachment } = require("../../utils/attachment-open");
const {
  wxScanCode,
  wxChooseMediaImage,
  wxChooseLocalFile,
  wxChooseMessageFile
} = require("../../utils/wx");
const { positiveNumber } = require("../../utils/validation");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");
const { createUploadQueue } = require("../../utils/upload-queue");
const {
  buildReimbursementView,
  resolveDeclaredAmount,
  validatePickedFile
} = require("../../utils/reimbursement-view");

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_PICK_IMAGES = 9;
const MAX_PICK_FILES = 30;
const UPLOAD_CONCURRENCY = 2;
const POLL_INTERVAL_MS = 5000;
const FORCE_SUBMIT_REASON = "申请人在小程序确认非重复并坚持提交";

// 和服务端 PUT 闸门同口径：这些状态只能看。申请人在已签收之后也改不了。
const EDITABLE_STATUSES = ["none", "draft", "unregistered", "submitted"];
const RETURNED_PRECHECK_STATUSES = ["supplement", "rejected"];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => UUID_REGEX.test(String(value || "").trim());
const normalizeScannedUuid = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (isValidUuid(text)) return text;
  const queryMatch = text.match(/(?:^|[?&#])envelope_uuid=([0-9a-fA-F-]{36})(?:[&#]|$)/i);
  if (queryMatch && isValidUuid(queryMatch[1])) return queryMatch[1];
  const uuidMatch = text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/);
  return uuidMatch && isValidUuid(uuidMatch[0]) ? uuidMatch[0] : "";
};

const toDateInputValue = (value) => (value ? String(value).slice(0, 10) : "");

const toAmountInput = (value) => (Number(value) > 0 ? String(value) : "");

const isUserCancel = (error) => {
  const message = rawErrorText(error).toLowerCase();
  return message.includes("cancel") || message.includes("取消");
};

const emptyDraft = () => ({
  project_id: "",
  channel: "physical",
  preferred_envelope_uuid: "",
  expense_date: "",
  amount: "",
  category: "办公费用",
  description: ""
});

const emptyPageState = () => ({
  mode: "create",
  sharedProjectId: 0,
  channelIndex: 0,
  draft: emptyDraft(),
  latestEnvelopeId: 0,
  latestEnvelopeStatus: "none",
  latestEnvelopeUuid: "",
  latestPrecheckStatus: "none",
  amountTouched: false,
  expandedKey: "",
  submitRequestKey: ""
});

Page({
  data: {
    ...emptyPageState(),
    channelOptions: [
      { value: "physical", label: "实物信封" },
      { value: "electronic", label: "电子发票" }
    ],
    busy: false,
    uploading: false,
    editLocked: false,
    canUpload: true,
    headline: "",
    nextStep: "",
    tone: "normal",
    actions: [],
    rows: [],
    totalsText: "",
    canSubmit: false
  },

  onLoad(options) {
    this.createQueue();
    const id = Number((options && options.id) || 0);
    this.refreshView();
    if (id) {
      this.setData({ mode: "detail", latestEnvelopeId: id });
      return this.loadEnvelopeDetail(id);
    }
    return undefined;
  },

  onShow() {
    this._hidden = false;
    if (this.data.latestEnvelopeId) {
      this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    }
  },

  onHide() {
    this._hidden = true;
    this.stopPolling();
  },

  onUnload() {
    this._hidden = true;
    this.stopPolling();
  },

  createQueue() {
    this._detail = null;
    this._creatingEnvelope = null;
    this._queue = createUploadQueue({
      concurrency: UPLOAD_CONCURRENCY,
      uploadOne: (item) => this.uploadOne(item),
      onChange: () => this.refreshView()
    });
  },

  resetDraft() {
    if (this._queue && this._queue.isBusy()) {
      sayToast({ title: "还有文件在上传，传完再新建", icon: "none" });
      return;
    }
    this.stopPolling();
    this.createQueue();
    this.setData({ ...emptyPageState(), editLocked: false, canUpload: true });
    this.refreshView();
  },

  // ── 视图 ──

  canRemoveAttachment() {
    const { latestEnvelopeStatus, latestPrecheckStatus } = this.data;
    return (
      ["draft", "unregistered"].includes(latestEnvelopeStatus) ||
      (latestEnvelopeStatus === "submitted" && RETURNED_PRECHECK_STATUSES.includes(latestPrecheckStatus))
    );
  },

  refreshView() {
    const uploadItems = this._queue.getItems();
    const view = buildReimbursementView(this._detail, { uploadItems });
    const canDelete = this.canRemoveAttachment();
    this.setData({
      headline: view.headline,
      nextStep: view.nextStep,
      tone: view.tone,
      actions: view.actions,
      totalsText: view.totalsText,
      canSubmit: view.canSubmit,
      uploading: this._queue.isBusy(),
      rows: view.rows.map((row) => ({
        ...row,
        canDelete: row.kind === "attachment" && canDelete,
        expanded: row.key === this.data.expandedKey
      }))
    });
  },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  schedulePolling() {
    this.stopPolling();
    const totals = this._detail && this._detail.review_totals;
    if (this._hidden || !totals || totals.recognizing_count <= 0) return;
    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    }, POLL_INTERVAL_MS);
  },

  async loadEnvelopeDetail(id) {
    const targetId = Number(id || 0);
    if (!targetId) return;
    this._loadSequence = (this._loadSequence || 0) + 1;
    const sequence = this._loadSequence;
    try {
      const res = await request({ method: "GET", path: `/api/v1/reimbursement/${targetId}` });
      if (sequence !== this._loadSequence) return;
      this.applyDetail((res && res.data) || {}, targetId);
    } catch (error) {
      sayToast({ title: error.message || "加载详情失败", icon: "none", danger: true });
    }
  },

  applyDetail(detail, targetId) {
    this._detail = detail;
    const channel = detail.channel === "electronic" ? "electronic" : "physical";
    const totals = detail.review_totals;
    const amount = resolveDeclaredAmount({
      storedAmount: detail.amount,
      extractedTotal: totals ? totals.extracted_total : 0,
      touched: this.data.amountTouched,
      currentValue: this.data.draft.amount
    });
    this.setData({
      mode: "detail",
      sharedProjectId: Number(detail.project_id || 0),
      channelIndex: channel === "electronic" ? 1 : 0,
      "draft.project_id": String(detail.project_id || ""),
      "draft.channel": channel,
      "draft.preferred_envelope_uuid": detail.envelope_uuid || "",
      "draft.expense_date": toDateInputValue(detail.expense_date),
      "draft.amount": this.data.amountTouched ? amount : toAmountInput(amount),
      "draft.category": detail.category || "办公费用",
      "draft.description": detail.description || "",
      latestEnvelopeId: Number(detail.id || targetId),
      latestEnvelopeStatus: detail.status || "none",
      latestEnvelopeUuid: detail.envelope_uuid || "",
      latestPrecheckStatus: detail.precheck_status || "none",
      editLocked: !EDITABLE_STATUSES.includes(detail.status),
      canUpload: EDITABLE_STATUSES.includes(detail.status)
    });
    this.refreshView();
    this.schedulePolling();
  },

  // ── 表单 ──

  onDraftInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`draft.${key}`]: e.detail.value,
      ...(key === "amount" ? { amountTouched: true } : {})
    });
  },

  onProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    if (!projectId) return;
    this.setData({ sharedProjectId: projectId, "draft.project_id": String(projectId) });
  },

  onChannelChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.channelOptions[index] || this.data.channelOptions[0];
    this.setData({
      channelIndex: index,
      "draft.channel": selected.value,
      ...(selected.value === "electronic" ? { "draft.preferred_envelope_uuid": "" } : {})
    });
  },

  async scanQr() {
    try {
      const result = await wxScanCode();
      const scannedUuid = normalizeScannedUuid(result.result || "");
      if (!scannedUuid) {
        sayToast({ title: "未识别到有效的信封识别号，请重试", icon: "none", danger: true });
        return "";
      }
      this.setData({ "draft.preferred_envelope_uuid": scannedUuid });
      return scannedUuid;
    } catch {
      sayToast({ title: "扫码取消", icon: "none" });
      return "";
    }
  },

  /** 未登记的信封扫码后绑定填报人；还没存的新单只把识别号填进表单。 */
  async scanRegister() {
    const uuid = await this.scanQr();
    if (!uuid || !this.data.latestEnvelopeId) return;
    try {
      const res = await request({
        method: "POST",
        path: "/api/v1/reimbursement/scan",
        data: { envelope_uuid: uuid }
      });
      await this.loadEnvelopeDetail(Number((res && res.data && res.data.id) || this.data.latestEnvelopeId));
      vibrateSuccess();
      sayToast({ title: "已登记", icon: "success" });
    } catch (error) {
      vibrateWarning();
      sayToast({ title: error.message || "登记失败", icon: "none", danger: true });
    }
  },

  draftPayload() {
    const { draft } = this.data;
    return {
      project_id: Number(draft.project_id || 0),
      expense_date: draft.expense_date || undefined,
      amount: Number(draft.amount || 0) || undefined,
      category: draft.category || undefined,
      description: draft.description || undefined
    };
  },

  validateDraftBasics() {
    const { draft, latestEnvelopeId } = this.data;
    const projectError = positiveNumber(draft.project_id, "所属项目");
    if (projectError) return projectError;
    if (!latestEnvelopeId && draft.channel === "physical" && !isValidUuid(draft.preferred_envelope_uuid)) {
      return "实物信封要先扫码或填入识别号";
    }
    return "";
  },

  /** 第一个文件传完时建草稿。多个文件同时走到这里也只建一个。 */
  ensureEnvelopeId() {
    if (this.data.latestEnvelopeId) return Promise.resolve(this.data.latestEnvelopeId);
    if (this._creatingEnvelope) return this._creatingEnvelope;
    const { draft } = this.data;
    this._creatingEnvelope = request({
      method: "POST",
      path: "/api/v1/reimbursement",
      data: {
        ...this.draftPayload(),
        channel: draft.channel,
        preferred_envelope_uuid: draft.channel === "physical" ? draft.preferred_envelope_uuid : undefined
      }
    })
      .then((res) => {
        const envelopeId = Number((res && res.data && res.data.id) || 0);
        this.setData({ mode: "detail", latestEnvelopeId: envelopeId, latestEnvelopeStatus: "draft" });
        return envelopeId;
      })
      .finally(() => {
        this._creatingEnvelope = null;
      });
    return this._creatingEnvelope;
  },

  async saveDraft() {
    if (this.data.editLocked) {
      sayToast({ title: "当前状态不可修改，仅可查看", icon: "none" });
      return;
    }
    const errorText = this.validateDraftBasics();
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }
    return this.runBusy(async () => {
      if (this.data.latestEnvelopeId) {
        await request({
          method: "PUT",
          path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}`,
          data: this.draftPayload()
        });
      }
      const envelopeId = await this.ensureEnvelopeId();
      await this.loadEnvelopeDetail(envelopeId);
      vibrateSuccess();
      sayToast({ title: "已保存", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "保存失败", icon: "none", danger: true });
    });
  },

  runBusy(fn) {
    if (this.data.busy) return Promise.resolve();
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  // ── 上传 ──

  onUploadTap() {
    const errorText = this.validateDraftBasics();
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return undefined;
    }
    return new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ["拍照或从相册选图片", "从聊天记录选文件", "从手机选文件"],
        success: (res) => {
          const pickers = [this.pickImages, this.pickMessageFiles, this.pickLocalFiles];
          resolve(pickers[res.tapIndex].call(this));
        },
        fail: () => resolve()
      });
    });
  },

  pickImages() {
    return this.pickFiles(() => wxChooseMediaImage({ count: MAX_PICK_IMAGES }));
  },

  pickMessageFiles() {
    return this.pickFiles(() => wxChooseMessageFile({ count: MAX_PICK_FILES, type: "file" }));
  },

  pickLocalFiles() {
    return this.pickFiles(() => wxChooseLocalFile({ count: MAX_PICK_FILES, extension: ALLOWED_EXTENSIONS.map((ext) => `.${ext}`) }));
  },

  async pickFiles(choose) {
    let picked;
    try {
      const result = await choose();
      picked = (result && result.tempFiles) || [];
    } catch (error) {
      if (!isUserCancel(error)) {
        sayToast({ title: error.message || "选择文件失败", icon: "none", danger: true });
      }
      return;
    }
    this.addPickedFiles(picked);
  },

  addPickedFiles(picked) {
    const invalid = picked
      .map((file) => validatePickedFile(file.name, file.size))
      .filter(Boolean);
    const valid = picked.filter((file) => !validatePickedFile(file.name, file.size));
    const existing = ((this._detail && this._detail.attachment_views) || []).map((view) => ({
      name: view.file_name,
      size: view.file_size
    }));
    const { skipped } = this._queue.add(
      valid.map((file) => ({ name: file.name, size: file.size, path: file.path })),
      existing
    );
    const notices = [
      ...invalid,
      ...(skipped.length > 0 ? [`已跳过重复的文件：${skipped.join("、")}`] : [])
    ];
    if (notices.length > 0) {
      vibrateWarning();
      sayToast({ title: notices[0], icon: "none", danger: true });
    }
  },

  /** 每个文件独立走完「传 R2、绑定」。 */
  async uploadOne(item) {
    const file = await uploadFileToR2(item.path, {
      fileName: item.name,
      category: "reimbursement",
      debugContext: "reimbursement-attachment"
    });
    const envelopeId = await this.ensureEnvelopeId();
    await request({
      method: "POST",
      path: `/api/v1/reimbursement/${envelopeId}/attachments`,
      data: { attachments: [{ file_key: file.key, file_name: item.name, file_size: item.size }] }
    });
    await this.loadEnvelopeDetail(envelopeId);
  },

  retryUpload(e) {
    this._queue.retry(e.currentTarget.dataset.id);
  },

  // ── 结论区的按钮 ──

  onGuidanceAction(e) {
    const { key } = e.currentTarget.dataset;
    if (key === "submit" || key === "resubmit") return this.submitEnvelope();
    if (key === "rerecognize_failed") return this.rerecognizeFailed();
    if (key === "scan_register") return this.scanRegister();
    if (key === "view_batch") return this.showBatchInfo();
    return undefined;
  },

  showBatchInfo() {
    const batch = this._detail && this._detail.batch;
    wx.showModal({
      title: "所在批次",
      content: batch ? `${batch.batch_no}（${statusLabel(batch.status, "处理中")}）` : "暂无批次信息",
      showCancel: false
    });
  },

  async rerecognizeFailed() {
    const failedRows = this.data.rows.filter((row) => row.canRerecognize);
    return this.runBusy(async () => {
      await Promise.all(
        failedRows.map((row) =>
          request({
            method: "POST",
            path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/attachments/${row.attachmentId}/rerecognize`
          })
        )
      );
      await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
      sayToast({ title: "已重新识别", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "重新识别失败", icon: "none", danger: true });
    });
  },

  rerecognizeOne(e) {
    const { id } = e.currentTarget.dataset;
    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/attachments/${id}/rerecognize`
      });
      await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "重新识别失败", icon: "none", danger: true });
    });
  },

  // ── 提交 ──

  isForceSubmitRequired(error) {
    // 只认 409 + 结构化标志的组合；单独 409 无法区分重复和进行中，一律不当成重复
    const body = error && error.__responseBody;
    return (
      Number(error && error.__statusCode) === 409 &&
      !!(body && body.data && body.data.require_force_submit === true)
    );
  },

  confirmForceSubmit(payloadData) {
    const data = payloadData || {};
    const checks = Array.isArray(data.duplicate_checks) ? data.duplicate_checks : [];
    const total = Number(data.duplicate_total ?? data.duplicate_count ?? checks.length);
    const high = checks.filter((item) => item && item.risk_level === "high").length;
    const lines = [];
    if (total > 0) {
      lines.push(high > 0 ? `发现 ${total} 条疑似重复（含高风险 ${high} 条）` : `发现 ${total} 条疑似重复记录`);
    } else {
      lines.push("系统提示该报销疑似重复");
    }
    if (checks[0] && checks[0].summary) {
      lines.push(`如：${checks[0].summary}`);
    }
    lines.push("确认不是重复报销才可坚持提交；该确认将留痕并由办公室复核，属实重复将被驳回。");
    return new Promise((resolve) => {
      wx.showModal({
        title: "疑似重复报销",
        content: lines.join("\n"),
        confirmText: "坚持提交",
        cancelText: "返回检查",
        confirmColor: "#e34d59",
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  },

  newSubmitKey() {
    const key = `rm-submit-${this.data.latestEnvelopeId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.setData({ submitRequestKey: key });
    return key;
  },

  async submitEnvelope() {
    if (!this.data.canSubmit) {
      sayToast({ title: this.data.uploading ? "还有文件没传完" : "现在不能提交", icon: "none" });
      return;
    }
    if (!(Number(this.data.draft.amount) > 0)) {
      vibrateWarning();
      sayToast({ title: "请填写报销金额", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      wx.showLoading({ title: "提交中...", mask: true });
      const envelopeId = this.data.latestEnvelopeId;
      const isResubmit = this.data.actions.some((action) => action.key === "resubmit");
      await request({
        method: "PUT",
        path: `/api/v1/reimbursement/${envelopeId}`,
        data: this.draftPayload()
      });

      const firstKey = this.data.submitRequestKey || this.newSubmitKey();
      let forced = false;
      try {
        await request({
          method: "POST",
          path: `/api/v1/reimbursement/${envelopeId}/submit`,
          header: { "Idempotency-Key": firstKey }
        });
      } catch (error) {
        if (!this.isForceSubmitRequired(error)) throw error;
        wx.hideLoading();
        await this.loadEnvelopeDetail(envelopeId);
        const confirmed = await this.confirmForceSubmit(error.__responseBody.data);
        if (!confirmed || this.data.latestEnvelopeId !== envelopeId) {
          vibrateWarning();
          sayToast({ title: "已取消，可核对查重提示后再提交", icon: "none" });
          return;
        }
        wx.showLoading({ title: "提交中...", mask: true });
        // 409 时服务端已放弃这个幂等键，重发必须换新的
        await request({
          method: "POST",
          path: `/api/v1/reimbursement/${envelopeId}/submit`,
          data: { force_submit: true, force_submit_reason: FORCE_SUBMIT_REASON },
          header: { "Idempotency-Key": this.newSubmitKey() }
        });
        forced = true;
      }

      // 成功后作废幂等键：单子被退回再提交时要算新的一次
      this.setData({ submitRequestKey: "", amountTouched: false });
      await this.loadEnvelopeDetail(envelopeId);
      vibrateSuccess();
      wx.hideLoading();
      if (forced) {
        sayToast({ title: "已坚持提交，办公室将重点复核", icon: "none" });
        return;
      }
      sayToast({ title: isResubmit ? "已重新提交" : "报销已提交", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      wx.hideLoading();
      const title =
        Number(error && error.__statusCode) === 409
          ? "提交被拦截或正在处理中，请稍后刷新重试"
          : error.message || "提交失败";
      sayToast({ title, icon: "none", danger: true });
    });
  },

  // ── 文件行 ──

  toggleRow(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ expandedKey: this.data.expandedKey === key ? "" : key });
    this.refreshView();
  },

  openAttachment(e) {
    const row = this.data.rows.find((item) => item.key === e.currentTarget.dataset.key);
    if (!row || !row.fileKey) return undefined;
    return openQueryAttachment({ key: row.fileKey, name: row.fileName }, "reimbursement");
  },

  removeAttachment(e) {
    const attachmentId = Number(e.currentTarget.dataset.id || 0);
    if (!attachmentId || !this.canRemoveAttachment()) return undefined;
    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/attachments/${attachmentId}/delete`
      });
      await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
      vibrateSuccess();
      sayToast({ title: "附件已删除", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "删除失败", icon: "none", danger: true });
    });
  },

  goMyList() {
    wx.redirectTo({ url: "/packageFinance/reimbursement-list/index" });
  }
});
