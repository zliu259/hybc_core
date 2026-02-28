const { request } = require("../../utils/request");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

Page({
  data: {
    busy: false,
    kpis: {
      warehouseCount: 0,
      pendingOrderCount: 0,
      alertCount: 0,
      inventoryCount: 0
    }
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const [warehouseRes, orderRes, alertRes, inventoryRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/warehouse" }),
        request({ method: "GET", path: "/api/v1/warehouse/stock-order" }),
        request({ method: "GET", path: "/api/v1/warehouse/inventory/alert" }),
        request({ method: "GET", path: "/api/v1/warehouse/inventory" })
      ]);

      const warehouses = Array.isArray(warehouseRes.data) ? warehouseRes.data : [];
      const orders = Array.isArray(orderRes.data) ? orderRes.data : [];
      const alerts = Array.isArray(alertRes.data) ? alertRes.data : [];
      const inventory = Array.isArray(inventoryRes.data) ? inventoryRes.data : [];

      const pendingOrderCount = orders.filter((item) => ["draft", "pending_approval", "approved"].includes(item.status)).length;

      this.setData({
        kpis: {
          warehouseCount: warehouses.length,
          pendingOrderCount,
          alertCount: alerts.length,
          inventoryCount: inventory.length
        }
      });
    } catch {
      this.setData({
        kpis: {
          warehouseCount: 0,
          pendingOrderCount: 0,
          alertCount: 0,
          inventoryCount: 0
        }
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "📦 出入库制单", "📊 库存概览", "🚚 调度看板"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "warehouse" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/warehouse-stock-order/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/warehouse-inventory/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/warehouse-dispatch/index" });
      }
    });
  }
});
