const { loginWithWeComCode, getToken, clearToken, setUserProfile } = require("./utils/auth");
const { wxLogin } = require("./utils/wx");
const {
  getBaseUrl,
  isLocalOnlyBaseUrl,
  DEFAULT_REMOTE_BASE_URL
} = require("./utils/config");

App({
  globalData: {
    appName: "HYBC MiniApp",
    apiBaseUrl: DEFAULT_REMOTE_BASE_URL,
    relayPool: {
      enabled: false,
      nodes: [],
    },
    sessionReady: false,
    authError: "",
    sessionPromise: null
  },

  onLaunch: function () {
    this.ensureSession();
  },

  ensureSession: function () {
    const token = getToken();
    if (token) {
      this.globalData.sessionReady = true;
      this.globalData.authError = "";
      return Promise.resolve(token);
    }

    if (this.globalData.sessionPromise) {
      return this.globalData.sessionPromise;
    }

    const sessionPromise = wxLogin()
      .then((loginRes) => {
        if (!loginRes || !loginRes.code) {
          throw new Error("wx.login failed");
        }
        const currentBaseUrl = getBaseUrl();
        return loginWithWeComCode(loginRes.code, {
          allowLocalFallback: isLocalOnlyBaseUrl(currentBaseUrl),
          localUsername: "operator"
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
      })
      .finally(() => {
        this.globalData.sessionPromise = null;
      });

    this.globalData.sessionPromise = sessionPromise;
    return sessionPromise;
  }
});
