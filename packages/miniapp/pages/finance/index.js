const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

const canLaunchPayment = (roles) => {
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager") ||
    roles.includes("finance")
  );
};

Page({
  data: {
    segment: "pending",
    pendingCount: 0,
    canPaymentApply: false,
    pendingLoading: false,
    pendingList: []
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    this.setData({ canPaymentApply: canLaunchPayment(roles) });
    this.loadPendingList();
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
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  },

  mapApprovalItem(item) {
    return {
      ...item,
      bizTypeLabel: this.bizTypeLabel(item.biz_type),
      statusText: this.statusLabel(item.status),
      submittedAtText: this.formatBeijingTime(item.submitted_at)
    };
  },

  async loadPendingList() {
    this.setData({ pendingLoading: true });
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=30"
      });
      const list = Array.isArray(res.data) ? res.data : [];
      this.setData({
        pendingCount: list.length,
        pendingList: list.map((item) => this.mapApprovalItem(item))
      });
    } catch {
      this.setData({ pendingCount: 0, pendingList: [] });
    } finally {
      this.setData({ pendingLoading: false });
    }
  },

  onSegmentChange(e) {
    const next = e.currentTarget.dataset.value;
    this.setData({ segment: next });
    if (next === "pending") {
      this.loadPendingList();
    }
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openPendingDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/approval-detail/index?id=${id}` });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: [
        "🎤 我要发起对外付款",
        "🎤 我要审批单据",
        "🎤 我要发起报销",
        "🎤 我要扫码核查报销信封",
        "🎤 我要发起油卡额度申请"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          if (!this.data.canPaymentApply) {
            wx.showToast({ title: "当前角色无对外付款权限", icon: "none" });
            return;
          }
          wx.navigateTo({ url: "/pages/payment-apply/index" });
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/approval/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/reimbursement-list/index" });
          return;
        }
        if (res.tapIndex === 3) {
          wx.navigateTo({ url: "/pages/reimbursement-archive/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/fuel-apply/index" });
      }
    });
  }
});
