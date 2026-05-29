const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

const canLaunchPayment = (roles) => {
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager") ||
    roles.includes("operator") ||
    roles.includes("finance")
  );
};

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const canAccessManagerDashboard = (roles) => {
  return roles.includes("super_admin") || roles.includes("manager");
};

const canAccessExternalLogReview = (roles) => {
  return roles.includes("super_admin") || roles.includes("manager") || roles.includes("site_manager");
};

const getTotal = (result) => {
  return Number(
    (result && result.pagination && result.pagination.total) ||
      (result && result.total) ||
      (result && result.count) ||
      (Array.isArray(result && result.data) ? result.data.length : 0)
  );
};

const isSystemProject = (item) => {
  const code = String((item && item.project_code) || "");
  const name = String((item && item.project_name) || "");
  return code === "办公室" || code === "仓库" || name === "办公室" || name === "仓库";
};

const getRealProjectTotal = (result) => {
  const total = getTotal(result);
  const data = Array.isArray(result && result.data) ? result.data : [];
  const systemCount = data.filter(isSystemProject).length;
  return Math.max(0, total - systemCount);
};

const CORE_ACTIONS = [
  { title: "🏗️ 看项目", desc: "进入项目列表，深看单个项目", path: "/pages/project-list/index", tone: "blue" },
  { title: "📝 写日志", desc: "管理日志 / 施工日志", path: "/pages/log/index", tone: "green" },
  { title: "✅ 批审批", desc: "处理待办与发起记录", path: "/pages/approval/index", tone: "orange" }
];

const DEFAULT_APPS = [
  { title: "🚜 设备查验", desc: "扫码看设备状态", path: "/pages/asset/index" },
  { title: "👷 安全勘查", desc: "定位拍照查隐患", path: "/pages/survey/index" },
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
  { title: "🔎 查询", desc: "合同/付款/收款统一查询", path: "/pages/query/index" },
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
    activeProjectCount: 0,
    externalReviewCount: 0,
    loading: false,
    coreActions: CORE_ACTIONS,
    appEntries: DEFAULT_APPS,
    riskTone: "green",
    riskText: "现场正常",
    riskDesc: "暂无进度预警，先处理高频事项",
    showCreateProject: false,
    showManagerDashboard: false,
    showExternalLogReview: false
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
      const queryAllowed = canAccessQuery(roles);
      const showManagerDashboard = canAccessManagerDashboard(roles);
      const showExternalLogReview = canAccessExternalLogReview(roles);
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      let externalReviewCount = 0;
      if (showExternalLogReview) {
        try {
          const externalReview = await request({
            method: "GET",
            path: "/api/v1/project/external-log-submissions?status=needs_manual_review&page=1&pageSize=1"
          });
          externalReviewCount = getTotal(externalReview);
        } catch {
          externalReviewCount = 0;
        }
      }
      let alerts = [];
      try {
        const alertResult = await request({
          method: "GET",
          path: "/api/v1/log/progress-alert"
        });
        alerts = Array.isArray(alertResult.data) ? alertResult.data : [];
      } catch {
        alerts = [];
      }
      const list = (pending && pending.data) || [];
      const showCreateProject =
        roles.includes("super_admin") ||
        roles.includes("manager") ||
        roles.includes("site_manager");
      const appEntries = DEFAULT_APPS.filter(
        item =>
          (paymentAllowed || item.path !== "/pages/payment-apply/index") &&
          (queryAllowed || item.path !== "/pages/query/index")
      );
      const finalEntries = showCreateProject
        ? appEntries.concat([
            {
              title: "🏗️ 创建项目",
              desc: "一步一问快速立项",
              path: "/pages/project-create/index"
            }
          ])
        : appEntries;
      const riskTone = alerts.some((item) => item.level === "high")
        ? "red"
        : alerts.length > 0
          ? "yellow"
          : "green";
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length,
        warningCount: alerts.length,
        riskTone,
        riskText: riskTone === "red" ? "优先看预警" : riskTone === "yellow" ? "有项目偏慢" : "现场正常",
        riskDesc:
          riskTone === "red"
            ? "存在明显低于近7日均值的项目"
            : riskTone === "yellow"
              ? "有项目进度低于近7日均值"
              : "暂无进度预警，先处理高频事项",
        showCreateProject,
        showManagerDashboard,
        showExternalLogReview,
        externalReviewCount,
        appEntries: finalEntries
      });

      this.loadProjectMeta();
    } catch {
      this.setData({
        pendingCount: 0,
        noticeCount: 0,
        warningCount: 0,
        projectCount: 0,
        activeProjectCount: 0,
        externalReviewCount: 0
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProjectMeta() {
    try {
      const [result, activeResult] = await Promise.all([
        request({
          method: "GET",
          path: "/api/v1/project?page=1&pageSize=100"
        }),
        request({
          method: "GET",
          path: "/api/v1/project?page=1&pageSize=100&status=active"
        })
      ]);
      const count = getRealProjectTotal(result);
      const activeCount = getRealProjectTotal(activeResult);
      this.setData({ projectCount: count, activeProjectCount: activeCount });
    } catch {
      this.setData({ projectCount: 0, activeProjectCount: 0 });
    }
  },

  openProjectList() {
    wx.navigateTo({ url: "/pages/project-list/index" });
  },

  openManagerDashboard() {
    wx.navigateTo({ url: "/pages/manager-dashboard/index" });
  },

  openExternalLogReview() {
    wx.navigateTo({ url: "/pages/external-log-review/index" });
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: [
        "🎤 我要发起对外付款",
        "🎤 我要上报顶进数据",
        "🎤 我要发起报销"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          wx.switchTab({ url: "/pages/finance/index" });
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/operator-log/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/reimbursement-list/index" });
      }
    });
  }
});
