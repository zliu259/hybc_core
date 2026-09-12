const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { refundModeLabel } = require("../../utils/enum-labels");

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const statusText = (status) => {
  const map = {
    recorded: "已登记",
    reversed: "已冲销",
    deleted: "已删除"
  };
  return map[status] || "未知";
};

const statusTheme = (status) => {
  const map = {
    recorded: "success",
    reversed: "warning",
    deleted: "danger"
  };
  return map[status] || "warning";
};

const refundStatusText = (status) => {
  const map = {
    draft: "草稿",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已退款",
    rejected: "已拒绝",
    cancelled: "已取消"
  };
  return map[status] || statusText(status);
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

  onLoad(options) {
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
      const res = await request({ method: "GET", path: `/api/v1/receipt/${this.data.id}` });
      const payload = (res && res.data) || {};
      const receipt = payload.receipt || {};
      const contract = payload.contract || {};
      const invoice = payload.invoice || null;
      const refunds = Array.isArray(payload.refunds) ? payload.refunds : [];

      const detail = {
        id: receipt.id,
        receiptNo: receipt.receipt_no || "-",
        statusText: statusText(receipt.status),
        statusTheme: statusTheme(receipt.status),
        applicant: this.formatUserName(receipt.receiver_userid),
        projectName: this.formatProjectName(receipt.project_id),
        receivedDate: receipt.received_date || "-",
        amountText: formatAmount(receipt.amount),
        paymentAccount: receipt.payment_account || "-",
        contractNo: contract.contract_no || "-",
        counterparty: contract.counterparty || "-",
        invoiceNo: (invoice && invoice.invoice_no) || "-",
        remark: receipt.remark || "-",
        createdAt: receipt.created_at || "-",
        updatedAt: receipt.updated_at || "-",
        refunds: refunds.map((row) => ({
          ...row,
          applicant_text: this.formatUserName(row.applicant_userid),
          refund_mode_text: refundModeLabel(row.refund_mode, "-"),
          status_text: refundStatusText(row.status)
        }))
      };
      this.setData({ detail });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
