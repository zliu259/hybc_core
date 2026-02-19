const { request } = require("../../utils/request");

Page({
  data: {
    title: "HYBC 企业微信小程序",
    pendingCount: 0,
    noticeCount: 0
  },

  onShow() {
    this.loadWorkbench();
  },

  async loadWorkbench() {
    try {
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = pending?.data || [];
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length
      });
    } catch {
      this.setData({ pendingCount: 0, noticeCount: 0 });
    }
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  }
});
