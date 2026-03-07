const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

const canLaunchPayment = (roles) => {
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager") ||
    roles.includes("finance")
  );
};

Page({
  data: {
    segment: "pending",
    pendingCount: 0,
    canPaymentApply: false
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    this.setData({ canPaymentApply: canLaunchPayment(roles) });
    this.loadPendingCount();
  },

  async loadPendingCount() {
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = Array.isArray(res.data) ? res.data : [];
      this.setData({ pendingCount: list.length });
    } catch {
      this.setData({ pendingCount: 0 });
    }
  },

  onSegmentChange(e) {
    this.setData({ segment: e.currentTarget.dataset.value });
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "🎤 我要发起对外付款", "🎤 我要审批单据", "🎤 我要发起报销"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "finance" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          if (!this.data.canPaymentApply) {
            wx.showToast({ title: "当前角色无对外付款权限", icon: "none" });
            return;
          }
          wx.navigateTo({ url: "/pages/payment-apply/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/approval/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/reimbursement-list/index" });
      }
    });
  }
});
