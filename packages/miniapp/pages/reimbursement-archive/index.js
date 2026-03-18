const { request } = require("../../utils/request");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");

const HISTORY_KEY = "reimbursement_archive_scan_history";
const HISTORY_LIMIT = 8;

const statusText = (status) => {
  const map = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已提交",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已拒绝"
  };
  return map[status] || status || "未知";
};

const extractEnvelopeUuid = (raw) => {
  const source = String(raw || "").trim();
  if (!source) return "";

  const decodeSafe = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const direct = decodeSafe(source).trim();
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/;

  const directMatch = direct.match(uuidPattern);
  if (directMatch) return directMatch[0].toLowerCase();

  const queryMatch = direct.match(/[?&]envelope_uuid=([^&#]+)/i);
  if (queryMatch && queryMatch[1]) {
    const value = decodeSafe(queryMatch[1]).trim();
    const valueMatch = value.match(uuidPattern);
    if (valueMatch) return valueMatch[0].toLowerCase();
  }

  return "";
};

Page({
  data: {
    loading: false,
    envelopeUuidInput: "",
    latestResolved: null,
    history: []
  },

  onShow() {
    this.loadHistory();
  },

  loadHistory() {
    const rows = wx.getStorageSync(HISTORY_KEY);
    this.setData({ history: Array.isArray(rows) ? rows : [] });
  },

  saveHistory(item) {
    const rows = Array.isArray(wx.getStorageSync(HISTORY_KEY)) ? wx.getStorageSync(HISTORY_KEY) : [];
    const deduped = rows.filter((row) => row && row.envelope_uuid !== item.envelope_uuid);
    const next = [item].concat(deduped).slice(0, HISTORY_LIMIT);
    wx.setStorageSync(HISTORY_KEY, next);
    this.setData({ history: next });
  },

  onUuidInput(e) {
    this.setData({ envelopeUuidInput: e.detail.value || "" });
  },

  async onScanUuid() {
    if (this.data.loading) return;
    await new Promise((resolve) => {
      wx.scanCode({
        onlyFromCamera: true,
        scanType: ["qrCode"],
        success: async (result) => {
          const raw = (result && (result.result || result.path)) || "";
          await this.resolveAndOpen(raw, { fromScan: true });
          resolve();
        },
        fail: () => {
          sayToast({ title: "扫码取消", icon: "none" });
          resolve();
        }
      });
    });
  },

  async onManualResolve() {
    if (this.data.loading) return;
    await this.resolveAndOpen(this.data.envelopeUuidInput, { fromScan: false });
  },

  async onOpenFromHistory(e) {
    const uuid = e.currentTarget.dataset.uuid;
    if (!uuid || this.data.loading) return;
    await this.resolveAndOpen(uuid, { fromScan: false });
  },

  async resolveAndOpen(raw, { fromScan }) {
    const envelopeUuid = extractEnvelopeUuid(raw);
    if (!envelopeUuid) {
      sayToast({ title: "未识别到有效信封UUID", icon: "none", danger: true });
      return;
    }

    wx.showLoading({ title: "提交中...", mask: true });
    this.setData({ loading: true, envelopeUuidInput: envelopeUuid });
    try {
      const resolveRes = await request({
        method: "GET",
        path: `/api/v1/reimbursement/resolve/by-uuid?envelope_uuid=${encodeURIComponent(envelopeUuid)}`
      });
      const envelopeId = Number((resolveRes && resolveRes.data && resolveRes.data.id) || 0);
      if (!envelopeId) {
        throw new Error("未找到对应报销档案");
      }

      const detailRes = await request({
        method: "GET",
        path: `/api/v1/reimbursement/${envelopeId}`
      });
      const detail = detailRes && detailRes.data ? detailRes.data : {};
      const historyItem = {
        envelope_uuid: envelopeUuid,
        envelope_no: detail.envelope_no || resolveRes.data.envelope_no || "-",
        envelope_id: envelopeId,
        status: detail.status || resolveRes.data.status || "unknown",
        statusText: statusText(detail.status || resolveRes.data.status),
        applicant_userid: detail.applicant_userid || resolveRes.data.applicant_userid || "-",
        amount: Number(detail.amount || 0).toLocaleString("zh-CN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        opened_at: new Date().toISOString().replace("T", " ").slice(0, 16)
      };

      this.setData({ latestResolved: historyItem });
      this.saveHistory(historyItem);
      vibrateSuccess();
      wx.hideLoading();
      sayToast({ title: fromScan ? "已打开电子档案" : "已定位电子档案", icon: "success" });
      wx.navigateTo({ url: `/pages/reimbursement/index?id=${envelopeId}` });
    } catch (error) {
      vibrateWarning();
      wx.hideLoading();
      sayToast({ title: error.message || "打开档案失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  }
});
