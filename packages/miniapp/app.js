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

  onLaunch: function () {
    this.ensureSession();
  },

  ensureSession: function () {
    const token = getToken();
    if (token) {
      return Promise.resolve(token);
    }

    return wxLogin()
      .then((loginRes) => {
        if (!loginRes || !loginRes.code) {
          throw new Error("wx.login failed");
        }
        return loginWithWeComCode(loginRes.code, {
          allowLocalFallback: shouldAllowLocalFallback(),
          username: "operator"
        });
      })
      .then((loginData) => {
        this.globalData.sessionReady = true;
        return loginData.accessToken;
      })
      .catch((error) => {
        clearToken();
        this.globalData.sessionReady = false;
        wx.showToast({
          title: "登录失败",
          icon: "none"
        });
        throw error;
      });
  }
});
