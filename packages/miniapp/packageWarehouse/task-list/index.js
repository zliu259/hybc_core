const { whGet } = require("../common/wh-api");
const { beijingToday } = require("../common/wh-format");
const { TASK_TABS, tabsFor, toTaskRow } = require("../common/wh-task-view");
const { toast, errorText, loadViewer, loadNameOf, queryId } = require("../common/wh-ui");

const PAGE_SIZE = 20;

Page({
  data: {
    tabs: [],
    activeTab: "mine",
    rows: [],
    total: 0,
    loading: false,
    loadFailed: false,
    finished: false,
    canCreate: false
  },

  onLoad(query) {
    this.initialTab = (query && query.tab) || "mine";
    this.pageNo = 1;
  },

  // 从详情回来也走这里：任务可能已经变了，回到第一页重新取
  async onShow() {
    await this.ensureViewer();
    await this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  async onReachBottom() {
    if (this.data.finished || this.data.loading) return;
    this.pageNo += 1;
    await this.load(false);
  },

  /** 权限只取一次；取不到时按普通员工显示，下次进页面再取。 */
  async ensureViewer() {
    if (this.viewer) return;
    let caps = {};
    try {
      this.viewer = await loadViewer();
      caps = this.viewer.caps;
    } catch (error) {
      toast(errorText(error, "权限加载失败"));
    }
    const tabs = tabsFor(caps);
    const wanted = tabs.some((tab) => tab.key === this.initialTab) ? this.initialTab : "mine";
    this.setData({
      tabs: tabs.map((tab) => ({ key: tab.key, label: tab.label })),
      activeTab: wanted,
      canCreate: Boolean(caps.is_keeper)
    });
  },

  async reload() {
    this.pageNo = 1;
    await this.load(true);
  },

  async load(reset) {
    if (this.data.loading) return;
    const tab = TASK_TABS.find((item) => item.key === this.data.activeTab) || TASK_TABS[0];
    this.setData({ loading: true });
    try {
      const [result, nameOf] = await Promise.all([
        whGet("/task", { ...tab.query, page: this.pageNo, pageSize: PAGE_SIZE }),
        loadNameOf()
      ]);
      const today = beijingToday();
      const fresh = (Array.isArray(result.data) ? result.data : []).map((task) =>
        toTaskRow(task, today, nameOf)
      );
      const rows = reset ? fresh : [...this.data.rows, ...fresh];
      const total = Number((result.pagination && result.pagination.total) || rows.length);
      this.setData({
        rows,
        total,
        finished: rows.length >= total || fresh.length === 0,
        loadFailed: false
      });
    } catch (error) {
      if (!reset) this.pageNo -= 1;
      this.setData({ loadFailed: true });
      toast(errorText(error, "任务加载失败"));
    } finally {
      this.setData({ loading: false });
    }
  },

  async onTab(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeTab || this.data.loading) return;
    this.setData({ activeTab: key, rows: [], total: 0, finished: false });
    await this.reload();
  },

  openTask(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    wx.navigateTo({ url: `/packageWarehouse/task-detail/index?id=${id}` });
  },

  goNew() {
    wx.navigateTo({ url: "/packageWarehouse/task-new/index" });
  }
});
