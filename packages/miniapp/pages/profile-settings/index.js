const { request } = require("../../utils/request");
const { clearToken, getUserProfile, setUserProfile } = require("../../utils/auth");
const { DEFAULT_REMOTE_BASE_URL, getBaseUrl, setBaseUrl } = require("../../utils/config");

const roleText = (roles) => {
  const map = {
    super_admin: "超级管理员",
    manager: "经理",
    site_manager: "现场管理员",
    operator: "现场操作员",
    finance: "财务"
  };
  const list = Array.isArray(roles) ? roles : [];
  if (!list.length) return "-";
  return list.map((item) => map[item] || "未知角色").join("、");
};

const authMethodText = (value) => {
  const map = {
    wecom_oauth: "企业微信登录",
    passkey: "Passkey",
    wecom: "企业微信登录"
  };
  return map[value] || "未知";
};

Page({
  data: {
    profile: {},
    profileRoleText: "-",
    profileAuthMethodText: "-",
    apiBaseUrl: "",
    busy: false
  },

  onShow() {
    const profile = getUserProfile() || {};
    this.setData({
      profile,
      profileRoleText: roleText(profile.roles),
      profileAuthMethodText: authMethodText(profile.auth_method),
      apiBaseUrl: getBaseUrl()
    });
  },

  onApiBaseInput(e) {
    this.setData({ apiBaseUrl: e.detail.value || "" });
  },

  saveApiBase() {
    setBaseUrl(this.data.apiBaseUrl);
    this.setData({ apiBaseUrl: getBaseUrl() });
    wx.showToast({ title: "已保存", icon: "success" });
  },

  resetApiBase() {
    setBaseUrl(DEFAULT_REMOTE_BASE_URL);
    this.setData({ apiBaseUrl: getBaseUrl() });
    wx.showToast({ title: "已恢复默认", icon: "success" });
  },

  async reloadProfile() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      const profile = res.data || getUserProfile() || {};
      setUserProfile(profile);
      this.setData({
        profile,
        profileRoleText: roleText(profile.roles),
        profileAuthMethodText: authMethodText(profile.auth_method)
      });
      wx.showToast({ title: "已刷新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "刷新失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  logout() {
    wx.showModal({
      title: "确认退出",
      content: "退出后需要重新登录，是否继续？",
      success: (res) => {
        if (!res.confirm) return;
        clearToken();
        wx.showToast({ title: "已退出", icon: "success" });
      }
    });
  }
});
