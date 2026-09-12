const { request } = require("../../utils/request");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
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
    passkey: "通行密钥",
    wecom: "企业微信登录"
  };
  return map[value] || "未知";
};


// 显示名：nickname 本值含中文直接用；否则经通讯录把拼音 userid 映射成中文姓名
const toDisplayName = (profile, userNames) => {
  const nickname = String((profile && profile.nickname) || "");
  if (/[一-鿿]/.test(nickname)) return nickname;
  return toUserName((profile && (profile.username || profile.nickname)) || "", userNames, "-");
};

Page({
  data: {
    profile: {},
    profileDisplayName: "-",
    profileRoleText: "-",
    profileAuthMethodText: "-",
    apiBaseUrl: "",
    busy: false
  },

  onShow() {
    const profile = getUserProfile() || {};
    this.setData({
      profile,
      profileDisplayName: toDisplayName(profile, null),
      profileRoleText: roleText(profile.roles),
      profileAuthMethodText: authMethodText(profile.auth_method),
      apiBaseUrl: getBaseUrl()
    });
    // 通讯录到位后补一次映射（首次缓存未热时姓名可能还落在「-」）
    loadUserNameMap().then((userNames) => {
      this.setData({ profileDisplayName: toDisplayName(this.data.profile, userNames) });
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
      const userNames = await loadUserNameMap();
      this.setData({
        profile,
        profileDisplayName: toDisplayName(profile, userNames),
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
