const { request } = require("../../utils/request");
const { clearToken, getUserProfile } = require("../../utils/auth");
const { getBaseUrl, setBaseUrl } = require("../../utils/config");

Page({
  data: {
    profile: {},
    baseUrl: "",
    busy: false
  },

  onShow() {
    this.setData({ baseUrl: getBaseUrl() });
    this.reloadProfile();
  },

  onBaseUrlInput(e) {
    this.setData({ baseUrl: e.detail.value });
  },

  saveBaseUrl() {
    setBaseUrl(this.data.baseUrl);
    wx.showToast({ title: "已保存地址", icon: "success" });
  },

  async reloadProfile() {
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      this.setData({ profile: res.data || getUserProfile() || {} });
    } catch {
      this.setData({ profile: getUserProfile() || {} });
    } finally {
      this.setData({ busy: false });
    }
  },

  logout() {
    wx.showModal({
      title: "确认退出",
      content: "退出后需要重新登录，是否继续？",
      success: (res) => {
        if (!res.confirm) return;
        clearToken();
        wx.showToast({ title: "已退出", icon: "success" });
      }
    });
  }
});
