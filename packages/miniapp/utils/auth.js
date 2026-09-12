const TOKEN_KEY = "hybc_access_token";
const USER_KEY = "hybc_user_profile";

const getToken = () => wx.getStorageSync(TOKEN_KEY) || "";

const setToken = (token) => {
  wx.setStorageSync(TOKEN_KEY, token || "");
};

const clearToken = () => {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
};

const setUserProfile = (profile) => {
  wx.setStorageSync(USER_KEY, profile || {});
};

const getUserProfile = () => wx.getStorageSync(USER_KEY) || null;

const inferRole = (source) => {
  if (Array.isArray(source.roles) && source.roles.length > 0) {
    return source.roles;
  }
  if (typeof source.role === "string" && source.role.trim()) {
    return [source.role.trim()];
  }
  const username = (source.username || "").trim();
  if (username === "super_admin" || username === "admin") {
    return ["super_admin"];
  }
  if (username === "finance") {
    return ["finance"];
  }
  if (username === "manager") {
    return ["manager"];
  }
  if (username === "site_manager") {
    return ["site_manager"];
  }
  return ["operator"];
};

const normalizeUser = (data) => {
  const source = (data && data.user) ? data.user : (data || {});
  return {
    id: source.id || source.userId || "",
    username: source.username || "",
    nickname: source.nickname || "",
    avatar: source.avatar || "",
    roles: inferRole(source),
    permissions: Array.isArray(source.permissions) ? source.permissions : [],
    auth_method: source.auth_method || "",
    wecom_verified_at: source.wecom_verified_at || ""
  };
};

const LOCAL_FALLBACK_USERNAME = "operator";

const buildCodeLoginEndpoints = (options = {}) => {
  // WeCom login code is one-time and short-lived.
  // Do not reuse the same code across multiple login endpoints.
  return [options.endpoint || "/api/v1/auth/login/miniapp"];
};

const loginWithWeComCode = (code, options = {}) => {
  const { loginRequest } = require("./request");
  const codeLoginEndpoints = buildCodeLoginEndpoints(options);

  const loginByCode = (index = 0) => {
    const endpoint = codeLoginEndpoints[index];
    if (!endpoint) {
      return Promise.reject(new Error("登录服务暂不可用，请稍后重试"));
    }

    return loginRequest({
      code,
      endpoint,
      includeLocalFallback: Boolean(options.allowLocalFallback)
    }).catch((error) => {
      if (index + 1 < codeLoginEndpoints.length) {
        return loginByCode(index + 1);
      }
      throw error;
    });
  };

  const loginWithLocalFallback = (fallbackError) => {
    if (!options.allowLocalFallback) {
      return Promise.reject(fallbackError);
    }
    return loginRequest({
      code: {
        username: options.localUsername || LOCAL_FALLBACK_USERNAME
      },
      endpoint: "/api/v1/auth/login/web",
      includeLocalFallback: true
    });
  };

  return loginByCode()
    .catch((error) => loginWithLocalFallback(error))
    .then((data) => {
      if (data && data.accessToken) {
        setToken(data.accessToken);
      }
      setUserProfile(normalizeUser(data));
      return data;
    });
};

module.exports = {
  TOKEN_KEY,
  getToken,
  setToken,
  clearToken,
  setUserProfile,
  getUserProfile,
  loginWithWeComCode
};
