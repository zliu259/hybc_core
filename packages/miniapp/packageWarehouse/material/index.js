const { whGet } = require("../common/wh-api");
const { toMaterialRow } = require("../common/wh-project-view");
const { toast, errorText } = require("../common/wh-ui");

const PAGE_SIZE = 30;
const SEARCH_DELAY_MS = 300;

Page({
  data: {
    keyword: "",
    lowOnly: false,
    rows: [],
    total: 0,
    loading: false,
    loadFailed: false,
    finished: false
  },

  onLoad(query) {
    this.pageNo = 1;
    this.setData({ lowOnly: Boolean(query && query.low === "1") });
    return this.reload();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
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

  async reload() {
    // 上一趟还没回来：记下来，等它回来再按现在的条件查一次，免得新的关键字被丢掉
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
      const result = await whGet("/material", {
        keyword: this.data.keyword.trim(),
        low_stock: this.data.lowOnly ? 1 : undefined,
        status: "active",
        page: this.pageNo,
        pageSize: PAGE_SIZE
      });
      const fresh = (Array.isArray(result.data) ? result.data : []).map(toMaterialRow);
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
      toast(errorText(error, "库存加载失败"));
    } finally {
      this.setData({ loading: false });
    }
    // 不管刚才是哪一种加载（包括翻页），有人等着重查就现在查
    if (this.reloadPending) {
      this.reloadPending = false;
      await this.reload();
    }
  },

  // 停一下再查，免得每敲一个字发一次请求
  onSearchInput(event) {
    this.setData({ keyword: String((event.detail && event.detail.value) || "") });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), SEARCH_DELAY_MS);
  },

  async onLowToggle(event) {
    this.setData({ lowOnly: Boolean(event.detail && event.detail.value) });
    await this.reload();
  }
});
