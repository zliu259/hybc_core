const { wxLogin } = require("../../utils/wx");
const { loginWithWeComCode } = require("../../utils/auth");
const {
  getBaseUrl,
  setBaseUrl,
  DEFAULT_REMOTE_BASE_URL,
  isLocalOnlyBaseUrl
} = require("../../utils/config");

const formatLoginError = (error) => {
  const rawMessage = (error && error.message) || "登录失败，请检查企业微信应用配置后重试";
  if (rawMessage.includes("api forbidden") || rawMessage.includes("e=48002")) {
    return `${rawMessage}\n请在企业微信管理后台检查：应用 Secret、应用与小程序关联、应用可见范围、企业可信IP。`;
  }
  if (rawMessage.includes("invalid code") || rawMessage.includes("e=40029")) {
    return `${rawMessage}\n请重新发起企业微信登录获取新 code，避免复用过期 code。`;
  }
  return rawMessage;
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
