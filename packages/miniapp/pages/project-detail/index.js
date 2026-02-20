const { request } = require("../../utils/request");

Page({
  data: {
    loading: false,
    projectId: 0,
    readonly: true,
    project: null,
    sections: [],
    summary: null
  },

  onLoad(query) {
    const id = Number(query.id || 0);
    const readonly = String(query.readonly || "1") === "1";
    this.setData({ projectId: id, readonly });
    this.loadData();
  },

  async loadData() {
    if (!this.data.projectId) return;
    this.setData({ loading: true });
    try {
      const [project, sections, summary] = await Promise.all([
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}` }),
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}/sections` }),
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}/financial-summary` })
      ]);
      this.setData({
        project: project.data || null,
        sections: Array.isArray(sections.data) ? sections.data : [],
        summary: summary.data || null
      });
    } catch (error) {
      wx.showToast({ title: "加载项目失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  showReadonlyTip() {
    wx.showToast({
      title: "只读模式：非参与者不可执行写操作",
      icon: "none"
    });
  }
});
