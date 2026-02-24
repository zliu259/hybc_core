const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxScanCode, wxChooseMediaImage } = require("../../utils/wx");
const { required, positiveNumber, firstError } = require("../../utils/validation");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");
const { getUserProfile } = require("../../utils/auth");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

const canGeneratePdfByRole = (roles) => {
  return roles.includes("super_admin") || roles.includes("manager") || roles.includes("site_manager");
};

const statusText = (status) => {
  if (status === "pending") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return status || "未知";
};

Page({
  data: {
    scan: {
      envelope_uuid: "",
      project_id: "",
      invoice_no: "",
      amount: ""
    },
    invoice: {
      project_id: "",
      invoice_no: ""
    },
    sharedProjectId: 0,
    latestEnvelopeId: 0,
    ocrStatus: "none",
    ocrStatusText: "未开始",
    pdfEnvelopeId: "",
    pdfStatus: "none",
    pdfStatusText: "未开始",
    canGeneratePdf: false,
    busy: false
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    this.setData({ canGeneratePdf: canGeneratePdfByRole(roles) });
  },

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  onScanInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`scan.${key}`]: e.detail.value });
  },

  onInvoiceInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`invoice.${key}`]: e.detail.value });
  },

  onProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    if (!projectId) return;
    this.setData({
      sharedProjectId: projectId,
      "scan.project_id": String(projectId),
      "invoice.project_id": String(projectId)
    });
  },

  onPdfIdInput(e) {
    this.setData({ pdfEnvelopeId: e.detail.value });
  },

  async scanQr() {
    try {
      const result = await wxScanCode();
      this.setData({ "scan.envelope_uuid": result.result || "" });
    } catch {
      sayToast({ title: "扫码取消", icon: "none" });
    }
  },

  async submitScan() {
    const { scan } = this.data;
    const errorText = firstError([
      required(scan.envelope_uuid, "信封UUID"),
      positiveNumber(scan.project_id, "项目ID"),
      positiveNumber(scan.amount, "金额")
    ]);
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      const { scan } = this.data;
      await request({
        method: "POST",
        path: "/api/v1/reimbursement/scan",
        data: {
          envelope_uuid: scan.envelope_uuid,
          project_id: Number(scan.project_id || 0),
          invoice_no: scan.invoice_no,
          amount: Number(scan.amount || 0)
        }
      });
      vibrateSuccess();
      sayToast({ title: "扫码填报成功", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "提交失败", icon: "none", danger: true });
    });
  },

  async pickInvoicePhoto() {
    const errorText = positiveNumber(this.data.invoice.project_id, "项目ID");
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
          project_id: Number(this.data.invoice.project_id || 0),
          file_key: file.key,
          file_name: file.key,
          invoice_no: this.data.invoice.invoice_no
        }
      });
      this.setData({
        latestEnvelopeId: (res && res.data && res.data.id) || 0,
        ocrStatus: "pending",
        ocrStatusText: statusText("pending")
      });
      vibrateSuccess();
      sayToast({ title: "已触发OCR", icon: "success" });
      setTimeout(() => this.refreshOcrStatus(), 1200);
    }).catch((error) => {
      vibrateWarning();
      sayToast({ title: error.message || "上传失败", icon: "none", danger: true });
    });
  },

  async refreshOcrStatus() {
    if (!this.data.latestEnvelopeId) {
      sayToast({ title: "请先上传电子发票", icon: "none" });
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

  async generatePdf() {
    if (!this.data.canGeneratePdf) {
      sayToast({ title: "当前角色无生成PDF权限", icon: "none" });
      return;
    }
    const id = Number(this.data.pdfEnvelopeId || 0);
    if (!id) {
      sayToast({ title: "请输入信封ID", icon: "none" });
      return;
    }
    return this.runBusy(async () => {
      await request({ method: "POST", path: `/api/v1/reimbursement/${id}/generate-pdf` });
      this.setData({ pdfStatus: "pending", pdfStatusText: statusText("pending") });
      vibrateSuccess();
      sayToast({ title: "已触发PDF", icon: "success" });
      setTimeout(() => this.refreshPdfStatus(), 1200);
    }).catch((error) => sayToast({ title: error.message || "触发失败", icon: "none", danger: true }));
  },

  async refreshPdfStatus() {
    const id = Number(this.data.pdfEnvelopeId || 0);
    if (!id) {
      sayToast({ title: "请输入信封ID", icon: "none" });
      return;
    }
    return this.runBusy(async () => {
      const res = await request({ method: "GET", path: `/api/v1/reimbursement/${id}/pdf-status` });
      const status = (res && res.data && res.data.status) || "unknown";
      this.setData({ pdfStatus: status, pdfStatusText: statusText(status) });
    }).catch((error) => sayToast({ title: error.message || "查询失败", icon: "none" }));
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "🎤 扫码填报报销", "🎤 上传电子发票", "🎤 触发PDF"],
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
          this.pickInvoicePhoto();
          return;
        }
        if (!this.data.canGeneratePdf) {
          sayToast({ title: "当前角色无生成PDF权限", icon: "none" });
          return;
        }
        this.generatePdf();
      }
    });
  }
});
