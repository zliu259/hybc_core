const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const {
  BIZ_TYPE_OPTIONS,
  STATUS_CHIPS,
  buildApprovalRow,
  canQueryApprovals,
  toInitiatorOptions
} = require("../../utils/approval-query-view");

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const INITIATOR_LABELS_FALLBACK = [{ userid: "", label: "全部发起人" }];

Page({
  data: {
    allowed: false,
    loading: false,
    loadingMore: false,
    loadError: "",
    rows: [],
    total: 0,
    hasMore: false,
    keyword: "",
    status: "",
    statusChips: STATUS_CHIPS,
    typeNames: BIZ_TYPE_OPTIONS.map((item) => item.label),
    typeIndex: 0,
    initiatorLabels: INITIATOR_LABELS_FALLBACK.map((item) => item.label),
    initiatorIndex: 0
  },

  onLoad() {
    this._page = 0;
    this._requestId = 0;
    this._initiators = INITIATOR_LABELS_FALLBACK;
    if (!canQueryApprovals(getUserProfile())) {
      wx.showToast({ title: "流程查询仅限超级管理员使用", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
      return;
    }
    this.setData({ allowed: true });
    this.loadInitiators();
    this.loadFirstPage();
  },

  onUnload() {
    clearTimeout(this._searchTimer);
  },

  async onPullDownRefresh() {
    if (this.data.allowed) await this.loadFirstPage();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.allowed) this.loadMore();
  },

  async loadInitiators() {
    try {
      const result = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = result.data && Array.isArray(result.data.users) ? result.data.users : [];
      this._initiators = toInitiatorOptions(users);
      this.setData({ initiatorLabels: this._initiators.map((item) => item.label) });
    } catch {
      // 只影响发起人筛选，下拉里还有「全部发起人」，其他筛选照常用
    }
  },

  buildPath(page) {
    const { keyword, status, typeIndex, initiatorIndex } = this.data;
    const bizType = BIZ_TYPE_OPTIONS[typeIndex].value;
    const initiator = this._initiators[initiatorIndex].userid;
    const query = [
      `page=${page}`,
      `pageSize=${PAGE_SIZE}`,
      keyword.trim() ? `keyword=${encodeURIComponent(keyword.trim())}` : "",
      status ? `status=${encodeURIComponent(status)}` : "",
      bizType ? `biz_type=${encodeURIComponent(bizType)}` : "",
      initiator ? `initiator=${encodeURIComponent(initiator)}` : ""
    ].filter(Boolean);
    return `/api/v1/approval/admin/all?${query.join("&")}`;
  },

  async fetchPage(page) {
    const [userNames, result] = await Promise.all([
      loadUserNameMap(),
      request({ method: "GET", path: this.buildPath(page) })
    ]);
    const toName = (userid) => toUserName(userid, userNames);
    const list = Array.isArray(result.data) ? result.data : [];
    const total = Number((result.pagination && result.pagination.total) || 0);
    return {
      rows: list.map((row) => buildApprovalRow(row, toName)),
      total,
      hasMore: page * PAGE_SIZE < total
    };
  },

  async loadFirstPage() {
    this._requestId += 1;
    const requestId = this._requestId;
    this.setData({ loading: true, loadError: "" });
    try {
      const { rows, total, hasMore } = await this.fetchPage(1);
      if (requestId !== this._requestId) return;
      this._page = 1;
      this.setData({ rows, total, hasMore, loading: false });
    } catch (error) {
      if (requestId !== this._requestId) return;
      this.setData({
        rows: [],
        total: 0,
        hasMore: false,
        loading: false,
        loadError: error.message || "流程列表加载失败"
      });
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const requestId = this._requestId;
    const nextPage = this._page + 1;
    this.setData({ loadingMore: true });
    try {
      const { rows, hasMore } = await this.fetchPage(nextPage);
      if (requestId !== this._requestId) return;
      this._page = nextPage;
      this.setData({
        rows: [...this.data.rows, ...rows],
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

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value || 0) });
    this.loadFirstPage();
  },

  onInitiatorChange(e) {
    this.setData({ initiatorIndex: Number(e.detail.value || 0) });
    this.loadFirstPage();
  },

  clearFilters() {
    clearTimeout(this._searchTimer);
    this.setData({ keyword: "", status: "", typeIndex: 0, initiatorIndex: 0 });
    this.loadFirstPage();
  },

  openDetail(e) {
    wx.navigateTo({ url: `/pages/approval-detail/index?id=${e.currentTarget.dataset.id}` });
  }
});
