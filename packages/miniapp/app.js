const { loginWithWeComCode, getToken, clearToken } = require("./utils/auth");
const { wxLogin } = require("./utils/wx");
const { getBaseUrl } = require("./utils/config");

const shouldAllowLocalFallback = () => {
  const baseUrl = getBaseUrl();
  return baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
};

App({
  globalData: {
    appName: "HYBC MiniApp",
    apiBaseUrl: "http://127.0.0.1:8787",
    sessionReady: false
  },

  onLaunch() {
    this.ensureSession();
  },

  async ensureSession() {
    const token = getToken();
    if (token) {
      return token;
    }

    try {
      const loginRes = await wxLogin();
      if (!loginRes.code) {
        throw new Error("wx.login failed");
      }
      const loginData = await loginWithWeComCode(loginRes.code, {
        allowLocalFallback: shouldAllowLocalFallback(),
        username: "operator"
      });
      this.globalData.sessionReady = true;
      return loginData.accessToken;
    } catch (error) {
      clearToken();
      this.globalData.sessionReady = false;
      wx.showToast({
        title: "登录失败",
        icon: "none"
      });
      throw error;
    }
  }
});
