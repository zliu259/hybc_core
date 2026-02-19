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

const loginWithWeComCode = (code) => {
  const { loginRequest } = require("./request");
  return loginRequest({ code }).then((data) => {
    if (data?.accessToken) {
      setToken(data.accessToken);
    }
    if (data?.user) {
      setUserProfile(data.user);
    }
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
