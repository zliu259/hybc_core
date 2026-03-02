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

const normalizeUser = (data) => {
  const source = (data && data.user) ? data.user : (data || {});
  return {
    id: source.id || source.userId || "",
    username: source.username || "",
    nickname: source.nickname || "",
    avatar: source.avatar || "",
    roles: source.roles || [],
    permissions: source.permissions || [],
    auth_method: source.auth_method || "",
    wecom_verified_at: source.wecom_verified_at || ""
  };
};

const loginWithWeComCode = (code, options = {}) => {
  const { loginRequest } = require("./request");
  const codeLoginEndpoints = [
    options.endpoint || "/api/v1/auth/login/miniapp",
    "/api/v1/auth/login/web"
  ].filter((item, index, arr) => arr.indexOf(item) === index);

  const loginByCode = (index = 0) => {
    const endpoint = codeLoginEndpoints[index];
    if (!endpoint) {
      return Promise.reject(new Error("No available login endpoint"));
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

  return loginByCode()
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
