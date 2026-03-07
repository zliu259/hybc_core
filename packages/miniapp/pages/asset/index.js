const { request } = require("../../utils/request");
const { wxScanCode, wxChooseMediaImage } = require("../../utils/wx");
const { uploadFileToR2 } = require("../../utils/upload");

const buildObjectUrl = (fileKey) => `/api/v1/upload/object/${encodeURIComponent(fileKey)}`;

const parseEventDetail = (raw) => {
  if (!raw) return { text: "", photo_keys: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const text = String(parsed.text || "");
      const photo_keys = Array.isArray(parsed.photo_keys)
        ? parsed.photo_keys.map((item) => String(item || "")).filter(Boolean)
        : [];
      return { text, photo_keys };
    }
  } catch {
  }
  return { text: String(raw), photo_keys: [] };
};

Page({
  data: {
    assetQuery: "",
    asset: {},
    assetCandidates: [],
    assetDocuments: [],
    assetEvents: [],
    statusOptions: ["正常", "使用中", "待维修", "已报废"],
    statusIndex: 0,
    customEventTypeOptions: ["保养", "事件"],
    customEventTypeIndex: 0,
    busy: false
  },

  toStatusText(status) {
    if (status === "idle") return "正常";
    if (status === "using") return "使用中";
    if (status === "repair") return "待维修";
    if (status === "scrapped") return "已报废";
    return "未知";
  },

  statusIndexByValue(status) {
    if (status === "idle") return 0;
    if (status === "using") return 1;
    if (status === "repair") return 2;
    if (status === "scrapped") return 3;
    return 0;
  },

  statusValueByIndex(index) {
    if (index === 0) return "idle";
    if (index === 1) return "using";
    if (index === 2) return "repair";
    if (index === 3) return "scrapped";
    return "idle";
  },

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  onAssetQueryInput(e) {
    this.setData({ assetQuery: e.detail.value });
  },

  async scanAsset() {
    try {
      const res = await wxScanCode();
      const raw = (res.result || "").trim();
      const parsed = raw.replace(/\D/g, "");
      this.setData({ assetQuery: parsed || raw });
    } catch {
      wx.showToast({ title: "扫码取消", icon: "none" });
    }
  },

  async fetchAssetById(id) {
    const res = await request({ method: "GET", path: `/api/v1/asset/${id}` });
    const detail = res.data || {};
    const documents = Array.isArray(detail.documents)
      ? detail.documents.map((item) => ({
          id: item.id,
          doc_type: item.doc_type || "-",
          file_name: item.file_name || "未命名附件",
          file_key: item.file_key || "",
          created_at: item.created_at || ""
        }))
      : [];
    const events = Array.isArray(detail.events)
      ? detail.events
          .map((item) => {
            const parsed = parseEventDetail(item.detail);
            return {
              ...item,
              id: item.id,
              event_type: item.event_type || "-",
              event_time: item.event_time || "",
              operator_userid: item.operator_userid || "-",
              event_type_text: this.toEventTypeText(item.event_type),
              detail_parsed: parsed,
              detail_text: parsed.text,
              photo_urls: parsed.photo_keys.map((key) => buildObjectUrl(key))
            };
          })
          .sort((a, b) => String(b.event_time || "").localeCompare(String(a.event_time || "")))
      : [];
    this.setData({
      asset: detail,
      assetCandidates: [],
      assetDocuments: documents,
      assetEvents: events,
      statusIndex: this.statusIndexByValue(detail.status)
    });
  },

  toEventTypeText(type) {
    if (type === "maintenance") return "保养";
    if (type === "custom_event") return "事件";
    if (type === "repair") return "维修";
    if (type === "stock_in") return "入库";
    if (type === "stock_out") return "出库";
    if (type === "transfer") return "调拨";
    return type || "其他";
  },

  onCustomEventTypeChange(e) {
    this.setData({ customEventTypeIndex: Number(e.detail.value || 0) });
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value || 0) });
  },

  async searchByKeyword(keyword) {
    const res = await request({
      method: "GET",
      path: `/api/v1/asset?keyword=${encodeURIComponent(keyword)}&page=1&pageSize=20`
    });
    const list = Array.isArray(res.data) ? res.data : [];
    if (!list.length) {
      this.setData({ assetCandidates: [], asset: {}, assetDocuments: [], assetEvents: [] });
      wx.showToast({ title: "未找到匹配设备", icon: "none" });
      return;
    }

    const query = String(keyword).trim().toLowerCase();
    const exact = list.find(
      (item) =>
        String(item.asset_code || "").toLowerCase() === query ||
        String(item.asset_name || "").toLowerCase() === query
    );
    if (exact) {
      await this.fetchAssetById(Number(exact.id));
      return;
    }

    this.setData({
      asset: {},
      assetDocuments: [],
      assetEvents: [],
      assetCandidates: list.map((item) => ({
        ...item,
        statusText: this.toStatusText(item.status)
      }))
    });
  },

  async loadAsset() {
    const query = String(this.data.assetQuery || "").trim();
    if (!query) {
      wx.showToast({ title: "请输入资产ID或关键字", icon: "none" });
      return;
    }

    const id = Number(query || 0);
    return this.runBusy(async () => {
      if (id > 0) {
        await this.fetchAssetById(id);
        return;
      }
      await this.searchByKeyword(query);
    }).catch((error) => wx.showToast({ title: error.message || "查询失败", icon: "none" }));
  },

  onSelectCandidate(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    this.setData({ assetQuery: String(id) });
    this.runBusy(async () => {
      await this.fetchAssetById(id);
    }).catch((error) => wx.showToast({ title: error.message || "查询失败", icon: "none" }));
  },

  async markStockEvent(e) {
    const type = e.currentTarget.dataset.type;
    const id = this.data.asset && this.data.asset.id;
    if (!id) return;
    const eventLabel = this.toEventTypeText(type);
    const modalResult = await new Promise((resolve) => {
      wx.showModal({
        title: `记录${eventLabel}`,
        content: "请填写本次事件说明（必填）",
        editable: true,
        placeholderText: "请输入事件说明",
        success: (res) => resolve(res || {}),
        fail: () => resolve({ confirm: false, content: "" })
      });
    });
    if (!modalResult.confirm) return;
    const detail = String(modalResult.content || "").trim();
    if (!detail) {
      wx.showToast({ title: "说明为必填项", icon: "none" });
      return;
    }

    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: `/api/v1/asset/${id}/event`,
        data: {
          event_type: type,
          detail
        }
      });
      wx.showToast({ title: "已记录", icon: "success" });
      await this.fetchAssetById(Number(id));
    }).catch((error) => wx.showToast({ title: error.message || "记录失败", icon: "none" }));
  },

  async openDocument(e) {
    const fileKey = String(e.currentTarget.dataset.filekey || "").trim();
    if (!fileKey) return;
    const url = buildObjectUrl(fileKey);
    const lower = fileKey.toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].some((ext) => lower.endsWith(ext));
    if (isImage) {
      wx.previewImage({ current: url, urls: [url] });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          wx.openDocument({ filePath: res.tempFilePath, showMenu: true });
          return;
        }
        wx.showToast({ title: "附件打开失败", icon: "none" });
      },
      fail: () => wx.showToast({ title: "附件下载失败", icon: "none" })
    });
  },

  openEventDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    const event = (this.data.assetEvents || []).find((item) => Number(item.id) === id);
    if (!event) return;
    wx.showActionSheet({
      itemList: ["查看详情", "上传图片"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          const text = event.detail_text || "-";
          wx.showModal({
            title: `${event.event_type_text}详情`,
            content: `时间：${event.event_time || '-'}\n操作人：${event.operator_userid || '-'}\n说明：${text}\n图片数：${event.photo_urls.length}`,
            showCancel: false
          });
          return;
        }
        await this.uploadEventPhoto(id);
      },
      fail: () => {}
    });
  },

  async uploadEventPhoto(eventId) {
    if (this.data.busy) return;
    const assetId = Number((this.data.asset || {}).id || 0);
    if (!assetId) return;
    const target = (this.data.assetEvents || []).find((item) => Number(item.id) === eventId);
    if (!target) return;

    return this.runBusy(async () => {
      const choose = await wxChooseMediaImage();
      const filePath =
        choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].tempFilePath : "";
      if (!filePath) return;
      const uploaded = await uploadFileToR2(filePath);
      const parsed = parseEventDetail(target.detail || "");
      const nextKeys = [...parsed.photo_keys, uploaded.key];
      const payload = JSON.stringify({
        text: parsed.text || target.detail_text || "",
        photo_keys: nextKeys
      });

      await request({
        method: "PUT",
        path: `/api/v1/asset/${assetId}/event/${eventId}`,
        data: { detail: payload }
      });
      wx.showToast({ title: "图片已上传", icon: "success" });
      await this.fetchAssetById(assetId);
    }).catch((error) => wx.showToast({ title: error.message || "上传失败", icon: "none" }));
  },

  previewEventPhoto(e) {
    const current = String(e.currentTarget.dataset.current || "");
    const eventId = Number(e.currentTarget.dataset.id || 0);
    const target = (this.data.assetEvents || []).find((item) => Number(item.id) === eventId);
    if (!target || !current) return;
    wx.previewImage({ current, urls: target.photo_urls || [] });
  },

  async markCustomEvent() {
    const type = this.data.customEventTypeIndex === 0 ? "maintenance" : "custom_event";
    return this.markStockEvent({ currentTarget: { dataset: { type } } });
  },

  async updateAssetStatus() {
    const id = Number((this.data.asset || {}).id || 0);
    if (!id) return;
    const targetStatus = this.statusValueByIndex(this.data.statusIndex);
    const currentStatus = (this.data.asset || {}).status;
    const targetLabel = this.toStatusText(targetStatus);
    if (targetStatus === currentStatus) {
      wx.showToast({ title: "状态未变更", icon: "none" });
      return;
    }

    const firstConfirm = await new Promise((resolve) => {
      wx.showModal({
        title: "确认修改状态",
        content: `将设备状态改为“${targetLabel}”？`,
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!firstConfirm) return;

    const secondConfirm = await new Promise((resolve) => {
      wx.showModal({
        title: "请核实",
        content: "状态变更会影响后续出入库与调度判断，请核实后继续。",
        confirmText: "核实无误",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!secondConfirm) return;

    return this.runBusy(async () => {
      await request({
        method: "PUT",
        path: `/api/v1/asset/${id}`,
        data: {
          status: targetStatus
        }
      });
      wx.showToast({ title: "状态已更新", icon: "success" });
      await this.fetchAssetById(id);
    }).catch((error) => wx.showToast({ title: error.message || "状态更新失败", icon: "none" }));
  }
});
