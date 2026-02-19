const { loginWithWeComCode, getToken, clearToken } = require("./utils/auth");
const { wxLogin } = require("./utils/wx");

App({
  globalData: {
    appName: "HYBC MiniApp",
    apiBaseUrl: "http://127.0.0.1:8787"
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
      const loginData = await loginWithWeComCode(loginRes.code);
      return loginData.accessToken;
    } catch (error) {
      clearToken();
      wx.showToast({
        title: "登录失败",
        icon: "none"
      });
      throw error;
    }
  }
});
