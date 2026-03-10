const API_BASE_KEY = "hybc_api_base_url";
const RELAY_POOL_KEY = "hybc_relay_pool";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_REMOTE_BASE_URL = "https://api.hybcdg.com";
const REMOTE_FALLBACK_BASE_URL = "https://api.hybcdg.com";
const DEFAULT_RELAY_STATUS_PATH = "/relay/status";

const normalizeBaseUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_REMOTE_BASE_URL;
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (
    normalized.includes("apix.hybcdg.com:8787") ||
    normalized.includes("apix.hybcdg.com:8849")
  ) {
    return DEFAULT_REMOTE_BASE_URL;
  }
  return normalized;
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
  const candidates = buildFallbackCandidates(current, options).map((item) => item.baseUrl);
  return Array.from(new Set(candidates));
};

const normalizeRelayNode = (item, index) => {
  if (!item || typeof item !== "object") return null;
  const baseUrl = normalizeBaseUrl(item.baseUrl || "");
  if (!baseUrl) return null;
  return {
    id: item.id || `relay-${index + 1}`,
    baseUrl,
    priority: Number.isFinite(item.priority) ? Number(item.priority) : 100,
    enabled: item.enabled !== false,
    statusPath: item.statusPath || DEFAULT_RELAY_STATUS_PATH,
    supportsWriteFallback: item.supportsWriteFallback === true,
    probeTimeoutMs: Number.isFinite(item.probeTimeoutMs)
      ? Math.max(200, Number(item.probeTimeoutMs))
      : 1200
  };
};

const getRelayPoolConfig = () => {
  const stored = wx.getStorageSync(RELAY_POOL_KEY);
  if (stored && typeof stored === "object") {
    return stored;
  }
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.relayPool) {
    return app.globalData.relayPool;
  }
  return { enabled: false, nodes: [] };
};

const setRelayPoolConfig = (config) => {
  wx.setStorageSync(RELAY_POOL_KEY, config || { enabled: false, nodes: [] });
};

const buildFallbackCandidates = (current, options = {}) => {
  const includeLocal = Boolean(options.includeLocal);
  const normalizedCurrent = normalizeBaseUrl(current);
  const method = String(options.method || "GET").toUpperCase();
  const relayCfg = getRelayPoolConfig();
  const relayEnabled = relayCfg && relayCfg.enabled === true;
  const relayNodes = relayEnabled && Array.isArray(relayCfg.nodes)
    ? relayCfg.nodes
        .map((item, index) => normalizeRelayNode(item, index))
        .filter((item) => item && item.enabled)
        .filter((item) => !(method !== "GET" && !item.supportsWriteFallback))
        .sort((a, b) => a.priority - b.priority)
    : [];

  const merged = [];
  const seen = new Set();
  const pushCandidate = (entry) => {
    if (!entry || !entry.baseUrl) return;
    if (seen.has(entry.baseUrl)) return;
    seen.add(entry.baseUrl);
    merged.push(entry);
  };

  pushCandidate({ baseUrl: normalizedCurrent, isRelay: false });
  pushCandidate({ baseUrl: REMOTE_FALLBACK_BASE_URL, isRelay: false });
  pushCandidate({ baseUrl: DEFAULT_REMOTE_BASE_URL, isRelay: false });
  relayNodes.forEach((node) => pushCandidate({ ...node, isRelay: true }));
  if (includeLocal) {
    pushCandidate({ baseUrl: DEFAULT_LOCAL_BASE_URL, isRelay: false });
  }

  return merged;
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
  RELAY_POOL_KEY,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_REMOTE_BASE_URL,
  REMOTE_FALLBACK_BASE_URL,
  DEFAULT_RELAY_STATUS_PATH,
  isLocalOnlyBaseUrl,
  getRelayPoolConfig,
  setRelayPoolConfig,
  buildFallbackCandidates,
  getFallbackBaseUrls,
  getBaseUrl,
  setBaseUrl
};
