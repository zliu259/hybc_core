/**
 * 我的车辆记录：本人提交的油卡申请和车辆保养记录，分两个页签，各自分页、按状态筛选。
 * 只看本人：请求都带 mine=true，后端对普通员工本来也只返回本人的。
 */
const { request } = require("../../utils/request");
const {
  FUEL_STATUS_FILTERS,
  MAINTENANCE_STATUS_FILTERS,
  buildFuelCard,
  buildMaintenanceCard,
  buildTypeMap
} = require("../common/vehicle-records-view");

const PAGE_SIZE = 20;

const TAB_CONFIG = {
  fuel: {
    listPath: "/api/v1/fleet/fuel-applications",
    detailPage: "/packageFinance/fuel-record-detail/index",
    createPage: "/packageFinance/fuel-apply/index",
    emptyText: "还没有油卡申请"
  },
  maintenance: {
    listPath: "/api/v1/fleet/maintenance",
    detailPage: "/packageFinance/maintenance-record-detail/index",
    createPage: "/packageFinance/vehicle-maintenance/index",
    emptyText: "还没有保养记录"
  }
};

const isTab = (value) => Object.prototype.hasOwnProperty.call(TAB_CONFIG, value);

const emptyTab = (statusOptions, emptyText) => ({
  statusOptions,
  statusIndex: 0,
  emptyText,
  list: [],
  page: 0,
  total: 0,
  loaded: false,
  loading: false,
  errorText: ""
});

/** 翻页期间有新记录插入时，后一页会带回已显示过的行，按 id 去重 */
const appendUnique = (list, cards) => {
  const seen = new Set(list.map((item) => item.id));
  return list.concat(cards.filter((item) => !seen.has(item.id)));
};

Page({
  data: {
    tab: "fuel",
    tabs: {
      fuel: emptyTab(FUEL_STATUS_FILTERS, TAB_CONFIG.fuel.emptyText),
      maintenance: emptyTab(MAINTENANCE_STATUS_FILTERS, TAB_CONFIG.maintenance.emptyText)
    }
  },

  onLoad(options) {
    const tab = options && isTab(options.tab) ? options.tab : "fuel";
    this.requestSeq = { fuel: 0, maintenance: 0 };
    this.typeMap = null;
    this.setData({ tab });
  },

  // 每次回到这页都刷新第一页：从详情页去补充资料后，状态要跟着变
  onShow() {
    this.fetchPage(this.data.tab, 1);
  },

  onPullDownRefresh() {
    this.fetchPage(this.data.tab, 1).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!isTab(tab) || tab === this.data.tab) return;
    this.setData({ tab });
    if (!this.data.tabs[tab].loaded) this.fetchPage(tab, 1);
  },

  onStatusChange(e) {
    const tab = this.data.tab;
    const statusIndex = Number(e.detail.value || 0);
    this.setData({ [`tabs.${tab}.statusIndex`]: statusIndex });
    this.fetchPage(tab, 1);
  },

  retry() {
    this.fetchPage(this.data.tab, 1);
  },

  loadMore() {
    const tab = this.data.tab;
    const state = this.data.tabs[tab];
    if (state.loading || !state.loaded || state.errorText || state.list.length >= state.total) {
      return Promise.resolve();
    }
    return this.fetchPage(tab, state.page + 1);
  },

  /** 保养类型字典，取到一次就复用；取不到时显示原值，下次再取 */
  async loadTypeMap() {
    if (this.typeMap) return this.typeMap;
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/dict?dict_type=vehicle_maintenance_type"
      });
      this.typeMap = buildTypeMap(res && res.data);
      return this.typeMap;
    } catch {
      return {};
    }
  },

  buildPath(tab, page) {
    const state = this.data.tabs[tab];
    const selected = state.statusOptions[state.statusIndex] || state.statusOptions[0];
    const query = ["mine=true", `page=${page}`, `pageSize=${PAGE_SIZE}`];
    if (selected.value) query.push(`status=${encodeURIComponent(selected.value)}`);
    return `${TAB_CONFIG[tab].listPath}?${query.join("&")}`;
  },

  async fetchPage(tab, page) {
    const seq = this.requestSeq[tab] + 1;
    this.requestSeq = { ...this.requestSeq, [tab]: seq };
    this.setData({ [`tabs.${tab}.loading`]: true, [`tabs.${tab}.errorText`]: "" });
    try {
      const [res, typeMap] = await Promise.all([
        request({ method: "GET", path: this.buildPath(tab, page) }),
        tab === "maintenance" ? this.loadTypeMap() : Promise.resolve({})
      ]);
      // 切筛选或下拉刷新后，晚到的旧结果不能覆盖新结果
      if (seq !== this.requestSeq[tab]) return;
      const rows = res && Array.isArray(res.data) ? res.data : [];
      const cards = rows.map((row) =>
        tab === "fuel" ? buildFuelCard(row) : buildMaintenanceCard(row, typeMap)
      );
      const current = this.data.tabs[tab];
      const list = page === 1 ? cards : appendUnique(current.list, cards);
      const reportedTotal = res && res.pagination ? Number(res.pagination.total) : NaN;
      this.setData({
        [`tabs.${tab}.list`]: list,
        [`tabs.${tab}.page`]: page,
        [`tabs.${tab}.total`]: Number.isFinite(reportedTotal) ? reportedTotal : list.length,
        [`tabs.${tab}.loaded`]: true
      });
    } catch (error) {
      if (seq !== this.requestSeq[tab]) return;
      const message = (error && error.message) || "加载失败";
      // 第一页失败显示整块错误和重试；翻页失败只提示，已加载的保留
      if (page === 1) {
        this.setData({ [`tabs.${tab}.errorText`]: message, [`tabs.${tab}.list`]: [], [`tabs.${tab}.total`]: 0 });
      } else {
        wx.showToast({ title: message, icon: "none" });
      }
    } finally {
      if (seq === this.requestSeq[tab]) this.setData({ [`tabs.${tab}.loading`]: false });
    }
  },

  goDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `${TAB_CONFIG[this.data.tab].detailPage}?id=${id}` });
  },

  goCreate() {
    wx.navigateTo({ url: TAB_CONFIG[this.data.tab].createPage });
  }
});
