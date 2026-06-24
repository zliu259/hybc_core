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
    applyActionCount: 5,
    applyActions: [],
    pendingLoading: false,
    pendingList: []
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const canPaymentApply = canLaunchPayment(roles);
    this.setData({
      canPaymentApply,
      applyActions: this.buildApplyActions(canPaymentApply)
    });
    this.loadPendingList();
  },

  buildApplyActions(canPaymentApply) {
    return [
      {
        title: "💸 智能发单台",
        desc: canPaymentApply ? "金额阈值识别 + 直付/合同双流程" : "当前角色无权限",
        path: "/pages/payment-apply/index",
        tone: "blue",
        disabled: !canPaymentApply
      },
      {
        title: "🧾 我的报销提交",
        desc: "发起报销、上传票据、跟踪状态",
        path: "/pages/reimbursement-list/index",
        tone: "green",
        disabled: false
      },
      {
        title: "📂 信封扫码核查",
        desc: "办公室扫码信封UUID，快速打开电子档案",
        path: "/pages/reimbursement-archive/index",
        tone: "orange",
        disabled: false
      },
      {
        title: "⛽ 油卡额度申请",
        desc: "填写油卡额度、车辆里程并上传现场照片",
        path: "/pages/fuel-apply/index",
        tone: "yellow",
        disabled: false
      },
      {
        title: "🔧 车辆保养记录",
        desc: "填写保养里程、内容、费用并上传附件",
        path: "/pages/vehicle-maintenance/index",
        tone: "blue",
        disabled: false
      },
      {
        title: "🗂️ 我发起的申请",
        desc: "进入审批视图查看我发起的申请（只读）",
        path: "/pages/approval-initiated/index",
        tone: "gray",
        disabled: false
      }
    ];
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
    const disabled = e.currentTarget.dataset.disabled === "true" || e.currentTarget.dataset.disabled === true;
    if (disabled) {
      wx.showToast({ title: "当前角色无权限", icon: "none" });
      return;
    }
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
