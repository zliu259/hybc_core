const { getBaseUrl } = require("./config");
const { getToken, setToken, clearToken } = require("./auth");

const request = ({ method = "GET", path, data, header = {} }) => {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

    wx.request({
      url: `${getBaseUrl()}${path}`,
      method,
      data,
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

const loginRequest = ({ code }) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}/api/v1/auth/login/web`,
      method: "POST",
      data: { code },
      header: {
        "content-type": "application/json"
      },
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

module.exports = {
  request,
  loginRequest
};
