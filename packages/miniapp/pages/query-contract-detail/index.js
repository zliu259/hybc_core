const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { parseQueryAttachments, openQueryAttachment } = require("../../utils/attachment-open");
const { contractTypeLabel, amountChangeTypeLabel } = require("../../utils/enum-labels");

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const statusText = (status) => {
  const map = {
    draft: "草稿",
    pending_review: "待审查",
    pending_approval: "待审批",
    active: "生效中",
    completed: "已完成",
    terminated: "已终止"
  };
  return map[status] || "未知";
};

const statusTheme = (status) => {
  const map = {
    draft: "primary",
    pending_review: "warning",
    pending_approval: "warning",
    active: "success",
    completed: "success",
    terminated: "danger",
    rejected: "danger",
    cancelled: "danger"
  };
  return map[status] || "warning";
};

const amountChangeStatusText = (status) => {
  const map = {
    pending_approval: "待审批",
    approved: "已审批",
    rejected: "已驳回",
    cancelled: "已取消"
  };
  return map[status] || statusText(status);
};

const paymentStatusText = (status) => {
  const map = {
    draft: "草稿",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已付款",
    rejected: "已拒绝",
    cancelled: "已废止"
  };
  return map[status] || "未知";
};

const receiptStatusText = (status) => {
  const map = {
    recorded: "已登记",
    reversed: "已冲销",
    deleted: "已删除"
  };
  return map[status] || "未知";
};

const directionText = (direction) => {
  return direction === "inbound" ? "收款合同" : "付款合同";
};

const formatAmount = (amount) => {
  const numeric = Number(amount || 0);
  return numeric.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

Page({
  data: {
    id: 0,
    loading: false,
    detail: null,
    userNameMap: {},
    projectNameMap: {}
  },

  async onLoad(options) {
    // 首次 onShow 必须加载；之后仅在显式标记时才重新拉取
    this.needsRefreshOnShow = true;
    const id = Number((options && options.id) || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    this.setData({ id });
  },

  async onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    // 附件预览（wx.openDocument / previewImage）返回同样触发 onShow：
    // 详情已在手时跳过整轮重复请求
    if (!this.needsRefreshOnShow && this.data.detail) return;
    this.needsRefreshOnShow = false;
    await Promise.all([this.loadUserMap(), this.loadProjectMap()]);
    await this.loadDetail();
  },

  async loadUserMap() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = res && res.data && Array.isArray(res.data.users) ? res.data.users : [];
      const userNameMap = {};
      users.forEach((item) => {
        if (item && item.userid && item.name) userNameMap[item.userid] = item.name;
      });
      this.setData({ userNameMap });
    } catch {
      this.setData({ userNameMap: {} });
    }
  },

  async loadProjectMap() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/project?page=1&pageSize=500" });
      const rows = Array.isArray(res.data) ? res.data : [];
      const projectNameMap = {};
      rows.forEach((item) => {
        const pid = Number(item.id || 0);
        if (!pid) return;
        projectNameMap[pid] = item.project_name || item.project_code || `项目#${pid}`;
      });
      this.setData({ projectNameMap });
    } catch {
      this.setData({ projectNameMap: {} });
    }
  },

  formatUserName(userid) {
    if (!userid) return "-";
    const name = this.data.userNameMap[userid];
    return name || "-";
  },

  formatProjectName(projectId) {
    const id = Number(projectId || 0);
    if (!id) return "-";
    return this.data.projectNameMap[id] || `项目#${id}`;
  },

  async loadDetail() {
    if (!this.data.id || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await request({ method: "GET", path: `/api/v1/contract/${this.data.id}` });
      const item = (res && res.data) || {};
      const detail = {
        id: item.id,
        contractNo: item.contract_no || "-",
        directionText: directionText(item.direction),
        statusText: statusText(item.status),
        statusTheme: statusTheme(item.status),
        isLegacy: Boolean(item.legacy_data_id),
        projectName: this.formatProjectName(item.project_id),
        applicant: this.formatUserName(item.handler_userid),
        contractDate: item.contract_date || "-",
        counterparty: item.counterparty || "-",
        contractType: contractTypeLabel(item.contract_type, "-"),
        totalAmountText: formatAmount(item.total_amount),
        paidAmountText: formatAmount(item.paid_amount),
        receivedAmountText: formatAmount(item.received_amount),
        remark: item.remark || "-",
        attachments: parseQueryAttachments(item.attachments_json),
        amountChanges: Array.isArray(item.amount_changes) ? item.amount_changes : [],
        paymentRequests: Array.isArray(item.payment_requests) ? item.payment_requests : []
      };
      detail.amountChanges = detail.amountChanges.map((row) => ({
        ...row,
        applicant_text: this.formatUserName(row.applicant_userid),
        change_type_text: amountChangeTypeLabel(row.change_type, "-"),
        status_text: amountChangeStatusText(row.status)
      }));
      detail.paymentRequests = detail.paymentRequests.map((row) => ({
        ...row,
        status_text: paymentStatusText(row.status)
      }));

      const receiptRes = await request({
        method: "GET",
        path: `/api/v1/receipt?contract_id=${this.data.id}&page=1&pageSize=20`
      }).catch(() => null);
      const receiptRows = receiptRes && Array.isArray(receiptRes.data) ? receiptRes.data : [];
      detail.receipts = receiptRows.map((row) => ({
        id: row.id,
        receiptNo: row.receipt_no || "-",
        amountText: formatAmount(row.amount),
        status_text: receiptStatusText(row.status),
        applicant_text: this.formatUserName(row.receiver_userid),
        receivedDate: row.received_date || "-"
      }));

      this.setData({ detail });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openPaymentDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/query-payment-detail/index?id=${id}` });
  },

  openReceiptDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/query-receipt-detail/index?id=${id}` });
  },

  openAttachment(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "query-contract-detail");
  }
});
