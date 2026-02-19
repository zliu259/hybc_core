const { request } = require("../../utils/request");
const { wxScanCode } = require("../../utils/wx");

Page({
  data: {
    assetId: "",
    asset: {},
    busy: false
  },

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
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
    return this.runBusy(async () => {
      const res = await request({ method: "GET", path: `/api/v1/asset/${id}` });
      this.setData({ asset: res.data || {} });
    }).catch((error) => wx.showToast({ title: error.message || "查询失败", icon: "none" }));
  },

  async markStockEvent(e) {
    const type = e.currentTarget.dataset.type;
    const id = this.data.asset?.id;
    if (!id) return;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: "确认操作",
        content: "确认记录该设备扫码事件？",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!ok) return;

    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: `/api/v1/asset/${id}/event`,
        data: {
          event_type: type,
          detail: "miniapp scan confirm"
        }
      });
      wx.showToast({ title: "已记录", icon: "success" });
      await this.loadAsset();
    }).catch((error) => wx.showToast({ title: error.message || "记录失败", icon: "none" }));
  }
});
