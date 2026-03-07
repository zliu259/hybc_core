const { request } = require("../../utils/request");
const { sayToast } = require("../../utils/interaction");

Page({
  data: {
    activeTab: "pending",
    pending: [],
    processed: [],
    cc: [],
    loading: false,
    pendingCount: 0,
    processedCount: 0,
    ccCount: 0
  },

  onShow() {
    this.loadAll();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  statusLabel(status) {
    const map = {
      pending: "待处理",
      in_progress: "进行中",
      approved: "已通过",
      rejected: "已驳回",
      cancelled: "已取消",
      withdrawn: "已撤回",
      completed: "已完成",
      transferred: "已转签"
    };
    return map[status] || "未知";
  },

  bizTypeLabel(value) {
    const map = {
      outbound_contract: "对外合同审批",
      inbound_contract: "收款合同审批",
      payment_request: "付款审批",
      reimbursement_batch: "报销审批"
    };
    return map[value] || "未知类型";
  },

  cardClassByType(bizType) {
    const map = {
      payment_request: "card-payment",
      outbound_contract: "card-contract-out",
      inbound_contract: "card-contract-in",
      reimbursement_batch: "card-reimburse"
    };
    return map[bizType] || "card-default";
  },

  formatBeijingTime(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const yyyy = bj.getUTCFullYear();
    const mm = String(bj.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(bj.getUTCDate()).padStart(2, "0");
    const hh = String(bj.getUTCHours()).padStart(2, "0");
    const mi = String(bj.getUTCMinutes()).padStart(2, "0");
    const ss = String(bj.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  },

  mapListItem(item) {
    return {
      ...item,
      bizTypeLabel: this.bizTypeLabel(item.biz_type),
      cardClass: this.cardClassByType(item.biz_type),
      statusText: this.statusLabel(item.status),
      submittedAtText: this.formatBeijingTime(item.submitted_at),
      actedAtText: this.formatBeijingTime(item.acted_at)
    };
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      const [pendingRes, processedRes, ccRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/approval/pending?page=1&pageSize=50" }),
        request({ method: "GET", path: "/api/v1/approval/processed?page=1&pageSize=50" }),
        request({ method: "GET", path: "/api/v1/approval/cc?page=1&pageSize=50" })
      ]);

      const pending = Array.isArray(pendingRes.data) ? pendingRes.data : [];
      const processed = Array.isArray(processedRes.data) ? processedRes.data : [];
      const cc = Array.isArray(ccRes.data) ? ccRes.data : [];

      this.setData({
        pending: pending.map((item) => this.mapListItem(item)),
        processed: processed.map((item) => this.mapListItem(item)),
        cc: cc.map((item) => this.mapListItem(item)),
        pendingCount: pending.length,
        processedCount: processed.length,
        ccCount: cc.length
      });
    } catch (error) {
      sayToast({ title: error.message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/approval-detail/index?id=${id}` });
  }
});
