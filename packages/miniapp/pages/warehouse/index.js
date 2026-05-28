const { request } = require("../../utils/request");

const defaultKpis = {
  myTaskCount: 0,
  inProgressCount: 0,
  rejectedCount: 0,
  approvedOrderCount: 0,
  alertCount: 0,
  stocktakeCounting: 0
};

const buildActions = (kpis) => [
  {
    title: "我的任务",
    desc: "开始执行、上传照片、提交结果",
    path: "/pages/warehouse-task/index",
    tone: "green",
    showBadge: true,
    count: kpis.myTaskCount
  },
  {
    title: "扫码查验",
    desc: "查看设备状态与库房事件",
    path: "/pages/asset/index",
    tone: "blue",
    showBadge: false,
    count: 0
  },
  {
    title: "待执行单据",
    desc: "处理已审批的出入库单据",
    path: "/pages/warehouse-dispatch/index",
    tone: "orange",
    showBadge: true,
    count: kpis.approvedOrderCount
  },
  {
    title: "盘库执行",
    desc: "录入盘点数量与异常状态",
    path: "/pages/warehouse-stocktake/index",
    tone: "gray",
    showBadge: true,
    count: kpis.stocktakeCounting
  }
];

const buildSecondaryActions = (kpis) => [
  {
    title: "库存与预警",
    desc: "查看库存余量和预警",
    path: "/pages/warehouse-inventory/index",
    showCount: true,
    count: kpis.alertCount
  },
  {
    title: "制单申请",
    desc: "补充发起出入库申请",
    path: "/pages/warehouse-stock-order/index",
    showCount: false,
    count: 0
  }
];

Page({
  data: {
    busy: false,
    kpis: defaultKpis,
    urgentTasks: [],
    actions: buildActions(defaultKpis),
    secondaryActions: buildSecondaryActions(defaultKpis)
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const [taskRes, orderRes, alertRes, stocktakeRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/warehouse/work-order/mobile/my-tasks" }),
        request({ method: "GET", path: "/api/v1/warehouse/stock-order" }),
        request({ method: "GET", path: "/api/v1/warehouse/inventory/alert" }),
        request({ method: "GET", path: "/api/v1/warehouse/stocktake", data: { status: "counting" } })
      ]);

      const tasks = Array.isArray(taskRes.data) ? taskRes.data : [];
      const orders = Array.isArray(orderRes.data) ? orderRes.data : [];
      const alerts = Array.isArray(alertRes.data) ? alertRes.data : [];
      const stocktakes = Array.isArray(stocktakeRes.data) ? stocktakeRes.data : [];

      const approvedOrderCount = orders.filter((item) => item.status === "approved").length;
      const urgentTasks = tasks
        .filter((item) => ["urgent", "high"].includes(item.priority) || item.status === "rejected")
        .slice(0, 3)
        .map((item) => ({
          ...item,
          typeText: this.toTypeLabel(item.work_order_type),
          statusText: this.toStatusLabel(item.status),
          priorityText: this.toPriorityLabel(item.priority),
          scheduledDay: this.toShortDate(item.scheduled_date)
        }));

      const kpis = {
        myTaskCount: tasks.length,
        inProgressCount: tasks.filter((item) => item.status === "in_progress").length,
        rejectedCount: tasks.filter((item) => item.status === "rejected").length,
        approvedOrderCount,
        alertCount: alerts.length,
        stocktakeCounting: stocktakes.length
      };

      this.setData({
        kpis,
        urgentTasks,
        actions: buildActions(kpis),
        secondaryActions: buildSecondaryActions(kpis)
      });
    } catch {
      this.setData({
        kpis: defaultKpis,
        urgentTasks: [],
        actions: buildActions(defaultKpis),
        secondaryActions: buildSecondaryActions(defaultKpis)
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  toTypeLabel(value) {
    const map = {
      inspection: "检查",
      maintenance: "维护",
      servicing: "保养",
      modification: "改装",
      scrapping: "报废"
    };
    return map[value] || "任务";
  },

  toStatusLabel(value) {
    const map = {
      assigned: "待开始",
      in_progress: "执行中",
      rejected: "退回补充",
      submitted: "已提交"
    };
    return map[value] || "待处理";
  },

  toPriorityLabel(value) {
    const map = {
      urgent: "紧急",
      high: "高",
      normal: "普通",
      low: "低"
    };
    return map[value] || "普通";
  },

  toShortDate(value) {
    if (!value) return "未排期";
    return String(value).slice(0, 10);
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["我的库房任务", "扫码查验", "待执行单据", "库存与预警", "盘库执行"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: "/pages/warehouse-task/index" });
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/asset/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/warehouse-dispatch/index" });
          return;
        }
        if (res.tapIndex === 3) {
          wx.navigateTo({ url: "/pages/warehouse-inventory/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/warehouse-stocktake/index" });
      }
    });
  }
});
