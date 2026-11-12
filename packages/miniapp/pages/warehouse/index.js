const { request } = require("../../utils/request");
const { scanDevice } = require("../../utils/wh-scan");
const { buildHomeView } = require("../../utils/wh-home-view");

const SEARCH_DELAY_MS = 300;
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

const beijingToday = () => new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);

const toast = (title) => wx.showToast({ title, icon: "none" });

const errorText = (error, fallback) => (error && error.message) || fallback;

Page({
  data: {
    loading: false,
    loadFailed: false,
    scanning: false,
    view: buildHomeView(null, beijingToday()),
    keyword: "",
    searching: false,
    searched: false,
    searchResults: []
  },

  onShow() {
    return this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await request({ method: "GET", path: "/api/v1/warehouse/home" });
      this.setData({ view: buildHomeView(result.data, beijingToday()), loadFailed: false });
    } catch (error) {
      // 原有内容留着，只标出这次没取到
      this.setData({ loadFailed: true });
      toast(errorText(error, "加载失败，请下拉重试"));
    } finally {
      this.setData({ loading: false });
    }
  },

  async onScan() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    try {
      const device = await scanDevice();
      if (device) this.openDevice(device.id);
    } catch (error) {
      toast(errorText(error, "扫码失败，请重试"));
    } finally {
      this.setData({ scanning: false });
    }
  },

  onSearchInput(event) {
    const keyword = String((event.detail && event.detail.value) || "");
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!keyword.trim()) {
      this.setData({ searchResults: [], searched: false });
      return;
    }
    this._searchTimer = setTimeout(() => this.search(keyword.trim()), SEARCH_DELAY_MS);
  },

  async search(keyword) {
    this.setData({ searching: true });
    try {
      const result = await request({
        method: "GET",
        path: `/api/v1/warehouse/device?keyword=${encodeURIComponent(keyword)}&pageSize=10`
      });
      // 等结果的时候又改了输入，这次的结果就不要了
      if (this.data.keyword.trim() !== keyword) return;
      const rows = Array.isArray(result.data) ? result.data : [];
      this.setData({
        searched: true,
        searchResults: rows.map((device) => ({
          id: device.id,
          code: device.device_code,
          name: device.name,
          stateLabel: device.state_label
        }))
      });
    } catch (error) {
      toast(errorText(error, "搜索失败，请重试"));
    } finally {
      this.setData({ searching: false });
    }
  },

  onPickDevice(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    this.setData({ keyword: "", searchResults: [], searched: false });
    this.openDevice(id);
  },

  openDevice(id) {
    wx.navigateTo({ url: `/packageWarehouse/device/index?id=${id}` });
  },

  openTask(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.navigateTo({ url: `/packageWarehouse/task-detail/index?id=${id}` });
  },

  openProject(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    wx.navigateTo({ url: `/packageWarehouse/project/index?projectId=${id}` });
  },

  goTo(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
