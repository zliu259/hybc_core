const { whGet, whSend } = require("../common/wh-api");
const { KIT_STATUS_TABS, newKitProblem, toKitListRow } = require("../common/wh-kit-view");
const { toast, errorText, loadViewer, queryId } = require("../common/wh-ui");

const PAGE_SIZE = 20;
const DEFAULT_TITLE = "主清单";

const emptyCreateForm = (projectId) => ({
  projectId: projectId || null,
  projectName: "",
  templateIndex: 0,
  title: DEFAULT_TITLE
});

Page({
  data: {
    statusTabs: KIT_STATUS_TABS,
    activeStatus: "",
    rows: [],
    total: 0,
    loading: false,
    loadFailed: false,
    finished: false,
    busy: false,
    canCreate: false,
    createOpen: false,
    createForm: emptyCreateForm(null),
    templates: { range: ["空白清单"], ids: [null] }
  },

  onLoad(query) {
    const status = (query && query.status) || "";
    this.projectId = queryId(query && query.projectId);
    this.wantsCreate = Boolean(query && query.create === "1");
    this.pageNo = 1;
    this.setData({
      activeStatus: KIT_STATUS_TABS.some((tab) => tab.key === status) ? status : "",
      createForm: emptyCreateForm(this.projectId)
    });
  },

  async onShow() {
    await this.ensureViewer();
    await this.reload();
    // 从项目页点"新建清单"过来：进页面就打开新建面板，只开这一次
    if (this.wantsCreate && this.data.canCreate) {
      this.wantsCreate = false;
      await this.openCreate();
    }
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

  async ensureViewer() {
    if (this.viewer) return;
    try {
      this.viewer = await loadViewer();
      this.setData({ canCreate: Boolean(this.viewer.caps.can_create_kit) });
    } catch (error) {
      toast(errorText(error, "权限加载失败"));
    }
  },

  async reload() {
    this.pageNo = 1;
    await this.load(true);
  },

  async load(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await whGet("/kit", {
        project_id: this.projectId,
        status: this.data.activeStatus,
        page: this.pageNo,
        pageSize: PAGE_SIZE
      });
      const fresh = (Array.isArray(result.data) ? result.data : []).map(toKitListRow);
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
      toast(errorText(error, "清单加载失败"));
    } finally {
      this.setData({ loading: false });
    }
  },

  async onStatusTab(event) {
    const key = event.currentTarget.dataset.key || "";
    if (key === this.data.activeStatus || this.data.loading) return;
    this.setData({ activeStatus: key, rows: [], total: 0, finished: false });
    await this.reload();
  },

  openKit(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    wx.navigateTo({ url: `/packageWarehouse/kit/index?id=${id}` });
  },

  async openCreate() {
    if (!this.data.canCreate) return;
    this.setData({ createOpen: true });
    if (this.templatesLoaded) return;
    try {
      const result = await whGet("/kit-template", { status: "active" });
      const list = Array.isArray(result.data) ? result.data : [];
      this.templatesLoaded = true;
      this.setData({
        templates: {
          range: ["空白清单", ...list.map((template) => template.name)],
          ids: [null, ...list.map((template) => template.id)]
        }
      });
    } catch (error) {
      // 模板取不到还能建空白清单
      toast(errorText(error, "模板加载失败，可以先建空白清单"));
    }
  },

  closeCreate() {
    if (this.data.busy) return;
    this.setData({ createOpen: false });
  },

  onCreateProject(event) {
    const detail = event.detail || {};
    this.setData({
      "createForm.projectId": queryId(detail.projectId),
      "createForm.projectName": detail.projectName || ""
    });
  },

  onTemplatePick(event) {
    const index = Number(event.detail && event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.templates.ids.length) return;
    this.setData({ "createForm.templateIndex": index });
  },

  onCreateTitle(event) {
    this.setData({ "createForm.title": String((event.detail && event.detail.value) || "") });
  },

  async submitCreate() {
    if (this.data.busy) return;
    const form = this.data.createForm;
    const problem = newKitProblem(form);
    if (problem) {
      toast(problem);
      return;
    }
    const templateId = this.data.templates.ids[form.templateIndex];
    this.setData({ busy: true });
    try {
      const result = await whSend("POST", "/kit", {
        project_id: form.projectId,
        title: form.title.trim(),
        ...(templateId ? { template_id: templateId } : {})
      });
      this.setData({ createOpen: false, createForm: emptyCreateForm(this.projectId) });
      wx.navigateTo({ url: `/packageWarehouse/kit/index?id=${result.data.id}` });
    } catch (error) {
      toast(errorText(error, "建清单失败，请重试"));
    } finally {
      this.setData({ busy: false });
    }
  },

  noop() {}
});
