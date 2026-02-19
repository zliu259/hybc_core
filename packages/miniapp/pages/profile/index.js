const { request } = require("../../utils/request");
const { clearToken, getUserProfile } = require("../../utils/auth");

Page({
  data: {
    profile: {}
  },

  onShow() {
    this.reloadProfile();
  },

  async reloadProfile() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      this.setData({ profile: res.data || getUserProfile() || {} });
    } catch {
      this.setData({ profile: getUserProfile() || {} });
    }
  },

  logout() {
    clearToken();
    wx.showToast({ title: "已退出", icon: "success" });
  }
});
