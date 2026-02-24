const { request } = require("../../utils/request");
const { clearToken, getUserProfile } = require("../../utils/auth");
const { getBaseUrl, setBaseUrl } = require("../../utils/config");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

Page({
  data: {
    profile: {},
    baseUrl: "",
    busy: false,
    timeline: [
      { icon: "💸", text: "付款申请 #P20260224-01", status: "👨‍💼 王总审批中" },
      { icon: "🧾", text: "报销信封 #R20260223-03", status: "⏳ 排队中" },
      { icon: "📝", text: "合同申请 #C20260222-02", status: "🟢 已通过" }
    ]
  },

  onShow() {
    this.setData({ baseUrl: getBaseUrl() });
    this.reloadProfile();
  },

  onBaseUrlInput(e) {
    this.setData({ baseUrl: e.detail.value });
  },

  saveBaseUrl() {
    setBaseUrl(this.data.baseUrl);
    wx.showToast({ title: "已保存地址", icon: "success" });
  },

  async reloadProfile() {
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      this.setData({ profile: res.data || getUserProfile() || {} });
    } catch {
      this.setData({ profile: getUserProfile() || {} });
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
  },

  goToReimbursement() {
    wx.navigateTo({ url: "/pages/reimbursement/index" });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "🎤 催办我的申请", "🎤 打开报销扫码", "🎤 打开审批待办"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "profile" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          wx.showToast({ title: "已推送催办卡片", icon: "success" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/reimbursement/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/approval/index" });
      }
    });
  }
});
