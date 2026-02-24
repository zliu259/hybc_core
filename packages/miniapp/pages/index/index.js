const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

const DEFAULT_ENTRIES = [
  { title: "🚜 设备查验", desc: "扫码看设备状态", path: "/pages/asset/index" },
  { title: "👷 安全勘查", desc: "定位拍照查隐患", path: "/pages/survey/index" },
  { title: "📝 双规日志", desc: "管理日志/施工日志", path: "/pages/log/index" },
  { title: "💰 发起报销", desc: "扫码填报信封", path: "/pages/reimbursement/index" },
  { title: "✅ 待办审批", desc: "快速处理审批", path: "/pages/approval/index" },
  { title: "📈 进度看板", desc: "查看进度预警", path: "/pages/progress/index" },
  { title: "📁 项目资料", desc: "现场资料归档", path: "/pages/notice/index" },
  { title: "🔔 消息通知", desc: "查看催办提醒", path: "/pages/notice/index" }
];

Page({
  data: {
    title: "工作台",
    pendingCount: 0,
    noticeCount: 0,
    warningCount: 0,
    loading: false,
    projects: [],
    keyword: "",
    entries: DEFAULT_ENTRIES,
    showCreateProject: false
  },

  onShow() {
    this.loadWorkbench();
    this.loadProjects();
  },

  async loadWorkbench() {
    this.setData({ loading: true });
    try {
      const profile = getUserProfile() || {};
      const roles = Array.isArray(profile.roles) ? profile.roles : [];
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = (pending && pending.data) || [];
      const showCreateProject =
        roles.includes("super_admin") ||
        roles.includes("manager") ||
        roles.includes("site_manager");
      const entries = showCreateProject
        ? DEFAULT_ENTRIES.concat([
            {
              title: "🏗️ 创建项目",
              desc: "一步一问快速立项",
              path: "/pages/project-create/index"
            }
          ])
        : DEFAULT_ENTRIES;
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length,
        warningCount: Math.max(0, Math.floor(list.length / 2)),
        showCreateProject,
        entries
      });
    } catch {
      this.setData({ pendingCount: 0, noticeCount: 0, warningCount: 0 });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProjects() {
    this.setData({ loading: true });
    try {
      const profile = getUserProfile() || {};
      const username = profile.username || "";
      const roles = Array.isArray(profile.roles) ? profile.roles : [];
      const result = await request({
        method: "GET",
        path: `/api/v1/project?page=1&pageSize=200&keyword=${encodeURIComponent(this.data.keyword || "")}`
      });
      const list = Array.isArray(result.data) ? result.data : [];
      const projects = list.map((item) => {
        const isPrivileged = roles.includes("super_admin") || roles.includes("manager") || roles.includes("site_manager");
        const isParticipant = isPrivileged || item.manager_userid === username;
        return {
          id: item.id,
          project_code: item.project_code,
          project_name: item.project_name,
          status: item.status,
          manager_userid: item.manager_userid || "-",
          participant: isParticipant
        };
      });
      this.setData({ projects });
    } catch {
      this.setData({ projects: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
  },

  searchProjects() {
    this.loadProjects();
  },

  openProjectDetail(e) {
    const { id, participant } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/project-detail/index?id=${id}&readonly=${participant ? "0" : "1"}`
    });
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
          wx.switchTab({ url: "/pages/warehouse/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/reimbursement/index" });
      }
    });
  }
});
