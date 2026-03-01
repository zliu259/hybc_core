const { loginWithWeComCode, getToken, clearToken, setUserProfile } = require("./utils/auth");
const { wxLogin } = require("./utils/wx");
const { getBaseUrl, DEFAULT_REMOTE_BASE_URL } = require("./utils/config");

const shouldAllowLocalFallback = () => {
  const baseUrl = getBaseUrl();
  return baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
};

App({
  globalData: {
    appName: "HYBC MiniApp",
    apiBaseUrl: DEFAULT_REMOTE_BASE_URL,
    sessionReady: false,
    authError: ""
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
        this.globalData.authError = "";
        return loginData.accessToken;
      })
      .catch((error) => {
        clearToken();
        setUserProfile(null);
        this.globalData.sessionReady = false;
        this.globalData.authError =
          (error && error.message) || "企业微信登录失败，请稍后重试";
        wx.showToast({
          title: "登录失败",
          icon: "none"
        });
        wx.reLaunch({ url: "/pages/login/index" });
        throw error;
      });
  }
});
