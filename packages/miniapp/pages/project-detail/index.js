const { request } = require("../../utils/request");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const { getUserProfile } = require("../../utils/auth");
const {
  STATUS_TEXT,
  STATUS_THEME,
  buildFinanceRows,
  buildLogRows,
  buildProjectFacts,
  buildSectionCards,
  buildStageBar,
  canReviewExternalLogs,
  parseBriefing
} = require("../../utils/project-view");

/** 项目日志默认只露最近几条，页面才不会被日志撑得看不到后面的内容 */
const LOG_PREVIEW_COUNT = 5;
/** 接口每页上限；日志按日期倒序，最新的累计进尺一定在第一页 */
const SECTION_LOG_PAGE_SIZE = 100;

const get = (path) => request({ method: "GET", path });

/** 把成败都变成结果：一块内容取不到，不影响其他内容显示。 */
const settle = (promise) =>
  promise.then(
    (result) => ({ ok: true, rows: Array.isArray(result.data) ? result.data : [], data: result.data, pagination: result.pagination }),
    (error) => ({ ok: false, rows: [], data: null, error })
  );

Page({
  data: {
    pageState: "loading",
    loadError: "",
    projectId: 0,
    readonly: true,
    project: null,
    stages: [],
    facts: [],
    briefing: { mode: "empty", text: "", rows: [] },
    canWriteLog: false,
    canReview: false,
    externalReviewCount: 0,
    sectionCards: [],
    sectionsFailed: false,
    logs: [],
    logsFailed: false,
    logsExpanded: false,
    expandedLogId: 0,
    visibleLogs: [],
    hiddenLogCount: 0,
    financeRows: null,
    financeFailed: false
  },

  onLoad(query) {
    this._openedOnce = false;
    this.setData({
      projectId: Number(query.id || 0),
      readonly: String(query.readonly || "1") === "1"
    });
    if (!this.data.projectId) {
      this.setData({ pageState: "error", loadError: "没有找到这个项目" });
      return;
    }
    this.loadData();
  },

  onShow() {
    // 第一次显示时 onLoad 已经在加载；之后从写日志、标段页返回才需要刷新
    if (this._openedOnce && this.data.projectId) this.loadData();
    this._openedOnce = true;
  },

  async onPullDownRefresh() {
    await this.loadData();
    wx.stopPullDownRefresh();
  },

  async loadData() {
    const { projectId } = this.data;
    this._requestId = (this._requestId || 0) + 1;
    const requestId = this._requestId;
    const base = `/api/v1/project/${projectId}`;
    // 重试时先给反馈；已经显示的内容刷新时不闪
    if (this.data.pageState === "error") {
      this.setData({ pageState: "loading", loadError: "" });
    }
    const [userNames, projectRes, sections, summary, managerLogs, breakthroughs] = await Promise.all([
      loadUserNameMap(),
      settle(get(base)),
      settle(get(`${base}/sections`)),
      settle(get(`${base}/financial-summary`)),
      settle(get(`/api/v1/log/manager?project_id=${projectId}&page=1&pageSize=60`)),
      settle(get(`/api/v1/survey/breakthrough?project_id=${projectId}`))
    ]);
    // 按标段分别取：整个项目混着取的话，停工久的标段会被挤出第一页，进度变成 0
    const sectionLogs = await Promise.all(
      sections.rows.map((section) =>
        settle(
          get(
            `/api/v1/log/operator?project_id=${projectId}&section_id=${section.id}&page=1&pageSize=${SECTION_LOG_PAGE_SIZE}`
          )
        )
      )
    );
    if (requestId !== this._requestId) return;

    if (!projectRes.ok || !projectRes.data) {
      // 刷新失败时，已经显示的内容留着，提示一下就好
      if (this.data.pageState === "ready") {
        wx.showToast({ title: "刷新失败，请稍后再试", icon: "none" });
        return;
      }
      this.setData({
        pageState: "error",
        loadError: (projectRes.error && projectRes.error.message) || "项目加载失败"
      });
      return;
    }

    const raw = projectRes.data;
    const toName = (userid) => toUserName(userid, userNames);
    const canReview = canReviewExternalLogs(raw, getUserProfile() || {});
    const externalReviewCount = canReview ? await this.loadExternalReviewCount() : 0;
    if (requestId !== this._requestId) return;

    this.setData({
      pageState: "ready",
      loadError: "",
      project: {
        name: raw.project_name || "未命名项目",
        code: raw.project_code || "",
        status: raw.status,
        statusText: STATUS_TEXT[raw.status] || "未知",
        statusTheme: STATUS_THEME[raw.status] || "default"
      },
      stages: buildStageBar(raw.status),
      facts: buildProjectFacts(raw, toName),
      briefing: parseBriefing(raw.project_briefing),
      // 已归档的项目不再推写日志，真要补可以从「写日志」入口进
      canWriteLog: !this.data.readonly && raw.status !== "archived",
      canReview,
      externalReviewCount,
      sectionCards: buildSectionCards(
        sections.rows,
        sectionLogs.reduce((all, result) => all.concat(result.rows), []),
        breakthroughs.rows,
        sections.rows
          .filter((_, index) => !sectionLogs[index].ok)
          .map((section) => Number(section.id))
      ),
      sectionsFailed: !sections.ok,
      logs: buildLogRows(managerLogs.rows, toName),
      logsFailed: !managerLogs.ok,
      financeRows: buildFinanceRows(summary.ok ? summary.data : null),
      financeFailed: !summary.ok
    });
    this.syncVisibleLogs();
  },

  async loadExternalReviewCount() {
    try {
      const res = await get(
        `/api/v1/project/${this.data.projectId}/external-log-submissions?status=needs_manual_review&page=1&pageSize=1`
      );
      return Number((res.pagination && res.pagination.total) || 0);
    } catch {
      return 0;
    }
  },

  syncVisibleLogs() {
    const { logs, logsExpanded } = this.data;
    this.setData({
      visibleLogs: logsExpanded ? logs : logs.slice(0, LOG_PREVIEW_COUNT),
      hiddenLogCount: Math.max(0, logs.length - LOG_PREVIEW_COUNT)
    });
  },

  toggleAllLogs() {
    this.setData({ logsExpanded: !this.data.logsExpanded });
    this.syncVisibleLogs();
  },

  toggleLog(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    this.setData({ expandedLogId: this.data.expandedLogId === id ? 0 : id });
  },

  previewLogPhoto(e) {
    const { logid, current } = e.currentTarget.dataset;
    const row = this.data.logs.find((item) => item.id === Number(logid));
    if (!row || !current) return;
    wx.previewImage({ current, urls: row.photoUrls });
  },

  openSectionPage(e) {
    const sectionId = Number(e.currentTarget.dataset.id || 0);
    if (!sectionId) return;
    wx.navigateTo({
      url: `/packageProject/project-section/index?projectId=${this.data.projectId}&sectionId=${sectionId}&readonly=${this.data.readonly ? "1" : "0"}`
    });
  },

  goCreateManagerLog() {
    wx.navigateTo({ url: `/pages/manager-log/index?projectId=${this.data.projectId}` });
  },

  openExternalLogReview() {
    wx.navigateTo({ url: `/pages/external-log-review/index?projectId=${this.data.projectId}` });
  }
});
