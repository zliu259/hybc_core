const { whGet } = require("../common/wh-api");
const { buildProjectView } = require("../common/wh-project-view");
const { toast, errorText, loadViewer, queryId } = require("../common/wh-ui");

const SHIP_TYPES = ["out", "back", "transfer"];
const RECENT_DOCS = 10;
const NOBODY = { userid: "", roles: [], caps: {} };

/** 取一样东西；失败时提示并返回 null，不影响其他几样。 */
const settle = async (promise, fallbackText) => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    toast(errorText(error, fallbackText));
    return { ok: false, value: null };
  }
};

Page({
  data: {
    loading: false,
    notFound: false,
    ledgerFailed: false,
    docsFailed: false,
    view: null
  },

  onLoad(query) {
    this.projectId = queryId(query && query.projectId);
    if (this.projectId === null) this.setData({ notFound: true });
  },

  onShow() {
    return this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  // 项目物资和库房单各取各的：一个取不到，另一个照常显示
  async load() {
    if (this.projectId === null || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [ledger, docs, viewer] = await Promise.all([
        settle(whGet(`/project/${this.projectId}/ledger`), "项目物资加载失败"),
        settle(
          whGet("/doc", { project_id: this.projectId, pageSize: RECENT_DOCS }),
          "库房单加载失败"
        ),
        settle(loadViewer(), "权限加载失败")
      ]);
      const view = buildProjectView(
        ledger.ok ? ledger.value.data : null,
        docs.ok ? docs.value.data : null,
        viewer.ok ? viewer.value : NOBODY
      );
      this.setData({ view, ledgerFailed: !ledger.ok, docsFailed: !docs.ok });
      if (view.projectName) wx.setNavigationBarTitle({ title: view.projectName });
    } finally {
      this.setData({ loading: false });
    }
  },

  goShip(event) {
    const type = event.currentTarget.dataset.type;
    if (!SHIP_TYPES.includes(type)) return;
    wx.navigateTo({
      url: `/packageWarehouse/ship/index?type=${type}&projectId=${this.projectId}`
    });
  },

  goCreateKit() {
    wx.navigateTo({
      url: `/packageWarehouse/kit-list/index?projectId=${this.projectId}&create=1`
    });
  },

  goKitList() {
    wx.navigateTo({ url: `/packageWarehouse/kit-list/index?projectId=${this.projectId}` });
  },

  openDevice(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    wx.navigateTo({ url: `/packageWarehouse/device/index?id=${id}` });
  },

  openKit(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    wx.navigateTo({ url: `/packageWarehouse/kit/index?id=${id}` });
  }
});
