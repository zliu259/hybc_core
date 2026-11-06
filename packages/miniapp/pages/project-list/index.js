const { request } = require("../../utils/request");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const { getUserProfile } = require("../../utils/auth");
const { buildProjectCard, isSystemProject } = require("../../utils/project-view");

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const STATUS_CHIPS = [
  { label: "全部", value: "" },
  { label: "施工中", value: "active" },
  { label: "筹备中", value: "preparing" },
  { label: "规划中", value: "planning" },
  { label: "收尾中", value: "completing" },
  { label: "已归档", value: "archived" }
];

Page({
  data: {
    loading: false,
    loadingMore: false,
    loadError: "",
    projects: [],
    total: 0,
    hasMore: false,
    keyword: "",
    status: "",
    mineOnly: false,
    statusChips: STATUS_CHIPS
  },

  onLoad() {
    this._page = 0;
    this._requestId = 0;
    this.loadFirstPage();
  },

  onUnload() {
    clearTimeout(this._searchTimer);
  },

  async onPullDownRefresh() {
    await this.loadFirstPage();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    this.loadMore();
  },

  buildPath(page) {
    const { keyword, status, mineOnly } = this.data;
    const profile = getUserProfile() || {};
    const query = [
      `page=${page}`,
      `pageSize=${PAGE_SIZE}`,
      keyword.trim() ? `keyword=${encodeURIComponent(keyword.trim())}` : "",
      status ? `status=${encodeURIComponent(status)}` : "",
      mineOnly && profile.username
        ? `manager_userid=${encodeURIComponent(profile.username)}`
        : ""
    ].filter(Boolean);
    return `/api/v1/project?${query.join("&")}`;
  },

  async fetchPage(page) {
    const [userNames, result] = await Promise.all([
      loadUserNameMap(),
      request({ method: "GET", path: this.buildPath(page) })
    ]);
    const rows = Array.isArray(result.data) ? result.data : [];
    const profile = getUserProfile() || {};
    const toName = (userid) => toUserName(userid, userNames);
    const visible = rows.filter((item) => !isSystemProject(item));
    const total = Number((result.pagination && result.pagination.total) || 0);
    return {
      cards: visible.map((item) => buildProjectCard(item, { toName, profile })),
      // 占位项目排在最前面，接口的总数里也算了它们
      total: total - (rows.length - visible.length),
      hasMore: page * PAGE_SIZE < total
    };
  },

  async loadFirstPage() {
    this._requestId += 1;
    const requestId = this._requestId;
    this.setData({ loading: true, loadError: "" });
    try {
      const { cards, total, hasMore } = await this.fetchPage(1);
      if (requestId !== this._requestId) return;
      this._page = 1;
      this.setData({ projects: cards, total, hasMore, loading: false });
    } catch (error) {
      if (requestId !== this._requestId) return;
      this.setData({
        projects: [],
        total: 0,
        hasMore: false,
        loading: false,
        loadError: error.message || "项目列表加载失败"
      });
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const requestId = this._requestId;
    const nextPage = this._page + 1;
    this.setData({ loadingMore: true });
    try {
      const { cards, hasMore } = await this.fetchPage(nextPage);
      if (requestId !== this._requestId) return;
      this._page = nextPage;
      this.setData({
        projects: [...this.data.projects, ...cards],
        hasMore,
        loadingMore: false
      });
    } catch (error) {
      if (requestId !== this._requestId) return;
      this.setData({ loadingMore: false });
      wx.showToast({ title: error.message || "加载失败，请重试", icon: "none" });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadFirstPage(), SEARCH_DELAY_MS);
  },

  onKeywordConfirm() {
    clearTimeout(this._searchTimer);
    this.loadFirstPage();
  },

  clearKeyword() {
    clearTimeout(this._searchTimer);
    this.setData({ keyword: "" });
    this.loadFirstPage();
  },

  selectStatus(e) {
    const { value } = e.currentTarget.dataset;
    if (value === this.data.status) return;
    this.setData({ status: value });
    this.loadFirstPage();
  },

  toggleMine() {
    this.setData({ mineOnly: !this.data.mineOnly });
    this.loadFirstPage();
  },

  clearFilters() {
    clearTimeout(this._searchTimer);
    this.setData({ keyword: "", status: "", mineOnly: false });
    this.loadFirstPage();
  },

  openProjectDetail(e) {
    const { id, readonly } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/project-detail/index?id=${id}&readonly=${readonly ? "1" : "0"}`
    });
  }
});
