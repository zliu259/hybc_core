const { whGet, whSend } = require("../common/wh-api");
const {
  SOURCE_OPTIONS,
  buildKitHeader,
  groupBySection,
  kitActions,
  rowProblems,
  toEditableLines,
  toKitLines,
  withFulfilment
} = require("../common/wh-kit-view");
const {
  toast,
  errorText,
  isConflict,
  isNotFound,
  confirmModal,
  promptModal,
  loadViewer,
  loadNameOf,
  queryId
} = require("../common/wh-ui");

const NO_ACTIONS = {
  canEdit: false,
  canSubmit: false,
  canConfirm: false,
  canDiscard: false,
  canClose: false,
  canShip: false
};

/** 确认过的清单（包括之后关闭的）才有执行情况；作废的没有。 */
const hasFulfilment = (kit) =>
  kit.status === "confirmed" || (kit.status === "closed" && Boolean(kit.confirmed_at));

Page({
  data: {
    loading: false,
    notFound: false,
    busy: false,
    // 有没保存的改动：保存按钮高亮；从别的页面回来时不重新加载，免得把改动冲掉
    dirty: false,
    header: null,
    actions: NO_ACTIONS,
    groups: [],
    showFulfilment: false,
    sourceLabels: SOURCE_OPTIONS.map((option) => option.label)
  },

  onLoad(query) {
    this.kitId = queryId(query && query.id);
    this.openSections = {};
    if (this.kitId === null) this.setData({ notFound: true });
  },

  onShow() {
    if (this.data.dirty) return undefined;
    return this.load();
  },

  async onPullDownRefresh() {
    if (!this.data.dirty) await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    if (this.kitId === null || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [result, viewer, nameOf] = await Promise.all([
        whGet(`/kit/${this.kitId}`),
        loadViewer(),
        loadNameOf()
      ]);
      const kit = result.data;
      const showFulfilment = hasFulfilment(kit);
      const rows = showFulfilment
        ? withFulfilment(toEditableLines(kit.lines), await this.loadFulfilment())
        : toEditableLines(kit.lines);
      this.kit = kit;
      const header = buildKitHeader(kit, nameOf);
      this.setData({
        header,
        actions: kitActions(kit, viewer),
        groups: this.regroup(rows, []),
        showFulfilment,
        dirty: false,
        notFound: false
      });
      wx.setNavigationBarTitle({ title: header.kitNo });
    } catch (error) {
      if (isNotFound(error)) this.setData({ notFound: true, header: null });
      toast(errorText(error, "清单加载失败"));
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 执行情况取不到不挡清单本身，行上的已发、待发留空。 */
  async loadFulfilment() {
    try {
      const result = await whGet(`/kit/${this.kitId}/fulfilment`);
      return Array.isArray(result.data) ? result.data : [];
    } catch (error) {
      toast(errorText(error, "执行情况加载失败"));
      return [];
    }
  },

  /** 分组并记住哪些分节是展开的；有问题的分节自动展开。 */
  regroup(rows, problems) {
    return groupBySection(rows, problems).map((group) => {
      const open = Boolean(this.openSections[group.section]) || group.problemCount > 0;
      this.openSections = { ...this.openSections, [group.section]: open };
      return { ...group, open };
    });
  },

  flatRows() {
    return this.data.groups
      .reduce((all, group) => [...all, ...group.rows], [])
      .sort((a, b) => a.index - b.index);
  },

  /** 事件里的分节下标和行下标 → 这一行；下标不对返回 null。 */
  rowAt(event) {
    const g = Number(event.currentTarget.dataset.g);
    const r = Number(event.currentTarget.dataset.r);
    const group = Number.isInteger(g) ? this.data.groups[g] : undefined;
    const row = group && Number.isInteger(r) ? group.rows[r] : undefined;
    return row ? { path: `groups[${g}].rows[${r}]`, row } : null;
  },

  toggleSection(event) {
    const g = Number(event.currentTarget.dataset.g);
    const group = Number.isInteger(g) ? this.data.groups[g] : undefined;
    if (!group) return;
    this.openSections = { ...this.openSections, [group.section]: !group.open };
    this.setData({ [`groups[${g}].open`]: !group.open });
  },

  onQtyInput(event) {
    const target = this.rowAt(event);
    if (!target || !this.data.actions.canEdit) return;
    this.setData({
      [`${target.path}.qty`]: String((event.detail && event.detail.value) || ""),
      dirty: true
    });
  },

  onSourcePick(event) {
    const target = this.rowAt(event);
    const index = Number(event.detail && event.detail.value);
    const option = Number.isInteger(index) ? SOURCE_OPTIONS[index] : undefined;
    if (!target || !option || !this.data.actions.canEdit) return;
    this.setData({
      [`${target.path}.source`]: option.key,
      [`${target.path}.sourceLabel`]: option.label,
      [`${target.path}.sourceIndex`]: index,
      dirty: true
    });
  },

  onSpecPick(event) {
    const target = this.rowAt(event);
    const index = Number(event.detail && event.detail.value);
    const choice = target && Number.isInteger(index) ? target.row.specChoices[index] : undefined;
    if (!target || !choice || !this.data.actions.canEdit) return;
    this.setData({
      [`${target.path}.materialId`]: choice.id,
      [`${target.path}.detailText`]: choice.spec || "",
      [`${target.path}.needsSpec`]: false,
      [`${target.path}.problem`]: "",
      dirty: true
    });
  },

  /** 有没选规格等问题就提示、展开那几个分节并停下。 */
  blockedByProblems() {
    const rows = this.flatRows();
    const problems = rowProblems(rows);
    if (problems.length === 0) return false;
    toast(`有 ${problems.length} 行要先处理`);
    this.setData({ groups: this.regroup(rows, problems) });
    return true;
  },

  /**
   * 把改动存下。成功后重新加载，this.kit.version 是新的。
   * 撞上别人的改动时提示并重新加载（自己没存上的改动不留着）。
   * @returns {Promise<boolean>}
   */
  async saveRows() {
    const { id, version, title, remark } = this.kit;
    let conflict = false;
    this.setData({ busy: true });
    try {
      await whSend("PUT", `/kit/${id}`, {
        version,
        title,
        remark: remark || null,
        lines: toKitLines(this.flatRows())
      });
    } catch (error) {
      toast(errorText(error, "保存失败，请重试"));
      conflict = isConflict(error);
      if (!conflict) return false;
    } finally {
      this.setData({ busy: false });
    }
    this.setData({ dirty: false });
    await this.load();
    return !conflict;
  },

  /** 提交、确认前：能改的清单先查行；有改动就先保存。 */
  async readyToProceed() {
    if (!this.data.actions.canEdit) return true;
    if (this.blockedByProblems()) return false;
    return this.data.dirty ? this.saveRows() : true;
  },

  /**
   * @param {() => Promise<object>} action
   * @param {(result: object) => string} successText
   */
  async runAction(action, successText) {
    this.setData({ busy: true });
    try {
      toast(successText(await action()));
    } catch (error) {
      toast(errorText(error));
      if (!isConflict(error)) return;
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  async save() {
    if (this.data.busy || !this.kit || !this.data.actions.canEdit) return;
    if (await this.saveRows()) toast("已保存");
  },

  async submit() {
    if (this.data.busy || !this.kit || !this.data.actions.canSubmit) return;
    if (!(await this.readyToProceed())) return;
    await this.runAction(
      () => whSend("POST", `/kit/${this.kitId}/submit`, { version: this.kit.version }),
      (result) =>
        result && result.data && result.data.status === "confirmed"
          ? "已提交并确认"
          : "已提交，等库管确认"
    );
  },

  async confirmKit() {
    if (this.data.busy || !this.kit || !this.data.actions.canConfirm) return;
    // 库管在待确认的清单上改过数量再点确认：先保存，改动不会丢
    if (!(await this.readyToProceed())) return;
    await this.runAction(
      () => whSend("POST", `/kit/${this.kitId}/confirm`, { version: this.kit.version }),
      () => "清单已确认"
    );
  },

  async discardKit() {
    if (this.data.busy || !this.kit || !this.data.actions.canDiscard) return;
    const reason = await promptModal({ title: "作废清单", placeholder: "为什么作废" });
    if (reason === null) return;
    if (!reason) {
      toast("请写作废原因");
      return;
    }
    await this.runAction(
      () => whSend("POST", `/kit/${this.kitId}/discard`, { version: this.kit.version, reason }),
      () => "清单已作废"
    );
  },

  async closeKit() {
    if (this.data.busy || !this.kit || !this.data.actions.canClose) return;
    const sure = await confirmModal({
      title: "关闭清单",
      content: "关闭后这份清单只能查看。项目要先结清（设备都离场、周转件都退回或报损）。",
      confirmText: "关闭"
    });
    if (!sure) return;
    await this.runAction(
      () => whSend("POST", `/kit/${this.kitId}/close`, { version: this.kit.version }),
      () => "清单已关闭"
    );
  },

  goShip() {
    if (!this.kit) return;
    wx.navigateTo({ url: `/packageWarehouse/ship/index?type=out&kitId=${this.kit.id}` });
  },

  goProject() {
    if (!this.kit) return;
    wx.navigateTo({ url: `/packageWarehouse/project/index?projectId=${this.kit.project_id}` });
  }
});
