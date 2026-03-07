const { request, buildUrl } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxScanCode, wxChooseMediaImage, wxChooseMessageFile } = require("../../utils/wx");
const { positiveNumber, firstError } = require("../../utils/validation");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

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
    pending: "处理中",
    completed: "已完成",
    failed: "失败"
  };
  return map[status] || status || "未知";
};

const verificationStatusText = (status) => {
  const map = {
    pending: "待核验",
    verified: "已核验",
    mismatch: "核验异常"
  };
  return map[status] || status || "未知";
};

const precheckStatusText = (status) => {
  const map = {
    none: "未预审",
    pending: "待预审",
    approved: "预审通过",
    supplement: "待补充",
    rejected: "预审驳回"
  };
  return map[status] || status || "未知";
};

const taskStatusText = (status) => {
  const map = {
    none: "未触发",
    pending: "处理中",
    completed: "已完成",
    failed: "失败"
  };
  return map[status] || status || "未知";
};

const riskText = (risk) => {
  const map = {
    high: "高风险",
    medium: "中风险",
    low: "低风险"
  };
  return map[risk] || risk || "未知";
};

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
    verificationStatusText: "待核验",
    precheckStatusText: "未预审",
    pdfStatusText: "未触发",
    batchInfoText: "未入批次",
    attachmentCount: 0,
    attachmentItems: [],
    duplicateChecks: [],
    ocrStatus: "none",
    ocrStatusText: "未开始",
    busy: false
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

  resetDraft() {
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
      verificationStatusText: "待核验",
      precheckStatusText: "未预审",
      pdfStatusText: "未触发",
      batchInfoText: "未入批次",
      attachmentCount: 0,
      attachmentItems: [],
      duplicateChecks: [],
      ocrStatus: "none",
      ocrStatusText: "未开始"
    });
  },

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
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

    const file = await uploadFileToR2(filePath);
    const attachmentType = this.getCurrentAttachmentType();

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

    await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
    vibrateSuccess();
    sayToast({ title: "附件上传成功", icon: "success" });
  },

  async scanQr() {
    try {
      const result = await wxScanCode();
      this.setData({ "draft.preferred_envelope_uuid": result.result || "" });
    } catch {
      sayToast({ title: "扫码取消", icon: "none" });
    }
  },

  async createOrUpdateDraft() {
    const { draft, latestEnvelopeId } = this.data;
    const errorText = firstError([positiveNumber(draft.project_id, "所属项目")]);
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
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
          preferred_envelope_uuid: draft.preferred_envelope_uuid || undefined,
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
      const choose = await wxChooseMediaImage();
      const filePath = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].tempFilePath : "";
      if (!filePath) return;
      const file = await uploadFileToR2(filePath);
      const res = await request({
        method: "POST",
        path: "/api/v1/reimbursement/electronic-upload",
        data: {
          project_id: Number(this.data.draft.project_id || 0),
          file_key: file.key,
          file_name: file.key,
          invoice_no: this.data.draft.invoice_no || undefined,
          amount: Number(this.data.draft.amount || 0) || undefined,
          issue_date: this.data.draft.expense_date || undefined,
          description: this.data.draft.description || undefined
        }
      });
      const envelopeId = Number((res && res.data && res.data.id) || 0);
      this.setData({
        mode: "detail",
        latestEnvelopeId: envelopeId,
        ocrStatus: "pending",
        ocrStatusText: statusText("pending")
      });
      if (envelopeId) {
        await this.loadEnvelopeDetail(envelopeId);
      }
      vibrateSuccess();
      sayToast({ title: "已触发OCR", icon: "success" });
      setTimeout(() => this.refreshOcrStatus(), 1200);
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "上传失败", icon: "none", danger: true });
    });
  },

  async pickPhysicalInvoicePhoto() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      const choose = await wxChooseMediaImage();
      const filePath = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].tempFilePath : "";
      const fileName = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].name : "";
      await this.uploadAttachmentFromPath(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "上传失败", icon: "none", danger: true });
    });
  },

  async pickAttachmentFile() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      const choose = await wxChooseMessageFile({ count: 1, type: "file" });
      const filePath = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].path : "";
      const fileName = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].name : "";
      await this.uploadAttachmentFromPath(filePath, fileName);
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "上传失败", icon: "none", danger: true });
    });
  },

  async submitEnvelope() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先保存草稿", icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/submit`
      });
      await this.loadEnvelopeDetail(this.data.latestEnvelopeId);
      vibrateSuccess();
      sayToast({ title: "报销已提交", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "提交失败", icon: "none", danger: true });
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
            summary: item.summary || item.match_type || "查重结果",
            risk: riskText(item.risk_level)
          }))
        : [];
      const batchInfoText = detail.batch && detail.batch.batch_no
        ? `${detail.batch.batch_no}（${detail.batch.status || "处理中"}）`
        : "未入批次";
      const attachmentItems = attachments.map((item) => {
        const fileKey = item.file_key || "";
        const fileName = item.file_name || fileKey || "未命名附件";
        const fileUrl = fileKey
          ? buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`)
          : "";
        return {
          id: item.id || `${fileKey}-${fileName}`,
          attachment_type: item.attachment_type || "other",
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
    wx.redirectTo({ url: "/pages/reimbursement-list/index" });
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
        "🎙️ 录音识别指令",
        "🎤 扫码录入UUID",
        "💾 保存草稿",
        "📎 上传附件(图片)",
        "📁 上传附件(文件)",
        "🎤 上传电子发票",
        "📨 提交报销"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "reimbursement" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          this.scanQr();
          return;
        }
        if (res.tapIndex === 2) {
          this.createOrUpdateDraft();
          return;
        }
        if (res.tapIndex === 3) {
          this.pickPhysicalInvoicePhoto();
          return;
        }
        if (res.tapIndex === 4) {
          this.pickAttachmentFile();
          return;
        }
        if (res.tapIndex === 5) {
          this.pickInvoicePhoto();
          return;
        }
        this.submitEnvelope();
      }
    });
  }
});
