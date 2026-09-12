const { request, buildUrl } = require("../../utils/request");
const { localizeNetworkErrorMessage, rawErrorText } = require("../../utils/error-message");
const {
  statusLabel,
  riskLevelLabel,
  attachmentTypeLabel,
  duplicateMatchTypeLabel
} = require("../../utils/enum-labels");
const { uploadFileToR2 } = require("../../utils/upload");
const {
  wxScanCode,
  wxChooseMediaImage,
  wxChooseLocalFile,
  wxChooseMessageFile,
  isMessageFilePickerSupported
} = require("../../utils/wx");
const { positiveNumber, firstError } = require("../../utils/validation");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");

const statusText = (status) => {
  const map = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已填报",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已拒绝",
    cancelled: "已废止",
    pending: "处理中",
    completed: "已完成",
    failed: "失败"
  };
  return map[status] || "未知";
};

const verificationStatusText = (status) => {
  const map = {
    pending: "待核验",
    verified: "已核验",
    mismatch: "核验异常"
  };
  return map[status] || "未知";
};

const precheckStatusText = (status) => {
  const map = {
    none: "未复核",
    pending: "待复核",
    approved: "复核通过",
    supplement: "待补充",
    rejected: "复核驳回"
  };
  return map[status] || "未知";
};

const taskStatusText = (status) => {
  const map = {
    none: "未触发",
    pending: "处理中",
    completed: "已完成",
    failed: "失败"
  };
  return map[status] || "未知";
};

const riskText = (risk) => riskLevelLabel(risk);

const toDateInputValue = (value) => {
  if (!value) return "";
  return String(value).slice(0, 10);
};

const isImageByName = (name) => {
  const lower = String(name || "").toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].some((ext) =>
    lower.endsWith(ext)
  );
};

const COMMON_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "ofd",
  "xml",
  "txt",
  "doc",
  "docx",
  "xls",
  "xlsx"
];
const ELECTRONIC_INVOICE_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "ofd",
  "xml"
];
const getExtName = (nameOrPath) => {
  const source = String(nameOrPath || "").trim().toLowerCase();
  if (!source || !source.includes(".")) return "";
  return source.split(".").pop() || "";
};
const isAllowedExtension = (nameOrPath, allowlist) => {
  const ext = getExtName(nameOrPath);
  return ext ? allowlist.includes(ext) : false;
};

const getPickedFilePath = (file) => {
  if (!file || typeof file !== "object") return "";
  return String(file.path || file.tempFilePath || file.tempPath || "");
};

const getPickedFileName = (file, fallbackPrefix = "附件") => {
  if (file && typeof file.name === "string" && file.name.trim()) {
    return file.name.trim();
  }
  const filePath = getPickedFilePath(file);
  const normalized = filePath.replace(/\\/g, "/");
  const tail = normalized.split("/").pop() || "";
  if (tail && tail.includes(".")) return tail;
  const ext = getExtName(filePath);
  return `${fallbackPrefix}-${Date.now()}${ext ? `.${ext}` : ""}`;
};

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

const FORCE_SUBMIT_REASON = "申请人在小程序确认非重复并坚持提交";

const UPLOAD_DEBUG_STORAGE_KEY = "reimbursement-upload-debug-trace";

const extractErrorMessage = (error, fallback = "上传失败") => {
  if (error instanceof Error && error.message) {
    // Error 分支同样收口：英文 message（原生 TypeError、客户端差异报错）不透给 toast
    return /[一-鿿]/.test(error.message)
      ? error.message
      : localizeNetworkErrorMessage(error.message);
  }
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    // 微信基础库的 errMsg 是英文（request:fail / chooseMedia:fail …），
    // 直接进 toast 就是一串英文，这里统一中文化。
    const errMsg = error.errMsg || error.message;
    if (typeof errMsg === "string" && errMsg.trim()) {
      return localizeNetworkErrorMessage(errMsg.trim());
    }
  }
  return fallback;
};

const sanitizeUploadDebugValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUploadDebugValue(item)).join(",");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildUploadDebugMetaSuffix = (meta = {}) => {
  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${sanitizeUploadDebugValue(value)}`);
  return pairs.length ? ` | ${pairs.join(" | ")}` : "";
};

const buildUploadDebugStageError = (stage, errorOrMessage, meta = {}) => {
  // 同 utils/upload.js：toast 只能看到中文；英文原文透传 __rawErrMsg
  // （cancel/不支持等能力判定依赖它），调试串带原文进控制台。
  const message = extractErrorMessage(errorOrMessage);
  const rawText = rawErrorText(errorOrMessage);
  const debugText = `[upload-debug:reimbursement:${stage}] ${rawText || message}${buildUploadDebugMetaSuffix(meta)}`;
  const wrapped = new Error(message);
  wrapped.__rawErrMsg = rawText;
  wrapped.__uploadDebugText = debugText;
  wrapped.__uploadDebugStage = stage;
  wrapped.__uploadDebugMeta = meta;
  console.warn(debugText);
  return wrapped;
};

const summarizePickedFile = (file) => {
  if (!file || typeof file !== "object") return { exists: false };
  return {
    exists: true,
    keys: Object.keys(file).sort().join(","),
    name: typeof file.name === "string" ? file.name : "",
    fileName: typeof file.fileName === "string" ? file.fileName : "",
    path: typeof file.path === "string" ? file.path : "",
    tempFilePath: typeof file.tempFilePath === "string" ? file.tempFilePath : "",
    tempPath: typeof file.tempPath === "string" ? file.tempPath : "",
    size: Number.isFinite(file.size) ? String(file.size) : "",
    fileSize: Number.isFinite(file.fileSize) ? String(file.fileSize) : ""
  };
};

const formatUploadDebugLine = (entry) => {
  const detail = entry && entry.detail ? buildUploadDebugMetaSuffix(entry.detail) : "";
  return `${entry.time || ""} ${entry.stage || "unknown"}${detail}`.trim();
};

const trimDebugContent = (value, maxLength = 980) => {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const isUserCancelError = (error) => {
  const message = rawErrorText(error).toLowerCase();
  return message.includes("cancel") || message.includes("取消");
};

const isLocalFilePickerUnsupportedError = (error) => {
  const message = rawErrorText(error).toLowerCase();
  // chooseFile:fail cancel 同样含 "choosefile" 子串，用户取消不能误判成客户端不支持
  if (message.includes("cancel") || message.includes("取消")) return false;
  return message.includes("不支持本地文件选择") || message.includes("local file") || message.includes("choosefile");
};

// 与服务端 PUT 闸门同口径（reimbursement.ts immutableStatuses）：这些状态不可再修改
const LOCKED_EDIT_STATUSES = ["batched", "pending_approval", "approved", "paid"];

Page({
  data: {
    mode: "create",
    sharedProjectId: 0,
    draft: {
      project_id: "",
      channel: "physical",
      preferred_envelope_uuid: "",
      invoice_no: "",
      expense_date: "",
      amount: "",
      category: "办公费用",
      description: ""
    },
    channelOptions: [
      { value: "physical", label: "实物信封" },
      { value: "electronic", label: "电子发票" }
    ],
    attachmentTypeOptions: [
      { value: "invoice", label: "发票" },
      { value: "receipt", label: "收据" },
      { value: "contract", label: "合同" },
      { value: "other", label: "其他" }
    ],
    channelIndex: 0,
    attachmentTypeIndex: 0,
    latestEnvelopeId: 0,
    latestEnvelopeNo: "",
    latestEnvelopeUuid: "",
    latestEnvelopeStatus: "none",
    latestEnvelopeStatusText: "未创建",
    editLocked: false,
    verificationStatusText: "待核验",
    precheckStatusText: "未复核",
    pdfStatusText: "未触发",
    batchInfoText: "未入批次",
    attachmentCount: 0,
    attachmentItems: [],
    duplicateChecks: [],
    ocrStatus: "none",
    ocrStatusText: "未开始",
    busy: false,
    submitRequestKey: ""
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (id) {
      this.setData({ mode: "detail", latestEnvelopeId: id });
      this.loadEnvelopeDetail(id);
      return;
    }
    this.resetDraft();
  },

  onShow() {
    if (this.data.latestEnvelopeId) {
      this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    }
  },

  onUnload() {
    this.resetDraft();
  },

  resetDraft() {
    this.resetUploadDebugTrace();
    this.setData({
      mode: "create",
      sharedProjectId: 0,
      channelIndex: 0,
      attachmentTypeIndex: 0,
      draft: {
        project_id: "",
        channel: "physical",
        preferred_envelope_uuid: "",
        invoice_no: "",
        expense_date: "",
        amount: "",
        category: "办公费用",
        description: ""
      },
      latestEnvelopeId: 0,
      latestEnvelopeNo: "",
      latestEnvelopeUuid: "",
      latestEnvelopeStatus: "none",
      latestEnvelopeStatusText: "未创建",
      editLocked: false,
      verificationStatusText: "待核验",
      precheckStatusText: "未复核",
      pdfStatusText: "未触发",
      batchInfoText: "未入批次",
      attachmentCount: 0,
      attachmentItems: [],
      duplicateChecks: [],
      ocrStatus: "none",
      ocrStatusText: "未开始",
      submitRequestKey: ""
    });
  },

  canRemoveAttachment() {
    return ["draft", "unregistered"].includes(this.data.latestEnvelopeStatus);
  },

  ensureSubmitRequestKey() {
    if (this.data.submitRequestKey) return this.data.submitRequestKey;
    const key = `rm-submit-${this.data.latestEnvelopeId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.setData({ submitRequestKey: key });
    return key;
  },

  rotateSubmitRequestKey() {
    const key = `rm-submit-${this.data.latestEnvelopeId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.setData({ submitRequestKey: key });
    return key;
  },

  isForceSubmitRequired(error) {
    // 只认 409 + 结构化标志的组合;单独 409 无法区分 duplicate 与 in-progress,一律 fail-closed
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
      lines.push(
        high > 0
          ? `发现 ${total} 条疑似重复（含高风险 ${high} 条）`
          : `发现 ${total} 条疑似重复记录`
      );
    } else {
      lines.push("系统提示该报销疑似重复");
    }
    if (checks[0] && checks[0].summary) {
      lines.push(`如：${checks[0].summary}`);
    }
    lines.push(
      "确认不是重复报销才可坚持提交；该确认将留痕并由办公室复核，属实重复将被驳回。"
    );
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

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  resetUploadDebugTrace() {
    this.uploadDebugTrace = [];
    try {
      wx.removeStorageSync(UPLOAD_DEBUG_STORAGE_KEY);
    } catch {
      // ignore storage failures during debug tracing
    }
  },

  appendUploadDebugTrace(stage, detail = {}, level = "info") {
    const entry = {
      time: new Date().toISOString().slice(11, 19),
      stage,
      level,
      detail: Object.keys(detail || {}).reduce((acc, key) => {
        acc[key] = sanitizeUploadDebugValue(detail[key]);
        return acc;
      }, {})
    };
    const next = (Array.isArray(this.uploadDebugTrace) ? this.uploadDebugTrace : [])
      .concat([entry])
      .slice(-12);
    this.uploadDebugTrace = next;

    try {
      wx.setStorageSync(UPLOAD_DEBUG_STORAGE_KEY, next);
    } catch {
      // ignore storage failures during debug tracing
    }

    try {
      const logger =
        typeof wx.getRealtimeLogManager === "function" ? wx.getRealtimeLogManager() : null;
      const line = `[rm-upload][${level}] ${formatUploadDebugLine(entry)}`;
      if (logger) {
        const method = typeof logger[level] === "function" ? level : "info";
        logger[method](line);
      }
    } catch {
      // ignore realtime log manager failures during debug tracing
    }

    return entry;
  },

  beginUploadDebugTrace(flow, detail = {}) {
    this.resetUploadDebugTrace();
    this.appendUploadDebugTrace(`${flow}.begin`, detail);
  },

  showUploadDebugFailure(error, fallbackTitle = "上传失败") {
    if (isUserCancelError(error)) {
      sayToast({ title: "已取消", icon: "none" });
      return;
    }

    const message = extractErrorMessage(error, fallbackTitle);
    this.appendUploadDebugTrace("failure", { message }, "error");
    // 英文阶段轨迹只进控制台（appendUploadDebugTrace 已打日志），弹窗只给中文
    const content = trimDebugContent(
      [`失败信息：${message}`, "", "如多次失败，请截图联系管理员，并说明操作步骤。"].join("\n")
    );

    sayToast({ title: fallbackTitle, icon: "none", danger: true });
    wx.showModal({
      title: "上传调试信息",
      content,
      showCancel: false
    });
  },

  promptMessageFileFallback(scene) {
    if (!isMessageFilePickerSupported()) {
      sayToast({ title: "当前客户端不支持文件上传，请升级企业微信后重试", icon: "none", danger: true });
      return;
    }
    const content =
      scene === "electronic"
        ? "当前客户端不支持本地文件选择。是否改为“从会话文件选择”继续上传电子票据？"
        : "当前客户端不支持本地文件选择。是否改为“从会话文件选择”继续上传附件？";

    wx.showModal({
      title: "本地文件不可用",
      content,
      confirmText: "继续选择",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        if (scene === "electronic") {
          this.pickElectronicInvoiceMessageFile();
          return;
        }
        this.pickAttachmentMessageFile();
      }
    });
  },

  onDraftInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`draft.${key}`]: e.detail.value });
  },

  onProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    if (!projectId) return;
    this.setData({
      sharedProjectId: projectId,
      "draft.project_id": String(projectId)
    });
  },

  onChannelChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.channelOptions[index] || this.data.channelOptions[0];
    if (selected.value === "electronic") {
      this.setData({
        channelIndex: index,
        "draft.channel": selected.value,
        "draft.preferred_envelope_uuid": ""
      });
      return;
    }
    this.setData({ channelIndex: index, "draft.channel": selected.value });
  },

  onAttachmentTypeChange(e) {
    const index = Number(e.detail.value || 0);
    this.setData({ attachmentTypeIndex: index });
  },

  getCurrentAttachmentType() {
    const selected = this.data.attachmentTypeOptions[this.data.attachmentTypeIndex];
    return (selected && selected.value) || "invoice";
  },

  async uploadAttachmentFromPath(filePath, fileName) {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }
    if (!filePath) return;

    const attachmentType = this.getCurrentAttachmentType();
    this.appendUploadDebugTrace("attachment.upload.start", {
      envelopeId: this.data.latestEnvelopeId,
      attachmentType,
      filePath,
      fileName
    });

    const file = await uploadFileToR2(filePath, {
      fileName: fileName || undefined,
      category: "reimbursement",
      debugContext: "reimbursement-attachment"
    });
    this.appendUploadDebugTrace("attachment.upload.r2.success", {
      fileKey: file.key,
      fileName: fileName || file.key
    });

    try {
      await request({
        method: "PUT",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}`,
        data: {
          invoice_no: this.data.draft.invoice_no || undefined,
          amount: Number(this.data.draft.amount || 0) || undefined,
          expense_date: this.data.draft.expense_date || undefined,
          category: this.data.draft.category || undefined,
          description: this.data.draft.description || undefined,
          attachments: [
            {
              attachment_type: attachmentType,
              file_key: file.key,
              file_name: fileName || file.key
            }
          ]
        }
      });
    } catch (error) {
      throw buildUploadDebugStageError("attachment-bind", error, {
        envelopeId: this.data.latestEnvelopeId,
        attachmentType,
        fileKey: file.key
      });
    }
    this.appendUploadDebugTrace("attachment.bind.success", {
      envelopeId: this.data.latestEnvelopeId,
      attachmentType,
      fileKey: file.key
    });

    await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    vibrateSuccess();
    sayToast({ title: "附件上传成功", icon: "success" });
  },

  async scanQr() {
    try {
      const result = await wxScanCode();
      const scannedUuid = normalizeScannedUuid(result.result || "");
      if (!scannedUuid) {
        sayToast({ title: "未识别到有效的信封识别号，请重试", icon: "none", danger: true });
        return;
      }
      this.setData({ "draft.preferred_envelope_uuid": scannedUuid });
    } catch {
      sayToast({ title: "扫码取消", icon: "none" });
    }
  },

  async createOrUpdateDraft() {
    if (this.data.editLocked) {
      sayToast({
        title: `${this.data.latestEnvelopeStatusText}状态不可修改，仅可查看`,
        icon: "none"
      });
      return;
    }
    const { draft, latestEnvelopeId } = this.data;
    const errorText = firstError([positiveNumber(draft.project_id, "所属项目")]);
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }
    if (draft.channel === "physical" && !isValidUuid(draft.preferred_envelope_uuid)) {
      sayToast({ title: "实物信封必须先扫描或录入有效的信封识别号", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      if (latestEnvelopeId) {
        await request({
          method: "PUT",
          path: `/api/v1/reimbursement/${latestEnvelopeId}`,
          data: {
            project_id: Number(draft.project_id || 0),
            channel: draft.channel || "physical",
            invoice_no: draft.invoice_no || undefined,
            expense_date: draft.expense_date || undefined,
            amount: Number(draft.amount || 0) || undefined,
            category: draft.category || undefined,
            description: draft.description || undefined
          }
        });
        await this.loadEnvelopeDetail(latestEnvelopeId);
        vibrateSuccess();
        sayToast({ title: "草稿已保存", icon: "success" });
        return;
      }

      const res = await request({
        method: "POST",
        path: "/api/v1/reimbursement",
        data: {
          project_id: Number(draft.project_id || 0),
          channel: draft.channel || "physical",
          preferred_envelope_uuid:
            draft.channel === "physical"
              ? draft.preferred_envelope_uuid || undefined
              : undefined,
          invoice_no: draft.invoice_no || undefined,
          expense_date: draft.expense_date || undefined,
          amount: Number(draft.amount || 0) || undefined,
          category: draft.category || undefined,
          description: draft.description || undefined
        }
      });

      const envelopeId = Number((res && res.data && res.data.id) || 0);
      const envelopeNo = (res && res.data && res.data.envelope_no) || "";
      const envelopeUuid = (res && res.data && res.data.envelope_uuid) || "";
      this.setData({
        mode: "detail",
        latestEnvelopeId: envelopeId,
        latestEnvelopeNo: envelopeNo,
        latestEnvelopeUuid: envelopeUuid,
        latestEnvelopeStatus: "draft",
        latestEnvelopeStatusText: statusText("draft")
      });
      await this.loadEnvelopeDetail(envelopeId);
      vibrateSuccess();
      sayToast({ title: `草稿已创建：${envelopeNo || envelopeUuid || envelopeId}`, icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "保存失败", icon: "none", danger: true });
    });
  },

  async pickInvoicePhoto() {
    const errorText = positiveNumber(this.data.draft.project_id, "所属项目");
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickInvoicePhoto", {
        channel: this.data.draft.channel,
        projectId: this.data.draft.project_id
      });
      const choose = await wxChooseMediaImage().catch((error) => {
        throw buildUploadDebugStageError("choose-image", error);
      });
      const picked = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-image.result", summarizePickedFile(picked));
      const filePath = getPickedFilePath(picked);
      const fileName = getPickedFileName(picked, "发票");
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "图片路径为空", summarizePickedFile(picked));
      }
      await this.uploadElectronicInvoice(filePath, fileName || `invoice-${Date.now()}.jpg`);
    }).catch((error) => {
      vibrateWarning();
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  // Electronic envelopes hold exactly one invoice. Uploading onto a draft
  // that already has one is ambiguous — the user may want to correct the
  // current invoice (replace) or reimburse a second one (new envelope) —
  // so we must ask instead of silently replacing.
  askElectronicReuploadDecision() {
    return new Promise((resolve) => {
      wx.showActionSheet({
        alertText: "当前报销单已有一张发票（一单一票）",
        itemList: ["替换当前发票（原发票将被移除）", "另建一单报销这张发票"],
        success: (res) => resolve(res.tapIndex === 0 ? "replace" : "create"),
        fail: () => resolve("cancel")
      });
    });
  },

  async uploadElectronicInvoice(filePath, fileName) {
    if (!filePath) return;
    const uploadName = fileName || `invoice-${Date.now()}`;
    const currentDraftId = Number(this.data.latestEnvelopeId || 0);
    const hasActiveInvoice = currentDraftId > 0 && Number(this.data.attachmentCount || 0) > 0;
    let replaceConfirmed = false;
    if (hasActiveInvoice) {
      const decision = await this.askElectronicReuploadDecision();
      this.appendUploadDebugTrace("electronic.reupload.decision", {
        decision,
        envelopeId: currentDraftId
      });
      if (decision === "cancel") {
        sayToast({ title: "已取消上传", icon: "none" });
        return;
      }
      replaceConfirmed = decision === "replace";
    }
    this.appendUploadDebugTrace("electronic.upload.start", {
      projectId: this.data.draft.project_id,
      filePath,
      fileName: uploadName
    });
    const file = await uploadFileToR2(filePath, {
      fileName: uploadName,
      category: "reimbursement",
      debugContext: "reimbursement-electronic"
    });
    this.appendUploadDebugTrace("electronic.upload.r2.success", {
      fileKey: file.key,
      fileName: uploadName
    });
    // Reuse the draft we are currently editing instead of creating a new
    // envelope on every upload. The server only honours this when it is the
    // caller's own unsubmitted electronic draft, so submitted records are
    // never touched and stale ids simply create a fresh envelope. When the
    // draft already has an invoice, the user's choice above decides between
    // in-place replacement (replace: true) and a fresh envelope (no id) —
    // the server rejects an unconfirmed replacement with 409.
    const creatingSeparateEnvelope = hasActiveInvoice && !replaceConfirmed;
    const activeDraftId = creatingSeparateEnvelope ? undefined : currentDraftId || undefined;
    // “另建一单”时表单里仍是上一张发票回填的数据（发票号/金额/日期），
    // 带过去会把旧发票号写进新信封、污染查重——新信封只带项目和文件，
    // 票面信息留给提交后的自动识别。
    const carryDraftFields = !creatingSeparateEnvelope;
    let res;
    try {
      res = await request({
        method: "POST",
        path: "/api/v1/reimbursement/electronic-upload",
        data: {
          project_id: Number(this.data.draft.project_id || 0),
          envelope_id: activeDraftId,
          replace: replaceConfirmed || undefined,
          file_key: file.key,
          file_name: uploadName,
          invoice_no: carryDraftFields ? this.data.draft.invoice_no || undefined : undefined,
          amount: carryDraftFields
            ? Number(this.data.draft.amount || 0) || undefined
            : undefined,
          issue_date: carryDraftFields ? this.data.draft.expense_date || undefined : undefined,
          description: carryDraftFields ? this.data.draft.description || undefined : undefined
        }
      });
    } catch (error) {
      throw buildUploadDebugStageError("electronic-bind", error, {
        projectId: this.data.draft.project_id,
        fileKey: file.key,
        fileName: uploadName
      });
    }
    const envelopeId = Number((res && res.data && res.data.id) || 0);
    this.appendUploadDebugTrace("electronic.bind.success", {
      envelopeId,
      fileKey: file.key,
      fileName: uploadName
    });
    this.setData({
      mode: "detail",
      latestEnvelopeId: envelopeId,
      ocrStatus: "none",
      ocrStatusText: "系统将于提交后自动处理"
    });
    if (envelopeId) {
      await this.loadEnvelopeDetail(envelopeId);
    }
    vibrateSuccess();
    sayToast({ title: "电子发票已上传，请确认信息后提交", icon: "success" });
  },

  async pickElectronicInvoiceFile() {
    const errorText = positiveNumber(this.data.draft.project_id, "所属项目");
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickElectronicInvoiceFile", {
        channel: this.data.draft.channel,
        projectId: this.data.draft.project_id
      });
      const choose = await wxChooseLocalFile({
        count: 1,
        extension: ELECTRONIC_INVOICE_EXTENSIONS.map((ext) => `.${ext}`)
      }).catch((error) => {
        throw buildUploadDebugStageError("choose-local-file", error);
      });
      const file = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-local-file.result", summarizePickedFile(file));
      const filePath = getPickedFilePath(file);
      const fileName = getPickedFileName(file, "发票") || `发票-${Date.now()}.pdf`;
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "文件路径为空", summarizePickedFile(file));
      }
      if (!isAllowedExtension(fileName || filePath, ELECTRONIC_INVOICE_EXTENSIONS)) {
        this.appendUploadDebugTrace("extension-rejected", { filePath, fileName }, "warn");
        sayToast({
          title: "自动识别仅支持图片/PDF/OFD/TIFF/HEIC/XML",
          icon: "none",
          danger: true
        });
        return;
      }
      await this.uploadElectronicInvoice(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      if (isLocalFilePickerUnsupportedError(error)) {
        this.appendUploadDebugTrace("choose-local-file.unsupported", {
          message: extractErrorMessage(error)
        }, "warn");
        this.promptMessageFileFallback("electronic");
        return;
      }
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  async pickElectronicInvoiceMessageFile() {
    const errorText = positiveNumber(this.data.draft.project_id, "所属项目");
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickElectronicInvoiceMessageFile", {
        channel: this.data.draft.channel,
        projectId: this.data.draft.project_id
      });
      const choose = await wxChooseMessageFile({ count: 1, type: "file" }).catch((error) => {
        throw buildUploadDebugStageError("choose-message-file.fallback", error);
      });
      const file = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-message-file.fallback.result", summarizePickedFile(file));
      const filePath = getPickedFilePath(file);
      const fileName = getPickedFileName(file, "发票") || `发票-${Date.now()}.pdf`;
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "文件路径为空", summarizePickedFile(file));
      }
      if (!isAllowedExtension(fileName || filePath, ELECTRONIC_INVOICE_EXTENSIONS)) {
        this.appendUploadDebugTrace("extension-rejected", { filePath, fileName }, "warn");
        sayToast({
          title: "自动识别仅支持图片/PDF/OFD/TIFF/HEIC/XML",
          icon: "none",
          danger: true
        });
        return;
      }
      await this.uploadElectronicInvoice(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  async pickPhysicalInvoicePhoto() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickPhysicalInvoicePhoto", {
        channel: this.data.draft.channel,
        envelopeId: this.data.latestEnvelopeId
      });
      const choose = await wxChooseMediaImage().catch((error) => {
        throw buildUploadDebugStageError("choose-image", error);
      });
      const picked = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-image.result", summarizePickedFile(picked));
      const filePath = getPickedFilePath(picked);
      const fileName = getPickedFileName(picked, "附件");
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "图片路径为空", summarizePickedFile(picked));
      }
      await this.uploadAttachmentFromPath(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  async pickAttachmentFile() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickAttachmentFile", {
        channel: this.data.draft.channel,
        envelopeId: this.data.latestEnvelopeId,
        attachmentType: this.getCurrentAttachmentType()
      });
      const choose = await wxChooseLocalFile({
        count: 1,
        extension: COMMON_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`)
      }).catch((error) => {
        throw buildUploadDebugStageError("choose-local-file", error);
      });
      const picked = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-local-file.result", summarizePickedFile(picked));
      const filePath = getPickedFilePath(picked);
      const fileName = getPickedFileName(picked, "附件");
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "文件路径为空", summarizePickedFile(picked));
      }
      if (filePath && !isAllowedExtension(fileName || filePath, COMMON_ATTACHMENT_EXTENSIONS)) {
        this.appendUploadDebugTrace("extension-rejected", { filePath, fileName }, "warn");
        sayToast({
          title: "仅支持常见票据/扫描格式（PDF、图片、OFD等）",
          icon: "none",
          danger: true
        });
        return;
      }
      await this.uploadAttachmentFromPath(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      if (isLocalFilePickerUnsupportedError(error)) {
        this.appendUploadDebugTrace("choose-local-file.unsupported", {
          message: extractErrorMessage(error)
        }, "warn");
        this.promptMessageFileFallback("attachment");
        return;
      }
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  async pickAttachmentMessageFile() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      this.beginUploadDebugTrace("pickAttachmentMessageFile", {
        channel: this.data.draft.channel,
        envelopeId: this.data.latestEnvelopeId,
        attachmentType: this.getCurrentAttachmentType()
      });
      const choose = await wxChooseMessageFile({ count: 1, type: "file" }).catch((error) => {
        throw buildUploadDebugStageError("choose-message-file.fallback", error);
      });
      const picked = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      this.appendUploadDebugTrace("choose-message-file.fallback.result", summarizePickedFile(picked));
      const filePath = getPickedFilePath(picked);
      const fileName = getPickedFileName(picked, "附件");
      this.appendUploadDebugTrace("path-parsed", { filePath, fileName });
      if (!filePath) {
        throw buildUploadDebugStageError("path-empty", "文件路径为空", summarizePickedFile(picked));
      }
      if (filePath && !isAllowedExtension(fileName || filePath, COMMON_ATTACHMENT_EXTENSIONS)) {
        this.appendUploadDebugTrace("extension-rejected", { filePath, fileName }, "warn");
        sayToast({
          title: "仅支持常见票据/扫描格式（PDF、图片、OFD等）",
          icon: "none",
          danger: true
        });
        return;
      }
      await this.uploadAttachmentFromPath(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      this.showUploadDebugFailure(error, "上传失败");
    });
  },

  onUploadTap() {
    if (this.data.draft.channel === "electronic") {
      wx.showActionSheet({
        itemList: ["上传图片（自动识别）", "上传本地PDF/票据文件（自动识别）"],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.pickInvoicePhoto();
            return;
          }
          this.pickElectronicInvoiceFile();
        }
      });
      return;
    }

    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    wx.showActionSheet({
      itemList: ["上传图片", "上传本地文件"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.pickPhysicalInvoicePhoto();
          return;
        }
        this.pickAttachmentFile();
      }
    });
  },

  async submitEnvelope() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    const envelopeUuid = String(
      this.data.latestEnvelopeUuid || this.data.draft.preferred_envelope_uuid || ""
    ).trim();
    if (this.data.draft.channel === "physical" && !isValidUuid(envelopeUuid)) {
      sayToast({
        title: "实体信封必须先扫码录入有效的信封识别号后再提交",
        icon: "none",
        danger: true
      });
      return;
    }

    return this.runBusy(async () => {
      wx.showLoading({ title: "提交中...", mask: true });
      const envelopeId = this.data.latestEnvelopeId;
      const idempotencyKey = this.ensureSubmitRequestKey();
      let forced = false;
      try {
        await request({
          method: "POST",
          path: `/api/v1/reimbursement/${envelopeId}/submit`,
          header: {
            "Idempotency-Key": idempotencyKey
          }
        });
      } catch (error) {
        if (!this.isForceSubmitRequired(error)) throw error;
        wx.hideLoading();
        await this.loadEnvelopeDetail(envelopeId).catch(() => {});
        const confirmed = await this.confirmForceSubmit(error.__responseBody.data);
        if (!confirmed || this.data.latestEnvelopeId !== envelopeId) {
          vibrateWarning();
          sayToast({ title: "已取消，可核对查重提示后再提交", icon: "none" });
          return;
        }
        wx.showLoading({ title: "提交中...", mask: true });
        // 409 时服务端已 abandon 幂等记录,重发必须换新 key,避免撞残留 pending 卡死
        const forceKey = this.rotateSubmitRequestKey();
        await request({
          method: "POST",
          path: `/api/v1/reimbursement/${envelopeId}/submit`,
          data: {
            force_submit: true,
            force_submit_reason: FORCE_SUBMIT_REASON
          },
          header: {
            "Idempotency-Key": forceKey
          }
        });
        forced = true;
      }

      await this.loadEnvelopeDetail(envelopeId);
      vibrateSuccess();
      wx.hideLoading();

      if (forced) {
        sayToast({ title: "已坚持提交，办公室将重点复核", icon: "none" });
        return;
      }
      sayToast({ title: "报销已提交", icon: "success" });
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

  async removeAttachment(e) {
    if (!this.canRemoveAttachment()) {
      sayToast({ title: "仅可在提交前删除附件", icon: "none" });
      return;
    }
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none" });
      return;
    }
    const attachmentId = Number((e.currentTarget.dataset && e.currentTarget.dataset.id) || 0);
    if (!attachmentId) return;

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

  async refreshOcrStatus() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先创建报销", icon: "none" });
      return;
    }
    return this.runBusy(async () => {
      const res = await request({
        method: "GET",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/ocr-status`
      });
      const status = (res && res.data && res.data.status) || "unknown";
      this.setData({ ocrStatus: status, ocrStatusText: statusText(status) });
      if (status === "failed") {
        vibrateWarning();
      }
    }).catch((error) => sayToast({ title: error.message || "查询失败", icon: "none" }));
  },

  async loadEnvelopeDetail(id) {
    const targetId = Number(id || 0);
    if (!targetId) return;
    try {
      const res = await request({ method: "GET", path: `/api/v1/reimbursement/${targetId}` });
      const detail = (res && res.data) || {};
      const channel = detail.channel === "electronic" ? "electronic" : "physical";
      const channelIndex = channel === "electronic" ? 1 : 0;
      const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
      const duplicateChecks = Array.isArray(detail.duplicate_checks)
        ? detail.duplicate_checks.map((item) => ({
            id: item.id,
            summary: item.summary || duplicateMatchTypeLabel(item.match_type),
            risk: riskText(item.risk_level)
          }))
        : [];
      const batchInfoText = detail.batch && detail.batch.batch_no
        ? `${detail.batch.batch_no}（${statusLabel(detail.batch.status, "处理中")}）`
        : "未入批次";
      const attachmentItems = attachments.map((item) => {
        const fileKey = item.file_key || "";
        const fileName = item.file_name || fileKey || "未命名附件";
        const fileUrl = fileKey
          ? buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`)
          : "";
        return {
          id: item.id || `${fileKey}-${fileName}`,
          attachment_type: attachmentTypeLabel(item.attachment_type),
          file_key: fileKey,
          file_name: fileName,
          file_url: fileUrl,
          is_image: isImageByName(fileName)
        };
      });
      this.setData({
        mode: "detail",
        sharedProjectId: Number(detail.project_id || 0),
        channelIndex,
        "draft.project_id": String(detail.project_id || ""),
        "draft.channel": channel,
        "draft.preferred_envelope_uuid": detail.envelope_uuid || "",
        "draft.invoice_no": detail.invoice_no || "",
        "draft.expense_date": toDateInputValue(detail.expense_date),
        "draft.amount": detail.amount !== undefined && detail.amount !== null ? String(detail.amount) : "",
        "draft.category": detail.category || "办公费用",
        "draft.description": detail.description || "",
        latestEnvelopeId: Number(detail.id || targetId),
        latestEnvelopeNo: detail.envelope_no || "",
        latestEnvelopeUuid: detail.envelope_uuid || "",
        latestEnvelopeStatus: detail.status || "none",
        latestEnvelopeStatusText: statusText(detail.status),
        editLocked: LOCKED_EDIT_STATUSES.includes(detail.status),
        verificationStatusText: verificationStatusText(detail.verification_status),
        precheckStatusText: precheckStatusText(detail.precheck_status),
        pdfStatusText: taskStatusText(detail.pdf_status),
        batchInfoText,
        attachmentCount: attachmentItems.length,
        attachmentItems,
        duplicateChecks,
        ocrStatus: detail.ocr_status || "none",
        ocrStatusText: taskStatusText(detail.ocr_status || "none")
      });
    } catch (error) {
      sayToast({ title: error.message || "加载详情失败", icon: "none", danger: true });
    }
  },

  goMyList() {
    wx.redirectTo({ url: "/packageFinance/reimbursement-list/index" });
  },

  previewAttachment(e) {
    const { url, image } = e.currentTarget.dataset;
    if (!url) {
      sayToast({ title: "附件地址无效", icon: "none" });
      return;
    }
    if (image) {
      wx.previewImage({ urls: [url], current: url });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const filePath = res.tempFilePath;
        if (!filePath) {
          sayToast({ title: "附件打开失败", icon: "none" });
          return;
        }
        wx.openDocument({
          filePath,
          showMenu: true,
          fail: () => sayToast({ title: "无法预览该附件", icon: "none" })
        });
      },
      fail: () => sayToast({ title: "附件下载失败", icon: "none" })
    });
  },

  downloadAttachment(e) {
    const { url, name } = e.currentTarget.dataset;
    if (!url) {
      sayToast({ title: "附件地址无效", icon: "none" });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const tempFilePath = res.tempFilePath;
        if (!tempFilePath) {
          sayToast({ title: "下载失败", icon: "none" });
          return;
        }
        wx.saveFile({
          tempFilePath,
          success: () => {
            sayToast({
              title: `${name || "附件"}已保存`,
              icon: "success"
            });
          },
          fail: () => {
            sayToast({ title: "保存失败，请检查权限", icon: "none" });
          }
        });
      },
      fail: () => sayToast({ title: "附件下载失败", icon: "none" })
    });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: [
        "🎤 扫码录入识别号",
        "💾 保存草稿",
        "📎 上传文件（统一入口）",
        "📨 提交报销"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          this.scanQr();
          return;
        }
        if (res.tapIndex === 1) {
          this.createOrUpdateDraft();
          return;
        }
        if (res.tapIndex === 2) {
          this.onUploadTap();
          return;
        }
        this.submitEnvelope();
      }
    });
  }
});
