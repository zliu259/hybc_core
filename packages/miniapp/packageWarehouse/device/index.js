const { whGet, whSend, docGet, newRequestId } = require("../common/wh-api");
const { buildDeviceView, buildSingleReturn } = require("../common/wh-device-view");
const {
  toast,
  errorText,
  isNotFound,
  promptModal,
  loadViewer,
  loadNameOf,
  queryId
} = require("../common/wh-ui");

const TIMELINE_PREVIEW = 10;

const emptyReturnForm = () => ({ usageMeters: "", soilType: "" });

Page({
  data: {
    loading: false,
    notFound: false,
    loadFailed: false,
    busy: false,
    view: null,
    timeline: [],
    hiddenEvents: 0,
    showAllEvents: false,
    // 「资料」入口旁边写的份数；取不到是空串
    docCountText: "",
    returnOpen: false,
    returnForm: emptyReturnForm()
  },

  onLoad(query) {
    this.deviceId = queryId(query && query.id);
    if (this.deviceId === null) this.setData({ notFound: true });
  },

  onShow() {
    return this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    if (this.deviceId === null || this.data.loading) return;
    this.setData({ loading: true });
    // 资料份数只是入口旁边的一个数：不等它，慢了、取不到都不拖设备页
    this.loadDocCount();
    try {
      const [result, viewer, nameOf] = await Promise.all([
        whGet(`/device/${this.deviceId}`),
        loadViewer(),
        loadNameOf()
      ]);
      this.detail = result.data;
      const view = buildDeviceView(result.data, viewer.caps, nameOf);
      this.setData({ view, notFound: false, loadFailed: false });
      this.showTimeline(view, this.data.showAllEvents);
      wx.setNavigationBarTitle({ title: view.header.code });
    } catch (error) {
      if (isNotFound(error)) this.setData({ notFound: true, view: null });
      else if (!this.data.view) this.setData({ loadFailed: true });
      toast(errorText(error, "设备加载失败"));
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 这台设备适用的资料有几份。只是入口旁边的一个数，取不到不提示、不影响设备页。 */
  async loadDocCount() {
    try {
      const result = await docGet(`/for-device/${this.deviceId}`);
      const count = Array.isArray(result.data) ? result.data.length : 0;
      this.setData({ docCountText: count > 0 ? `${count} 份` : "还没有" });
    } catch (error) {
      console.warn("[wh-device] 资料份数没取到", errorText(error, ""));
      this.setData({ docCountText: "" });
    }
  },

  goDocs() {
    const code = (this.data.view && this.data.view.header.code) || "";
    wx.navigateTo({
      url: `/packageWarehouse/docs/index?deviceId=${this.deviceId}&code=${encodeURIComponent(code)}`
    });
  },

  showTimeline(view, all) {
    const events = view ? view.timeline : [];
    const shown = all ? events : events.slice(0, TIMELINE_PREVIEW);
    this.setData({
      timeline: shown,
      hiddenEvents: events.length - shown.length,
      showAllEvents: all
    });
  },

  toggleEvents() {
    this.showTimeline(this.data.view, !this.data.showAllEvents);
  },

  openReturn() {
    // 请求号在打开面板时定下，提交失败重试用同一个，成功后才清掉
    if (!this.returnRequestId) this.returnRequestId = newRequestId();
    this.setData({ returnOpen: true });
  },

  closeReturn() {
    if (this.data.busy) return;
    this.setData({ returnOpen: false });
  },

  onReturnInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== "usageMeters" && field !== "soilType") return;
    this.setData({ [`returnForm.${field}`]: String((event.detail && event.detail.value) || "") });
  },

  async confirmReturn() {
    if (this.data.busy || !this.detail) return;
    const built = buildSingleReturn(this.detail, this.data.returnForm, this.returnRequestId);
    if (built.error) {
      toast(built.error);
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await whSend("POST", "/doc", built.payload);
      const tasks = (result.data && result.data.created_task_ids) || [];
      this.returnRequestId = "";
      this.setData({ returnOpen: false, returnForm: emptyReturnForm() });
      toast(tasks.length > 0 ? "已返库，已生成检查任务" : "已返库");
    } catch (error) {
      toast(errorText(error, "返库失败，请重试"));
      return;
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  async addNote() {
    if (this.data.busy || this.deviceId === null) return;
    const summary = await promptModal({ title: "设备记事", placeholder: "写下这台设备的情况" });
    if (!summary) return;
    this.setData({ busy: true });
    try {
      await whSend("POST", `/device/${this.deviceId}/note`, { summary });
      toast("已记下");
    } catch (error) {
      toast(errorText(error, "记事失败，请重试"));
      return;
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  goShip() {
    wx.navigateTo({ url: `/packageWarehouse/ship/index?type=out&deviceId=${this.deviceId}` });
  },

  goNewTask() {
    wx.navigateTo({ url: `/packageWarehouse/task-new/index?deviceId=${this.deviceId}` });
  },

  openTask(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    wx.navigateTo({ url: `/packageWarehouse/task-detail/index?id=${id}` });
  },

  noop() {}
});
