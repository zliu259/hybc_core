const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

const statusText = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档"
};

const STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "规划中", value: "planning" },
  { label: "筹备中", value: "preparing" },
  { label: "施工中", value: "active" },
  { label: "收尾中", value: "completing" },
  { label: "已归档", value: "archived" }
];

const SCOPE_OPTIONS = [
  { label: "全部项目", value: "all" },
  { label: "我参与", value: "participant" },
  { label: "仅只读", value: "readonly" }
];

Page({
  data: {
    loading: false,
    projects: [],
    keyword: "",
    statusIndex: 0,
    scopeIndex: 0,
    statusNames: STATUS_OPTIONS.map((item) => item.label),
    scopeNames: SCOPE_OPTIONS.map((item) => item.label)
  },

  onShow() {
    this.loadProjects();
  },

  toStatusText(status) {
    return statusText[status] || "未知";
  },

  async loadProjects() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const profile = getUserProfile() || {};
      const username = profile.username || "";
      const roles = Array.isArray(profile.roles) ? profile.roles : [];
      const result = await request({
        method: "GET",
        path: `/api/v1/project?page=1&pageSize=200&keyword=${encodeURIComponent(this.data.keyword || "")}&status=${encodeURIComponent(STATUS_OPTIONS[this.data.statusIndex].value || "")}`
      });
      const list = Array.isArray(result.data) ? result.data : [];
      const mapped = list.map((item) => {
        const isPrivileged =
          roles.includes("super_admin") ||
          roles.includes("manager") ||
          roles.includes("site_manager");
        const isParticipant = isPrivileged || item.manager_userid === username;
        return {
          id: item.id,
          project_code: item.project_code,
          project_name: item.project_name,
          statusText: this.toStatusText(item.status),
          manager_userid: item.manager_userid || "-",
          participant: isParticipant
        };
      });

      const scopeValue = SCOPE_OPTIONS[this.data.scopeIndex].value;
      const projects = mapped.filter((item) => {
        if (scopeValue === "participant") return item.participant;
        if (scopeValue === "readonly") return !item.participant;
        return true;
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

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value || 0) });
  },

  onScopeChange(e) {
    this.setData({ scopeIndex: Number(e.detail.value || 0) });
  },

  searchProjects() {
    this.loadProjects();
  },

  resetFilters() {
    this.setData({
      keyword: "",
      statusIndex: 0,
      scopeIndex: 0
    });
    this.loadProjects();
  },

  openProjectDetail(e) {
    const { id, participant } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/project-detail/index?id=${id}&readonly=${participant ? "0" : "1"}`
    });
  }
});
