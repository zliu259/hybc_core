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

  return loginRequest({ code: { code } })
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
