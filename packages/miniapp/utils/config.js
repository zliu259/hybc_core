const API_BASE_KEY = "hybc_api_base_url";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_REMOTE_BASE_URL = "https://apix.hybcdg.com:8787";
const REMOTE_FALLBACK_BASE_URL = "https://apix.hybcdg.com:8849";

const normalizeBaseUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_REMOTE_BASE_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
};

const isLocalOnlyBaseUrl = (value) => {
  const normalized = normalizeBaseUrl(value);
  return (
    normalized.includes("127.0.0.1") ||
    normalized.includes("localhost") ||
    normalized === DEFAULT_LOCAL_BASE_URL
  );
};

const getFallbackBaseUrls = (current, options = {}) => {
  const includeLocal = Boolean(options.includeLocal);
  const normalizedCurrent = normalizeBaseUrl(current);
  const remoteCandidates = [
    normalizedCurrent,
    REMOTE_FALLBACK_BASE_URL,
    DEFAULT_REMOTE_BASE_URL
  ].filter(Boolean);

  const candidates = includeLocal
    ? [...remoteCandidates, DEFAULT_LOCAL_BASE_URL]
    : remoteCandidates;

  return Array.from(new Set(candidates));
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
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_REMOTE_BASE_URL,
  REMOTE_FALLBACK_BASE_URL,
  isLocalOnlyBaseUrl,
  getFallbackBaseUrls,
  getBaseUrl,
  setBaseUrl
};
