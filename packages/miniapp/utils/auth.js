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
  if (data?.user) return data.user;
  return {
    id: data?.id || "",
    username: data?.username || "",
    nickname: data?.nickname || "",
    roles: data?.roles || []
  };
};

const loginWithWeComCode = async (code, options = {}) => {
  const { loginRequest } = require("./request");
  const username = options.username || "operator";

  try {
    const data = await loginRequest({ code: { code } });
    if (data?.accessToken) {
      setToken(data.accessToken);
    }
    setUserProfile(normalizeUser(data));
    return data;
  } catch (error) {
    if (!options.allowLocalFallback) {
      throw error;
    }

    const localData = await loginRequest({ code: { username } });
    if (localData?.accessToken) {
      setToken(localData.accessToken);
    }
    setUserProfile(normalizeUser(localData));
    return localData;
  }
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
