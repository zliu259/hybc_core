const { request } = require("../../utils/request");

const today = () => new Date().toISOString().slice(0, 10);

const LINE_STATUS = [
  { label: "正常", value: "normal" },
  { label: "新增", value: "new" },
  { label: "破损", value: "damaged" },
  { label: "盘亏", value: "lost" }
];

Page({
  data: {
    busy: false,
    taskBusy: false,
    lineBusy: false,
    addBusy: false,
    warehouses: [],
    warehouseNames: [],
    assetTypes: [],
    assetTypeNames: [],
    tasks: [],
    activeTask: null,
    activeTaskId: 0,

    createTitle: "",
    createScope: "company",
    createWarehouseIndex: -1,
    createPlannedDate: today(),

    addKind: "consumable",
    addWarehouseIndex: -1,
    addAssetTypeIndex: -1,
    addCustomName: "",
    addQuantity: "1",
    addUnit: "件",
    addLineStatusIndex: 1,
    addNote: ""
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const [warehouseRes, typeRes, taskRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/warehouse" }),
        request({ method: "GET", path: "/api/v1/asset/type" }),
        request({ method: "GET", path: "/api/v1/warehouse/stocktake" })
      ]);
      const warehouses = Array.isArray(warehouseRes.data) ? warehouseRes.data : [];
      const assetTypes = Array.isArray(typeRes.data) ? typeRes.data : [];
      const tasks = (Array.isArray(taskRes.data) ? taskRes.data : []).map((item) => ({
        ...item,
        statusText: this.formatStatusText(item.status)
      }));
      this.setData({
        warehouses,
        warehouseNames: warehouses.map((item) => `${item.warehouse_code} · ${item.warehouse_name}`),
        assetTypes,
        assetTypeNames: assetTypes.map((item) => `${item.type_code || ""} · ${item.type_name || ""}`),
        tasks
      });
      if (tasks.length > 0) {
        await this.selectTask(tasks[0].id);
      } else {
        this.setData({ activeTask: null, activeTaskId: 0 });
      }
    } catch (error) {
      wx.showToast({ title: error.message || "盘库数据加载失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  formatStatusText(value) {
    if (value === "completed") return "已完成";
    if (value === "counting") return "盘点中";
    return "草稿";
  },

  formatKindText(value) {
    return value === "asset" ? "设备资产" : "消耗品";
  },

  formatLineStatusText(value) {
    const hit = LINE_STATUS.find((item) => item.value === value);
    return hit ? hit.label : "未知";
  },

  async selectTask(taskId) {
    if (!taskId || this.data.taskBusy) return;
    this.setData({ taskBusy: true });
    try {
      const detail = await request({ method: "GET", path: `/api/v1/warehouse/stocktake/${taskId}` });
      const rawTask = detail.data || null;
      const activeTask = rawTask
        ? {
            ...rawTask,
            statusText: this.formatStatusText(rawTask.status),
            lines: (rawTask.lines || []).map((line) => ({
              ...line,
              kindText: this.formatKindText(line.item_kind),
              lineStatusText: this.formatLineStatusText(line.line_status),
              lineStatusIndex: Math.max(0, ["normal", "new", "damaged", "lost"].indexOf(line.line_status))
            }))
          }
        : null;
      this.setData({ activeTask, activeTaskId: Number(taskId) });
    } catch (error) {
      wx.showToast({ title: error.message || "盘点任务加载失败", icon: "none" });
    } finally {
      this.setData({ taskBusy: false });
    }
  },

  onTapTask(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    this.selectTask(id);
  },

  onCreateTitleInput(e) {
    this.setData({ createTitle: (e.detail.value || "").trimStart() });
  },

  onScopeChange(e) {
    const scope = e.detail.value === "warehouse" ? "warehouse" : "company";
    this.setData({ createScope: scope });
  },

  onCreateWarehouseChange(e) {
    this.setData({ createWarehouseIndex: Number(e.detail.value || -1) });
  },

  onCreateDateChange(e) {
    this.setData({ createPlannedDate: e.detail.value || today() });
  },

  async createTask() {
    if (this.data.busy) return;
    const title = String(this.data.createTitle || "").trim();
    if (!title) {
      wx.showToast({ title: "请填写盘点任务名称", icon: "none" });
      return;
    }
    if (!this.data.createPlannedDate) {
      wx.showToast({ title: "请选择盘点日期", icon: "none" });
      return;
    }

    const payload = {
      task_title: title,
      scope: this.data.createScope,
      planned_date: this.data.createPlannedDate
    };

    if (this.data.createScope === "warehouse") {
      const warehouse = this.data.warehouses[this.data.createWarehouseIndex];
      if (!warehouse) {
        wx.showToast({ title: "单仓库盘点需要选择仓库", icon: "none" });
        return;
      }
      payload.warehouse_id = Number(warehouse.id);
    }

    this.setData({ busy: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const result = await request({ method: "POST", path: "/api/v1/warehouse/stocktake", data: payload });
      wx.hideLoading();
      wx.showToast({ title: `已创建 ${result.data.task_no}`, icon: "success" });
      this.setData({ createTitle: "" });
      await this.loadData();
      if (result.data && result.data.id) {
        await this.selectTask(Number(result.data.id));
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "创建盘点失败", icon: "none" });
      this.setData({ busy: false });
    }
  },

  onLineQtyInput(e) {
    const idx = Number(e.currentTarget.dataset.index || -1);
    if (idx < 0 || !this.data.activeTask) return;
    const lines = [...(this.data.activeTask.lines || [])];
    if (!lines[idx]) return;
    lines[idx].counted_qty = e.detail.value;
    this.setData({ activeTask: { ...this.data.activeTask, lines } });
  },

  onLineStatusChange(e) {
    const idx = Number(e.currentTarget.dataset.index || -1);
    if (idx < 0 || !this.data.activeTask) return;
    const nextIndex = Number(e.detail.value || 0);
    const lines = [...(this.data.activeTask.lines || [])];
    if (!lines[idx]) return;
    lines[idx].line_status = LINE_STATUS[nextIndex] ? LINE_STATUS[nextIndex].value : "normal";
    lines[idx].lineStatusIndex = nextIndex;
    lines[idx].lineStatusText = this.formatLineStatusText(lines[idx].line_status);
    this.setData({ activeTask: { ...this.data.activeTask, lines } });
  },

  onLineNoteInput(e) {
    const idx = Number(e.currentTarget.dataset.index || -1);
    if (idx < 0 || !this.data.activeTask) return;
    const lines = [...(this.data.activeTask.lines || [])];
    if (!lines[idx]) return;
    lines[idx].note = e.detail.value || "";
    this.setData({ activeTask: { ...this.data.activeTask, lines } });
  },

  async saveLine(e) {
    if (!this.data.activeTask || this.data.lineBusy) return;
    const idx = Number(e.currentTarget.dataset.index || -1);
    const line = (this.data.activeTask.lines || [])[idx];
    if (!line) return;
    const countedQty = Number(line.counted_qty);
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      wx.showToast({ title: "实盘数量需为非负数", icon: "none" });
      return;
    }

    this.setData({ lineBusy: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      await request({
        method: "PUT",
        path: `/api/v1/warehouse/stocktake/${this.data.activeTask.id}/line/${line.id}`,
        data: {
          counted_qty: countedQty,
          line_status: line.line_status,
          note: line.note || undefined
        }
      });
      await this.selectTask(this.data.activeTask.id);
      wx.hideLoading();
      wx.showToast({ title: "明细已保存", icon: "success" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "保存明细失败", icon: "none" });
    } finally {
      this.setData({ lineBusy: false });
    }
  },

  onAddKindChange(e) {
    const kind = e.detail.value === "asset" ? "asset" : "consumable";
    this.setData({ addKind: kind });
  },

  onAddWarehouseChange(e) {
    this.setData({ addWarehouseIndex: Number(e.detail.value || -1) });
  },

  onAddAssetTypeChange(e) {
    this.setData({ addAssetTypeIndex: Number(e.detail.value || -1) });
  },

  onAddCustomNameInput(e) {
    this.setData({ addCustomName: e.detail.value || "" });
  },

  onAddQuantityInput(e) {
    this.setData({ addQuantity: e.detail.value || "" });
  },

  onAddUnitInput(e) {
    this.setData({ addUnit: e.detail.value || "件" });
  },

  onAddStatusChange(e) {
    this.setData({ addLineStatusIndex: Number(e.detail.value || 1) });
  },

  onAddNoteInput(e) {
    this.setData({ addNote: e.detail.value || "" });
  },

  async addNewLine() {
    if (!this.data.activeTask || this.data.addBusy) return;
    const warehouse = this.data.warehouses[this.data.addWarehouseIndex];
    if (!warehouse) {
      wx.showToast({ title: "请选择归属仓库", icon: "none" });
      return;
    }
    const qty = Number(this.data.addQuantity || 0);
    if (!qty || qty <= 0) {
      wx.showToast({ title: "盘点数量必须大于0", icon: "none" });
      return;
    }

    const assetType = this.data.assetTypes[this.data.addAssetTypeIndex];
    const assetTypeId = assetType ? Number(assetType.id) : 0;
    const customName = String(this.data.addCustomName || "").trim();
    if (!assetTypeId && !customName) {
      wx.showToast({ title: "请选择资产类型或填写新物品名称", icon: "none" });
      return;
    }

    const lineStatus = LINE_STATUS[this.data.addLineStatusIndex]
      ? LINE_STATUS[this.data.addLineStatusIndex].value
      : "new";

    this.setData({ addBusy: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      await request({
        method: "POST",
        path: `/api/v1/warehouse/stocktake/${this.data.activeTask.id}/line`,
        data: {
          warehouse_id: Number(warehouse.id),
          item_kind: this.data.addKind,
          asset_type_id: assetTypeId || undefined,
          item_name: customName || undefined,
          counted_qty: qty,
          unit: this.data.addUnit || "件",
          line_status: lineStatus,
          note: this.data.addNote || undefined
        }
      });
      wx.hideLoading();
      wx.showToast({ title: "新增物品已加入盘库", icon: "success" });
      this.setData({
        addAssetTypeIndex: -1,
        addCustomName: "",
        addQuantity: "1",
        addUnit: "件",
        addLineStatusIndex: 1,
        addNote: ""
      });
      await this.selectTask(this.data.activeTask.id);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "新增物品失败", icon: "none" });
    } finally {
      this.setData({ addBusy: false });
    }
  },

  async completeTask() {
    if (!this.data.activeTask || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const res = await request({
        method: "POST",
        path: `/api/v1/warehouse/stocktake/${this.data.activeTask.id}/complete`
      });
      wx.hideLoading();
      wx.showToast({ title: `盘点完成，差异${res.data.diff_count}条`, icon: "success" });
      await this.loadData();
      await this.selectTask(this.data.activeTask.id);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "完成盘点失败", icon: "none" });
      this.setData({ busy: false });
    }
  }
});
