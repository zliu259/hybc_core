const { request } = require("../../utils/request");

const statusText = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档"
};

const toDay = (value) => String(value || "").slice(0, 10) || "-";
const stripHtml = (value) => String(value || "").replace(/<[^>]+>/g, "").trim();

const normalizeNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(1)) : 0;
};

const isSystemProject = (item) => {
  const code = String((item && item.project_code) || "");
  const name = String((item && item.project_name) || "");
  return code === "办公室" || code === "仓库" || name === "办公室" || name === "仓库";
};

Page({
  data: {
    loading: false,
    updatedAt: "",
    overview: {
      activeProjects: 0,
      alerts: 0,
      operatorLogs: 0,
      managerLogs: 0,
      footage: 0
    },
    projectCards: [],
    alerts: [],
    recentLogs: []
  },

  onShow() {
    this.loadDashboard();
  },

  toStatusText(status) {
    return statusText[status] || "未知";
  },

  async loadDashboard() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [projectRes, alertRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/project?page=1&pageSize=80&status=active" }),
        request({ method: "GET", path: "/api/v1/log/progress-alert" })
      ]);

      const projects = (Array.isArray(projectRes.data) ? projectRes.data : []).filter(
        (item) => !isSystemProject(item)
      );
      const alerts = (Array.isArray(alertRes.data) ? alertRes.data : []).map((item) => ({
        project_id: Number(item.project_id || 0),
        project_name: item.project_name || "未命名项目",
        levelText: item.level === "high" ? "红灯" : "黄灯",
        levelClass: item.level === "high" ? "danger" : "warning",
        message: item.message || "进度异常",
        today_footage: normalizeNumber(item.today_footage),
        avg_7d: normalizeNumber(item.avg_7d)
      }));

      const dashboardPairs = await Promise.all(
        projects.slice(0, 12).map(async (project) => {
          try {
            const dashboard = await request({
              method: "GET",
              path: `/api/v1/log/dashboard?project_id=${project.id}`
            });
            return { project, dashboard: dashboard.data || {} };
          } catch {
            return { project, dashboard: {} };
          }
        })
      );

      const projectCards = dashboardPairs.map(({ project, dashboard }) => {
        const trend = Array.isArray(dashboard.trend) ? dashboard.trend : [];
        const latest = trend[0] || {};
        return {
          id: Number(project.id),
          project_name: project.project_name || "未命名项目",
          project_code: project.project_code || "-",
          statusText: this.toStatusText(project.status),
          manager_userid: project.manager_userid || "-",
          operator_count: Number(dashboard.operator_count || 0),
          manager_count: Number(dashboard.manager_count || 0),
          completed_total: normalizeNumber(dashboard.completed_total),
          footage_total: normalizeNumber(dashboard.footage_total),
          latest_day: toDay(latest.log_date),
          latest_footage: normalizeNumber(latest.footage_m),
          warning: alerts.some((alert) => Number(alert.project_id) === Number(project.id))
        };
      });

      const recentLogs = await this.loadRecentLogs();
      const overview = projectCards.reduce(
        (acc, item) => ({
          activeProjects: acc.activeProjects,
          alerts: alerts.length,
          operatorLogs: acc.operatorLogs + item.operator_count,
          managerLogs: acc.managerLogs + item.manager_count,
          footage: normalizeNumber(acc.footage + item.footage_total)
        }),
        {
          activeProjects: projects.length,
          alerts: alerts.length,
          operatorLogs: 0,
          managerLogs: 0,
          footage: 0
        }
      );

      this.setData({
        updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        overview,
        projectCards,
        alerts,
        recentLogs
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载驾驶舱失败", icon: "none" });
      this.setData({ projectCards: [], alerts: [], recentLogs: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRecentLogs() {
    const [operatorRes, managerRes] = await Promise.all([
      request({ method: "GET", path: "/api/v1/log/operator?page=1&pageSize=8" }),
      request({ method: "GET", path: "/api/v1/log/manager?page=1&pageSize=8" })
    ]);
    const operatorLogs = (Array.isArray(operatorRes.data) ? operatorRes.data : []).map((item) => ({
      id: `operator-${item.id}`,
      project_id: Number(item.project_id || 0),
      typeText: "施工日志",
      icon: "🚜",
      dayText: toDay(item.log_date),
      title: `${item.shift === "night" ? "夜班" : "白班"} · 进尺 ${normalizeNumber(item.footage_m)}m`,
      desc: item.issue_summary || item.remark || "无异常说明"
    }));
    const managerLogs = (Array.isArray(managerRes.data) ? managerRes.data : []).map((item) => ({
      id: `manager-${item.id}`,
      project_id: Number(item.project_id || 0),
      typeText: "管理日志",
      icon: "📸",
      dayText: toDay(item.log_date),
      title: item.title || "现场概况",
      desc: stripHtml(item.detail_html || item.risk_note || "无补充说明")
    }));

    return operatorLogs
      .concat(managerLogs)
      .sort((a, b) => String(b.dayText).localeCompare(String(a.dayText)))
      .slice(0, 10);
  },

  refresh() {
    this.loadDashboard();
  },

  openProject(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/project-detail/index?id=${id}&readonly=1` });
  },

  openProjectList() {
    wx.navigateTo({ url: "/pages/project-list/index" });
  },

  openProgress() {
    wx.navigateTo({ url: "/pages/progress/index" });
  }
});
