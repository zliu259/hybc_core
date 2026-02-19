const API_BASE_KEY = "hybc_api_base_url";

const normalizeBaseUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "http://127.0.0.1:8787";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
};

const getBaseUrl = () => {
  const stored = wx.getStorageSync(API_BASE_KEY);
  if (stored) {
    return normalizeBaseUrl(stored);
  }

  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.apiBaseUrl) {
    return normalizeBaseUrl(app.globalData.apiBaseUrl);
  }
  return normalizeBaseUrl("");
};

const setBaseUrl = (value) => {
  wx.setStorageSync(API_BASE_KEY, normalizeBaseUrl(value));
};

module.exports = {
  API_BASE_KEY,
  getBaseUrl,
  setBaseUrl
};
