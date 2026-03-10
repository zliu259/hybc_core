const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

const canLaunchPayment = (roles) => {
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager") ||
    roles.includes("operator") ||
    roles.includes("finance")
  );
};

const DEFAULT_ENTRIES = [
  { title: "🏗️ 项目中心", desc: "进入项目列表页", path: "/pages/project-list/index" },
  { title: "🚜 设备查验", desc: "扫码看设备状态", path: "/pages/asset/index" },
  { title: "👷 安全勘查", desc: "定位拍照查隐患", path: "/pages/survey/index" },
  { title: "📝 双规日志", desc: "管理日志/施工日志", path: "/pages/log/index" },
  {
    title: "💸 智能发单台",
    desc: "阈值识别后发起对外付款",
    path: "/pages/payment-apply/index"
  },
  {
    title: "⛽ 油卡额度申请",
    desc: "发起油卡额度申请并跟踪进度",
    path: "/pages/fuel-apply/index"
  },
  { title: "💰 我的报销提交", desc: "发起报销并跟踪进度", path: "/pages/reimbursement-list/index" },
  { title: "✅ 待办审批", desc: "进入审批中心查看详情", path: "/pages/approval/index" },
  { title: "📈 进度看板", desc: "查看进度预警", path: "/pages/progress/index" },
  { title: "🔔 消息通知", desc: "查看催办提醒", path: "/pages/notice/index" }
];

Page({
  data: {
    title: "工作台",
    pendingCount: 0,
    noticeCount: 0,
    warningCount: 0,
    projectCount: 0,
    loading: false,
    entries: DEFAULT_ENTRIES,
    showCreateProject: false
  },

  onShow() {
    this.loadWorkbench();
  },

  async loadWorkbench() {
    this.setData({ loading: true });
    try {
      const profile = getUserProfile() || {};
      const roles = Array.isArray(profile.roles) ? profile.roles : [];
      const paymentAllowed = canLaunchPayment(roles);
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = (pending && pending.data) || [];
      const showCreateProject =
        roles.includes("super_admin") ||
        roles.includes("manager") ||
        roles.includes("site_manager");
      const baseEntries = DEFAULT_ENTRIES.filter(
        item => paymentAllowed || item.path !== "/pages/payment-apply/index"
      );
      const entries = showCreateProject
        ? baseEntries.concat([
            {
              title: "🏗️ 创建项目",
              desc: "一步一问快速立项",
              path: "/pages/project-create/index"
            }
          ])
        : baseEntries;
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length,
        warningCount: Math.max(0, Math.floor(list.length / 2)),
        showCreateProject,
        entries
      });

      this.loadProjectMeta();
    } catch {
      this.setData({ pendingCount: 0, noticeCount: 0, warningCount: 0, projectCount: 0 });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProjectMeta() {
    try {
      const result = await request({
        method: "GET",
        path: "/api/v1/project?page=1&pageSize=1"
      });
      const count = Number(result.total || result.count || (Array.isArray(result.data) ? result.data.length : 0));
      this.setData({ projectCount: count });
    } catch {
      this.setData({ projectCount: 0 });
    }
  },

  openProjectList() {
    wx.navigateTo({ url: "/pages/project-list/index" });
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: [
        "🎙️ 录音识别指令",
        "🎤 我要发起对外付款",
        "🎤 我要上报顶进数据",
        "🎤 我要发起报销"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "index" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          wx.switchTab({ url: "/pages/finance/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/operator-log/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/reimbursement-list/index" });
      }
    });
  }
});
