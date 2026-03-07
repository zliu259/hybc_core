const { request } = require("../../utils/request");

const today = () => new Date().toISOString().slice(0, 10);

const inventoryStatusText = {
  normal: "正常",
  low: "库存不足",
  warning: "预警",
  critical: "紧急",
  disabled: "停用"
};

Page({
  data: {
    busy: false,
    warehouses: [],
    warehouseNames: [],
    inventory: [],
    alerts: [],
    warehouseIndex: -1,
    quantity: "1",
    consumedDate: today(),
    remark: ""
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const [warehouseRes, inventoryRes, alertRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/warehouse" }),
        request({ method: "GET", path: "/api/v1/warehouse/inventory" }),
        request({ method: "GET", path: "/api/v1/warehouse/inventory/alert" })
      ]);
      const warehouses = Array.isArray(warehouseRes.data) ? warehouseRes.data : [];
      this.setData({
        warehouses,
        warehouseNames: warehouses.map((item) => `${item.warehouse_code} · ${item.warehouse_name}`),
        inventory: (Array.isArray(inventoryRes.data) ? inventoryRes.data : []).map((item) => ({
          ...item,
          statusText: inventoryStatusText[item.status] || "未知"
        })),
        alerts: Array.isArray(alertRes.data) ? alertRes.data : []
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  onWarehouseChange(e) {
    this.setData({ warehouseIndex: Number(e.detail.value || 0) });
  },

  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value || "" });
  },

  onDateChange(e) {
    this.setData({ consumedDate: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value || "" });
  },

  async analyzeAlert(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    this.setData({ busy: true });
    try {
      await request({ method: "POST", path: `/api/v1/warehouse/inventory/alert/${id}/analyze` });
      wx.showToast({ title: "已触发AI分析", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "触发失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  }
});
