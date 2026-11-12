const { whGet, whSend } = require("../common/wh-api");
const {
  FILTER_OPTIONS,
  SCOPE_OPTIONS,
  buildStocktakeView,
  parseCount,
  withMaterialLine
} = require("../common/wh-stocktake-view");
const {
  toast,
  errorText,
  isConflict,
  confirmModal,
  alertModal,
  promptModal,
  loadViewer,
  queryId
} = require("../common/wh-ui");
const deviceMethods = require("./devices");

/**
 * 盘点。不带参数：显示进行中的那一次，没有的话库管可以发起；带 id：看那一次（可以是已完成的，只读）。
 * 物资逐条点开录实盘数，设备连续扫码或逐台标记；完成和取消在底部。
 */
Page({
  data: {
    loading: true,
    loadFailed: false,
    isKeeper: false,
    /** buildStocktakeView 的结果；没有盘点时是 null */
    view: null,
    scopeOptions: SCOPE_OPTIONS,
    filterOptions: FILTER_OPTIONS,
    filter: "all",
    keyword: "",
    tab: "material",
    /** 正在录的那一行：{ lineId, title, bookText, countText, note, counted } */
    editing: null,
    busy: false,
    scanning: false
  },

  ...deviceMethods,

  onLoad(query) {
    this.stocktakeId = queryId(query && query.id);
    this.detail = null;
    this.unloaded = false;
    return this.init();
  },

  onUnload() {
    this.unloaded = true;
  },

  /** 离开页面之后回来的请求不再动页面 */
  apply(patch) {
    if (!this.unloaded) this.setData(patch);
  },

  render(extra = {}) {
    this.apply({
      ...extra,
      view: buildStocktakeView(this.detail, {
        isKeeper: this.data.isKeeper,
        filter: this.data.filter,
        keyword: this.data.keyword,
        tab: this.data.tab
      })
    });
  },

  async init() {
    try {
      const viewer = await loadViewer();
      this.apply({ isKeeper: Boolean(viewer.caps && viewer.caps.is_keeper) });
    } catch (error) {
      // 权限取不到按只读处理；下面取盘点时如果也失败，会有提示
      console.warn("[stocktake] 读取库房权限失败", error);
    }
    await this.load();
  },

  async load() {
    this.apply({ loading: true });
    try {
      let id = this.stocktakeId;
      if (id === null) {
        const list = await whGet("/stocktake", { status: "counting", pageSize: 1 });
        const first = Array.isArray(list.data) ? list.data[0] : null;
        id = first ? first.id : null;
      }
      this.detail = id === null ? null : (await whGet(`/stocktake/${id}`)).data || null;
      this.render({ loadFailed: false });
    } catch (error) {
      this.apply({ loadFailed: true });
      toast(errorText(error, "盘点加载失败"));
    } finally {
      this.apply({ loading: false });
    }
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  canEdit() {
    return Boolean(this.data.view && this.data.view.canEdit);
  },

  async onStart(event) {
    if (this.data.busy || !this.data.isKeeper) return;
    const scope = String(event.currentTarget.dataset.scope || "");
    const option = SCOPE_OPTIONS.find((item) => item.key === scope);
    if (!option) return;
    const ok = await confirmModal({
      title: "发起盘点？",
      content: `${option.label}。${option.hint}。盘完之前不能再发起另一次。`,
      confirmText: "开始盘点"
    });
    if (!ok) return;
    this.apply({ busy: true });
    try {
      const result = await whSend("POST", "/stocktake", { scope });
      this.detail = result.data || null;
      this.render();
    } catch (error) {
      toast(errorText(error, "发起失败，请稍后重试"));
      // 别人刚发起了一次：把那一次显示出来
      if (isConflict(error)) await this.load();
    } finally {
      this.apply({ busy: false });
    }
  },

  onTab(event) {
    this.setData({ tab: String(event.currentTarget.dataset.key || "material") });
    this.render();
  },

  onFilter(event) {
    this.setData({ filter: String(event.currentTarget.dataset.key || "all") });
    this.render();
  },

  onSearchInput(event) {
    this.setData({ keyword: String((event.detail && event.detail.value) || "") });
    this.render();
  },

  openLine(event) {
    if (!this.canEdit()) return;
    const id = Number(event.currentTarget.dataset.id);
    const line = this.detail.material_lines.find((item) => item.id === id);
    if (!line) return;
    const counted = line.counted_qty !== null && line.counted_qty !== undefined;
    this.setData({
      editing: {
        lineId: id,
        title: [line.name, line.spec].filter(Boolean).join(" "),
        // 保存时记下的就是现在的账面数
        bookText: `现在账面 ${line.current_qty} ${line.unit}`,
        countText: counted ? String(line.counted_qty) : "",
        note: line.note || "",
        counted
      }
    });
  },

  onCountInput(event) {
    this.setData({ "editing.countText": String((event.detail && event.detail.value) || "") });
  },

  onNoteInput(event) {
    this.setData({ "editing.note": String((event.detail && event.detail.value) || "") });
  },

  closeEdit() {
    if (this.data.busy) return;
    this.setData({ editing: null });
  },

  noop() {},

  async saveLine() {
    const editing = this.data.editing;
    if (!editing || this.data.busy) return;
    const parsed = parseCount(editing.countText);
    if (parsed.error) {
      toast(parsed.error);
      return;
    }
    if (parsed.value === null) {
      toast("先填实盘数");
      return;
    }
    await this.sendLine(
      editing.lineId,
      { counted_qty: parsed.value, note: String(editing.note || "").trim() },
      "已保存"
    );
  },

  async clearLine() {
    const editing = this.data.editing;
    if (!editing || this.data.busy) return;
    await this.sendLine(editing.lineId, { counted_qty: null, note: "" }, "已清掉");
  },

  async sendLine(lineId, data, okText) {
    this.apply({ busy: true });
    try {
      const result = await whSend(
        "PUT",
        `/stocktake/${this.detail.id}/material-line/${lineId}`,
        data
      );
      // 只换这一行，不整页重拉：物资有几百条
      this.detail = withMaterialLine(this.detail, result.data);
      this.render({ editing: null });
      toast(okText);
    } catch (error) {
      toast(errorText(error, "保存失败，请稍后重试"));
      // 盘点已经被别人完成或取消了
      if (isConflict(error)) {
        this.apply({ editing: null });
        await this.load();
      }
    } finally {
      this.apply({ busy: false });
    }
  },

  async onComplete() {
    if (this.data.busy || !this.canEdit()) return;
    this.apply({ busy: true });
    try {
      // 先重新取一次：确认框里的数和带上去的版本都要是最新的
      const fresh = (await whGet(`/stocktake/${this.detail.id}`)).data;
      this.detail = fresh;
      this.render();
      const ok = await confirmModal({
        title: "完成盘点？",
        content: [...this.data.view.summaryLines, "完成之后不能再改。"].join("\n"),
        confirmText: "完成",
        cancelText: "再看看"
      });
      if (!ok) return;
      const result = await whSend("POST", `/stocktake/${fresh.id}/complete`, {
        version: fresh.version
      });
      this.detail = result.data.stocktake;
      this.render();
      await alertModal({
        title: "盘点已完成",
        content: result.data.adjust_doc
          ? `调整单 ${result.data.adjust_doc.doc_no}`
          : "没有差额，没出调整单"
      });
    } catch (error) {
      toast(errorText(error, "完成失败，请稍后重试"));
      // 和别人的录入撞上了：重新取，让人再看一眼
      if (isConflict(error)) await this.load();
    } finally {
      this.apply({ busy: false });
    }
  },

  async onCancel() {
    if (this.data.busy || !this.canEdit()) return;
    const reason = await promptModal({
      title: "取消盘点",
      placeholder: "原因（可不填）。取消后这次录的数都不算"
    });
    if (reason === null) return;
    this.apply({ busy: true });
    try {
      await whSend("POST", `/stocktake/${this.detail.id}/cancel`, { reason });
      toast("盘点已取消");
      await this.load();
    } catch (error) {
      toast(errorText(error, "取消失败，请稍后重试"));
      if (isConflict(error)) await this.load();
    } finally {
      this.apply({ busy: false });
    }
  }
});
