const { request } = require("../../utils/request");

Page({
  data: {
    projectId: 0,
    dashboard: {},
    alerts: [],
    loading: false
  },

  onShow() {
    this.loadData();
  },

  onProjectChange(e) {
    this.setData({ projectId: Number(e.detail.projectId || 0) });
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const q = this.data.projectId ? `?project_id=${this.data.projectId}` : "";
      const dashboard = await request({ method: "GET", path: `/api/v1/log/dashboard${q}` });
      const alerts = await request({ method: "GET", path: "/api/v1/log/progress-alert" });
      this.setData({
        dashboard: dashboard.data || {},
        alerts: alerts.data || []
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
