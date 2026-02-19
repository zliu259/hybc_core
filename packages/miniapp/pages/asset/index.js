const { request } = require("../../utils/request");
const { wxScanCode } = require("../../utils/wx");

Page({
  data: {
    assetId: "",
    asset: {}
  },

  onAssetIdInput(e) {
    this.setData({ assetId: e.detail.value });
  },

  async scanAsset() {
    try {
      const res = await wxScanCode();
      const raw = (res.result || "").trim();
      const parsed = raw.replace(/\D/g, "");
      this.setData({ assetId: parsed || raw });
    } catch {
      wx.showToast({ title: "扫码取消", icon: "none" });
    }
  },

  async loadAsset() {
    const id = Number(this.data.assetId || 0);
    if (!id) {
      wx.showToast({ title: "请输入资产ID", icon: "none" });
      return;
    }
    try {
      const res = await request({ method: "GET", path: `/api/v1/asset/${id}` });
      this.setData({ asset: res.data || {} });
    } catch (error) {
      wx.showToast({ title: error.message || "查询失败", icon: "none" });
    }
  },

  async markStockEvent(e) {
    const type = e.currentTarget.dataset.type;
    const id = this.data.asset?.id;
    if (!id) return;
    try {
      await request({
        method: "POST",
        path: `/api/v1/asset/${id}/event`,
        data: {
          event_type: type,
          detail: "miniapp scan confirm"
        }
      });
      wx.showToast({ title: "已记录", icon: "success" });
      this.loadAsset();
    } catch (error) {
      wx.showToast({ title: error.message || "记录失败", icon: "none" });
    }
  }
});
