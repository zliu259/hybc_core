const { getBaseUrl } = require("./config");
const { getToken, setToken, clearToken } = require("./auth");

const buildUrl = (path) => {
  if (!path) return getBaseUrl();
  if (/^https?:\/\//.test(path)) return path;
  return `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
};

const request = ({ method = "GET", path, data, header = {} }) => {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

    wx.request({
      url: buildUrl(path),
      method,
      data,
      timeout: 15000,
      header: {
        "content-type": "application/json",
        ...authHeader,
        ...header
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          resolve(body);
          return;
        }

        if (res.statusCode === 401) {
          clearToken();
        }

        reject(new Error(body?.error?.message || "Request failed"));
      },
      fail(err) {
        reject(err);
      }
    });
  });
};

const loginRequest = ({ code: payload }) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl("/api/v1/auth/login/web"),
      method: "POST",
      data: payload,
      header: {
        "content-type": "application/json"
      },
      timeout: 15000,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          if (body.data?.accessToken) {
            setToken(body.data.accessToken);
          }
          resolve(body.data || {});
          return;
        }
        reject(new Error(body?.error?.message || "Login failed"));
      },
      fail(err) {
        reject(err);
      }
    });
  });
};

const uploadBinary = ({ path, arrayBuffer, contentType }) => {
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
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          resolve(body);
          return;
        }

        if (res.statusCode === 401) {
          clearToken();
        }

        reject(new Error(body?.error?.message || "Upload failed"));
      },
      fail(err) {
        reject(err);
      }
    });
  });
};

module.exports = {
  request,
  loginRequest,
  uploadBinary,
  buildUrl
};
