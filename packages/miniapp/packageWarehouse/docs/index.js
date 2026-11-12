const { docGet } = require("../common/wh-api");
const { DOC_CATEGORY_TABS, groupForDevice, toDocRow } = require("../common/wh-doc-view");
const { toast, errorText, loadViewer, queryId } = require("../common/wh-ui");

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

/**
 * 设备资料。带 deviceId：这台设备适用的资料，分三段；不带：全库浏览，能搜、能按资料类别筛。
 */
Page({
  data: {
    deviceMode: false,
    tabs: DOC_CATEGORY_TABS,
    activeTab: "",
    keyword: "",
    rows: [],
    groups: [],
    total: 0,
    loading: false,
    loadFailed: false,
    finished: false,
    canUpload: false
  },

  onLoad(query) {
    this.deviceId = queryId(query && query.deviceId);
    this.pageNo = 1;
    const deviceMode = this.deviceId !== null;
    this.setData({ deviceMode });
    if (deviceMode) {
      const code = String((query && query.code) || "").trim();
      wx.setNavigationBarTitle({ title: code ? `${code} 的资料` : "设备资料" });
    }
    return Promise.all([this.loadCaps(), this.reload()]);
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  async onReachBottom() {
    if (this.data.deviceMode || this.data.finished || this.data.loading) return;
    this.pageNo += 1;
    await this.load(false);
  },

  /** 权限只决定有没有上传入口，取不到不影响看资料。 */
  async loadCaps() {
    try {
      const viewer = await loadViewer();
      this.setData({ canUpload: Boolean(viewer.caps && viewer.caps.is_doc_admin) });
    } catch (error) {
      console.warn("[wh-docs] 权限没取到", errorText(error, ""));
    }
  },

  async reload() {
    // 上一趟还没回来：记下来，等它回来再按现在的条件查一次
    if (this.data.loading) {
      this.reloadPending = true;
      return;
    }
    this.pageNo = 1;
    await this.load(true);
  },

  async load(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      if (this.data.deviceMode) await this.loadForDevice();
      else await this.loadLibrary(reset);
      this.setData({ loadFailed: false });
    } catch (error) {
      if (!reset) this.pageNo -= 1;
      this.setData({ loadFailed: true });
      toast(errorText(error, "资料加载失败"));
    } finally {
      this.setData({ loading: false });
    }
    if (this.reloadPending) {
      this.reloadPending = false;
      await this.reload();
    }
  },

  async loadForDevice() {
    const result = await docGet(`/for-device/${this.deviceId}`);
    this.setData({ groups: groupForDevice(result.data), finished: true });
  },

  async loadLibrary(reset) {
    const result = await docGet("/file", {
      keyword: this.data.keyword.trim(),
      doc_category: this.data.activeTab,
      page: this.pageNo,
      pageSize: PAGE_SIZE
    });
    const fresh = (Array.isArray(result.data) ? result.data : []).map(toDocRow);
    const rows = reset ? fresh : [...this.data.rows, ...fresh];
    const total = Number((result.pagination && result.pagination.total) || rows.length);
    this.setData({ rows, total, finished: rows.length >= total || fresh.length === 0 });
  },

  // 停一下再查，免得每敲一个字发一次请求
  onSearchInput(event) {
    this.setData({ keyword: String((event.detail && event.detail.value) || "") });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), SEARCH_DELAY_MS);
  },

  async onTab(event) {
    const key = String(event.currentTarget.dataset.key || "");
    if (key === this.data.activeTab) return;
    this.setData({ activeTab: key });
    await this.reload();
  },

  openDoc(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id !== null) wx.navigateTo({ url: `/packageWarehouse/doc-view/index?id=${id}` });
  }
});
