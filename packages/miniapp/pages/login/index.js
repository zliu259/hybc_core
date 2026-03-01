const { wxLogin } = require("../../utils/wx");
const { loginWithWeComCode } = require("../../utils/auth");
const {
  getBaseUrl,
  setBaseUrl,
  DEFAULT_REMOTE_BASE_URL,
  isLocalOnlyBaseUrl
} = require("../../utils/config");

const shouldAllowLocalFallback = (baseUrl) => {
  if (!baseUrl) return false;
  return baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
};

Page({
  data: {
    loading: false,
    errorMessage: "",
    baseUrl: "",
    localBaseWarning: false
  },

  onShow() {
    const app = getApp();
    this.setData({
      baseUrl: getBaseUrl(),
      errorMessage: app.globalData.authError || "",
      localBaseWarning: isLocalOnlyBaseUrl(getBaseUrl())
    });
  },

  switchToRemoteBaseUrl() {
    setBaseUrl(DEFAULT_REMOTE_BASE_URL);
    this.setData({
      baseUrl: DEFAULT_REMOTE_BASE_URL,
      localBaseWarning: false
    });
    wx.showToast({ title: "已切换为可真机访问地址", icon: "success" });
  },

  async retryLogin() {
    const app = getApp();
    this.setData({ loading: true });
    try {
      const loginRes = await wxLogin();
      if (!loginRes || !loginRes.code) {
        throw new Error("未获取到企业微信登录凭证 code");
      }

      await loginWithWeComCode(loginRes.code, {
        allowLocalFallback: shouldAllowLocalFallback(this.data.baseUrl),
        username: "operator"
      });

      app.globalData.sessionReady = true;
      app.globalData.authError = "";
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      const message =
        (error && error.message) || "登录失败，请检查企业微信应用配置后重试";
      app.globalData.authError = message;
      this.setData({ errorMessage: message });
      wx.showToast({ title: "登录失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  copyError() {
    if (!this.data.errorMessage) return;
    wx.setClipboardData({ data: this.data.errorMessage });
  },

  openProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  }
});
