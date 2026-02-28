const { request } = require("../../utils/request");

Page({
  data: {
    busy: false,
    inboundPending: [],
    outboundPending: [],
    executing: [],
    done: []
  },

  onShow() {
    this.loadData();
  },

  toOrderTypeLabel(value) {
    if (value === "inbound") return "入库";
    if (value === "outbound") return "出库";
    return "调拨";
  },

  buildBuckets(rows) {
    const inboundPending = [];
    const outboundPending = [];
    const executing = [];
    const done = [];

    (rows || []).forEach((item) => {
      const row = {
        ...item,
        orderTypeText: this.toOrderTypeLabel(item.order_type)
      };
      if (["executed", "cancelled", "rejected"].includes(item.status)) {
        done.push(row);
        return;
      }
      if (item.status === "approved") {
        executing.push(row);
        return;
      }
      if (item.order_type === "inbound") {
        inboundPending.push(row);
      } else {
        outboundPending.push(row);
      }
    });

    return { inboundPending, outboundPending, executing, done };
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/warehouse/stock-order" });
      const rows = Array.isArray(res.data) ? res.data : [];
      this.setData(this.buildBuckets(rows));
    } catch (error) {
      wx.showToast({ title: error.message || "调度数据加载失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async executeOrder(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await request({ method: "POST", path: `/api/v1/warehouse/stock-order/${id}/execute` });
      wx.showToast({ title: "执行成功", icon: "success" });
      await this.loadData();
    } catch (error) {
      wx.showToast({ title: error.message || "执行失败", icon: "none" });
      this.setData({ busy: false });
    }
  }
});
