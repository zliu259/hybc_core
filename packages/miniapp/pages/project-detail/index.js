const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

const sectionStatusText = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档",
  normal: "正常",
  paused: "暂停",
  blocked: "受阻",
  done: "完成"
};

const logStatusText = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审核",
  rejected: "已驳回"
};

const toDay = (value) => String(value || "").slice(0, 10) || "-";
const stripHtml = (text) => String(text || "").replace(/<[^>]+>/g, "").trim();

const normalizePhoto = (photo) => {
  const url = photo && (photo.file_url || photo.url || photo.preview_url);
  return url ? { url, name: photo.file_name || "日志图片" } : null;
};

Page({
  data: {
    loading: false,
    initialized: false,
    projectId: 0,
    readonly: true,
    project: null,
    sections: [],
    sectionCards: [],
    summary: null,
    managerLogs: [],
    expandedManagerLogId: 0,
    canReviewExternalLogs: false,
    externalReviewCount: 0
  },

  onLoad(query) {
    const projectId = Number(query.id || 0);
    const readonly = String(query.readonly || "1") === "1";
    this.setData({ projectId, readonly, initialized: true });
    this.loadData();
  },

  onShow() {
    if (this.data.initialized && this.data.projectId) {
      this.loadData();
    }
  },

  toSectionStatus(status) {
    return sectionStatusText[status] || "未知";
  },

  toLogStatus(status) {
    return logStatusText[status] || "未知";
  },

  buildSectionCards(sections, operatorLogs, breakthroughReports) {
    return (sections || []).map((section) => {
      const logs = (operatorLogs || []).filter((item) => Number(item.section_id) === Number(section.id));
      const reports = (breakthroughReports || []).filter((item) => Number(item.section_id) === Number(section.id));
      const footage = logs.reduce((sum, item) => sum + Number(item.footage_m || 0), 0);
      const total = Number(section.section_length || 0);
      const progress = total > 0 ? Math.min(100, (footage / total) * 100) : 0;
      const latestLogDate = logs.length > 0 ? toDay(logs[0].log_date) : "-";
      return {
        id: Number(section.id),
        section_code: section.section_code || "-",
        section_name: section.section_name || "未命名标段",
        statusText: this.toSectionStatus(section.status),
        section_length: total,
        footage: Number(footage.toFixed(1)),
        progress: Number(progress.toFixed(1)),
        logCount: logs.length,
        breakthroughCount: reports.length,
        latestLogDate
      };
    });
  },

  buildManagerLogs(rows) {
    return (rows || [])
      .slice()
      .sort((a, b) => {
        const d = String(b.log_date || "").localeCompare(String(a.log_date || ""));
        if (d !== 0) return d;
        return Number(b.id || 0) - Number(a.id || 0);
      })
      .map((item) => {
        const photos = (Array.isArray(item.photos) ? item.photos : []).map(normalizePhoto).filter(Boolean);
        return {
          id: Number(item.id),
          dayText: toDay(item.log_date),
          statusText: this.toLogStatus(item.status),
          title: item.title || "未命名日志",
          detailText: stripHtml(item.detail_html),
          risk_note: item.risk_note || "",
          manager_userid: item.manager_userid || "-",
          photos,
          photoUrls: photos.map((photo) => photo.url)
        };
      });
  },

  canReviewExternalLogs(project) {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const username = profile.username || "";
    if (roles.includes("super_admin")) return true;
    const hasManagementRole = roles.includes("manager") || roles.includes("site_manager");
    return Boolean(hasManagementRole && project && project.manager_userid === username);
  },

  async loadExternalReviewCount(project, canReviewExternalLogs) {
    if (!project || !canReviewExternalLogs) return 0;
    try {
      const res = await request({
        method: "GET",
        path: `/api/v1/project/${this.data.projectId}/external-log-submissions?status=needs_manual_review&page=1&pageSize=1`
      });
      if (res.pagination && Number.isFinite(Number(res.pagination.total))) {
        return Number(res.pagination.total || 0);
      }
      return Array.isArray(res.data) ? res.data.length : 0;
    } catch {
      return 0;
    }
  },

  async loadData() {
    if (!this.data.projectId) return;
    this.setData({ loading: true });
    try {
      const [projectRes, sectionsRes, summaryRes, managerLogsRes, operatorLogsRes, breakthroughRes] = await Promise.all([
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}` }),
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}/sections` }),
        request({ method: "GET", path: `/api/v1/project/${this.data.projectId}/financial-summary` }),
        request({ method: "GET", path: `/api/v1/log/manager?project_id=${this.data.projectId}&page=1&pageSize=60` }),
        request({ method: "GET", path: `/api/v1/log/operator?project_id=${this.data.projectId}&page=1&pageSize=200` }),
        request({ method: "GET", path: `/api/v1/survey/breakthrough?project_id=${this.data.projectId}` })
      ]);

      const sections = Array.isArray(sectionsRes.data) ? sectionsRes.data : [];
      const operatorLogs = Array.isArray(operatorLogsRes.data) ? operatorLogsRes.data : [];
      const breakthroughs = Array.isArray(breakthroughRes.data) ? breakthroughRes.data : [];

      const project = projectRes.data
        ? {
            ...projectRes.data,
            statusText: this.toSectionStatus(projectRes.data.status)
          }
        : null;
      const canReviewExternalLogs = this.canReviewExternalLogs(project);
      const externalReviewCount = await this.loadExternalReviewCount(project, canReviewExternalLogs);

      this.setData({
        project,
        sections,
        sectionCards: this.buildSectionCards(sections, operatorLogs, breakthroughs),
        summary: summaryRes.data || null,
        managerLogs: this.buildManagerLogs(Array.isArray(managerLogsRes.data) ? managerLogsRes.data : []),
        canReviewExternalLogs,
        externalReviewCount
      });
    } catch (error) {
      wx.showToast({ title: "加载项目失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleManagerLog(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    this.setData({
      expandedManagerLogId: this.data.expandedManagerLogId === id ? 0 : id
    });
  },

  previewLogPhoto(e) {
    const logId = Number(e.currentTarget.dataset.logid || 0);
    const row = (this.data.managerLogs || []).find((item) => Number(item.id) === logId);
    const urls = row ? row.photoUrls : [];
    const current = e.currentTarget.dataset.current || "";
    if (!Array.isArray(urls) || urls.length === 0 || !current) return;
    wx.previewImage({ current, urls });
  },

  openSectionPage(e) {
    const sectionId = Number(e.currentTarget.dataset.id || 0);
    if (!sectionId) return;
    wx.navigateTo({
      url: `/pages/project-section/index?projectId=${this.data.projectId}&sectionId=${sectionId}&readonly=${this.data.readonly ? "1" : "0"}`
    });
  },

  goCreateManagerLog() {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    wx.navigateTo({ url: `/pages/manager-log/index?projectId=${this.data.projectId}` });
  },

  openExternalLogReview() {
    if (!this.data.canReviewExternalLogs) {
      wx.showToast({ title: "当前账号不可复核该项目外部日志", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/external-log-review/index?projectId=${this.data.projectId}` });
  },

  showReadonlyTip() {
    wx.showToast({
      title: "只读模式：非参与者不可执行写操作",
      icon: "none"
    });
  }
});
