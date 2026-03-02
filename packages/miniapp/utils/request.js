const { getBaseUrl, setBaseUrl, getFallbackBaseUrls } = require("./config");
const { getToken, setToken, clearToken } = require("./auth");

const DEFAULT_TIMEOUT_MS = 20000;
const LOGIN_TIMEOUT_MS = 30000;

const isRetryableNetworkError = (error) => {
  const msg = (error && error.message) || "";
  return msg.includes("请求超时") || msg.includes("无法连接服务器") || msg.includes("timeout");
};

const isConnectionRefusedError = (error) => {
  const msg = (error && error.message) || "";
  return msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("无法连接服务器");
};

const isNetworkLayerFailure = (error) => {
  if (error && error.__networkFail) return true;
  const msg = (error && error.message) || "";
  return msg.includes("request:fail");
};

const buildUrlWithBase = (baseUrl, path) => {
  if (!path) return baseUrl;
  if (/^https?:\/\//.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
};

const buildUrl = (path) => {
  if (!path) return getBaseUrl();
  if (/^https?:\/\//.test(path)) return path;
  return `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
};

const ensureSessionReady = () => {
  const token = getToken();
  if (token) return Promise.resolve(token);

  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || typeof app.ensureSession !== "function") {
    return Promise.resolve("");
  }

  return app.ensureSession().catch((error) => {
    clearToken();
    throw error;
  });
};

const request = ({ method = "GET", path, data, header = {} }) => {
  return ensureSessionReady().then(() => {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

      wx.request({
        url: buildUrl(path),
        method,
        data,
        timeout: DEFAULT_TIMEOUT_MS,
        header: {
          "content-type": "application/json",
          ...authHeader,
          ...header
        },
        success(res) {
          const body = res.data || {};
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            body.success !== false
          ) {
            resolve(body);
            return;
          }

          if (res.statusCode === 401) {
            clearToken();
          }

          reject(
            new Error(
              (body && body.error && body.error.message) || "Request failed"
            )
          );
        },
        fail(err) {
          reject(err);
        }
      });
    });
  });
};

const loginRequest = ({
  code: payload,
  endpoint = "/api/v1/auth/login/web",
  includeLocalFallback = false
}) => {
  const baseCandidates = getFallbackBaseUrls(getBaseUrl(), {
    includeLocal: includeLocalFallback
  });

  const doRequest = (attempt, baseIndex = 0) =>
    new Promise((resolve, reject) => {
      const targetBase = baseCandidates[baseIndex] || getBaseUrl();
      const url = buildUrlWithBase(targetBase, endpoint);
      wx.request({
        url,
        method: "POST",
        data: typeof payload === "string" ? { code: payload } : payload,
        header: {
          "content-type": "application/json"
        },
        timeout: LOGIN_TIMEOUT_MS,
        success(res) {
          const body = res.data || {};
          if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
            if (body.data && body.data.accessToken) {
              setToken(body.data.accessToken);
            }
            setBaseUrl(targetBase);
            resolve(body.data || {});
            return;
          }
          reject(new Error((body && body.error && body.error.message) || `Login failed (${url})`));
        },
        fail(err) {
          const errorMessage =
            (err && err.errMsg) || (err && err.message) || "Login request failed";
          const networkError = new Error(`${errorMessage} (${url})`);
          networkError.__networkFail = true;
          networkError.__rawErrMsg = (err && err.errMsg) || "";
          reject(networkError);
        }
      });
    }).catch((error) => {
      if (
        baseIndex + 1 < baseCandidates.length &&
        (isConnectionRefusedError(error) || isNetworkLayerFailure(error))
      ) {
        return doRequest(attempt, baseIndex + 1);
      }
      if (attempt < 2 && isRetryableNetworkError(error)) {
        return doRequest(attempt + 1, baseIndex);
      }
      throw error;
    });

  return doRequest(1);
};

const uploadBinary = ({ path, arrayBuffer, contentType }) => {
  return ensureSessionReady().then(() => {
    return new Promise((resolve, reject) => {
      const token = getToken();
      wx.request({
        url: buildUrl(path),
        method: "PUT",
        data: arrayBuffer,
        timeout: 30000,
        header: {
          "content-type": contentType || "application/octet-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        success(res) {
          const body = res.data || {};
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            body.success !== false
          ) {
            resolve(body);
            return;
          }

          if (res.statusCode === 401) {
            clearToken();
          }

          reject(
            new Error((body && body.error && body.error.message) || "Upload failed")
          );
        },
        fail(err) {
          reject(err);
        }
      });
    });
  });
};

module.exports = {
  request,
  loginRequest,
  uploadBinary,
  buildUrl
};
