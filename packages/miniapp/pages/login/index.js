const { wxLogin } = require("../../utils/wx");
const { loginWithWeComCode } = require("../../utils/auth");
const { getBaseUrl, isLocalOnlyBaseUrl } = require("../../utils/config");
const { localizeLoginErrorMessage } = require("../../utils/error-message");

// 登录失败文案统一走 error-message 中文化：企业微信返回的是英文错误码，
// 直接贴进页面对现场同事没有任何可操作性。
const formatLoginError = (error) =>
  localizeLoginErrorMessage((error && error.message) || "") ||
  "登录失败，请检查企业微信应用配置后重试";

Page({
  data: {
    loading: false,
    errorMessage: ""
  },

  onShow() {
    const app = getApp();
    this.setData({
      errorMessage: app.globalData.authError || ""
    });
  },

  async retryLogin() {
    const app = getApp();
    this.setData({ loading: true });
    try {
      const loginRes = await wxLogin();
      if (!loginRes || !loginRes.code) {
        throw new Error("未获取到企业微信登录凭证，请重新发起登录");
      }

      await loginWithWeComCode(loginRes.code, {
        allowLocalFallback: isLocalOnlyBaseUrl(getBaseUrl()),
        localUsername: "operator"
      });

      app.globalData.sessionReady = true;
      app.globalData.authError = "";
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      const message = formatLoginError(error);
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
