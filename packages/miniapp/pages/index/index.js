const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

Page({
  data: {
    title: "项目工作台",
    pendingCount: 0,
    noticeCount: 0,
    loading: false,
    projects: [],
    keyword: ""
  },

  onShow() {
    this.loadWorkbench();
    this.loadProjects();
  },

  async loadWorkbench() {
    this.setData({ loading: true });
    try {
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const list = (pending && pending.data) || [];
      this.setData({
        pendingCount: list.length,
        noticeCount: list.length
      });
    } catch {
      this.setData({ pendingCount: 0, noticeCount: 0 });
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
  }
});
