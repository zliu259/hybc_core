const { request } = require("../../utils/request");

Page({
  data: {
    title: "HYBC 企业微信小程序",
    pendingCount: 0,
    noticeCount: 0,
    loading: false
  },

  onShow() {
    this.loadWorkbench();
  },

  async loadWorkbench() {
    this.setData({ loading: true });
    try {
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = (pending && pending.data) || [];
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length
      });
    } catch {
      this.setData({ pendingCount: 0, noticeCount: 0 });
    } finally {
      this.setData({ loading: false });
    }
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  }
});
