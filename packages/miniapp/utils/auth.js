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
  if (data && data.user) return data.user;
  return {
    id: (data && data.id) || "",
    username: (data && data.username) || "",
    nickname: (data && data.nickname) || "",
    roles: (data && data.roles) || []
  };
};

const loginWithWeComCode = (code, options = {}) => {
  const { loginRequest } = require("./request");
  const username = options.username || "operator";
  const codeLoginEndpoints = [
    options.endpoint || "/api/v1/auth/login/web",
    "/api/v1/auth/login/miniapp"
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
    })
    .catch((error) => {
      if (!options.allowLocalFallback) {
        throw error;
      }

      return loginRequest({ code: { username } }).then((localData) => {
        if (localData && localData.accessToken) {
          setToken(localData.accessToken);
        }
        setUserProfile(normalizeUser(localData));
        return localData;
      });
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
