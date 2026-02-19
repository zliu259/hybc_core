const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxScanCode, wxChooseMediaImage } = require("../../utils/wx");

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
    latestEnvelopeId: 0,
    ocrStatus: "none",
    pdfEnvelopeId: "",
    pdfStatus: "none"
  },

  onScanInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`scan.${key}`]: e.detail.value });
  },

  onInvoiceInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`invoice.${key}`]: e.detail.value });
  },

  onPdfIdInput(e) {
    this.setData({ pdfEnvelopeId: e.detail.value });
  },

  async scanQr() {
    try {
      const result = await wxScanCode();
      this.setData({ "scan.envelope_uuid": result.result || "" });
    } catch {
      wx.showToast({ title: "扫码取消", icon: "none" });
    }
  },

  async submitScan() {
    try {
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
      wx.showToast({ title: "扫码填报成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    }
  },

  async pickInvoicePhoto() {
    try {
      const choose = await wxChooseMediaImage();
      const filePath = choose.tempFiles?.[0]?.tempFilePath;
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
      this.setData({ latestEnvelopeId: res.data?.id || 0, ocrStatus: "pending" });
      wx.showToast({ title: "已触发OCR", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    }
  },

  async refreshOcrStatus() {
    if (!this.data.latestEnvelopeId) {
      wx.showToast({ title: "请先上传电子发票", icon: "none" });
      return;
    }
    try {
      const res = await request({
        method: "GET",
        path: `/api/v1/reimbursement/${this.data.latestEnvelopeId}/ocr-status`
      });
      this.setData({ ocrStatus: res.data?.status || "unknown" });
    } catch (error) {
      wx.showToast({ title: error.message || "查询失败", icon: "none" });
    }
  },

  async generatePdf() {
    const id = Number(this.data.pdfEnvelopeId || 0);
    if (!id) {
      wx.showToast({ title: "请输入信封ID", icon: "none" });
      return;
    }
    try {
      await request({ method: "POST", path: `/api/v1/reimbursement/${id}/generate-pdf` });
      this.setData({ pdfStatus: "pending" });
      wx.showToast({ title: "已触发PDF", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "触发失败", icon: "none" });
    }
  },

  async refreshPdfStatus() {
    const id = Number(this.data.pdfEnvelopeId || 0);
    if (!id) {
      wx.showToast({ title: "请输入信封ID", icon: "none" });
      return;
    }
    try {
      const res = await request({ method: "GET", path: `/api/v1/reimbursement/${id}/pdf-status` });
      this.setData({ pdfStatus: res.data?.status || "unknown" });
    } catch (error) {
      wx.showToast({ title: error.message || "查询失败", icon: "none" });
    }
  }
});
