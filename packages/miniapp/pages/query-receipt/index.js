const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

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

const formatAmount = (amount) => {
  const numeric = Number(amount || 0);
  return numeric.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

Page({
  data: {
    loading: false,
    page: 1,
    pageSize: 10,
    total: 0,
    hasNext: false,
    applicantUserid: "",
    applicantIndex: 0,
    applicantOptions: [{ label: "全部申请人", value: "" }],
    projectIndex: 0,
    projectOptions: [{ label: "全部项目", value: "" }],
    userNameMap: {},
    projectId: "",
    dateFrom: "",
    dateTo: "",
    list: []
  },

  async onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    await Promise.all([this.loadApplicantOptions(), this.loadProjectOptions()]);
    await this.loadList();
  },

  async loadApplicantOptions() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = res && res.data && Array.isArray(res.data.users) ? res.data.users : [];
      const userNameMap = {};
      users.forEach((item) => {
        if (item && item.userid) userNameMap[item.userid] = item.name || item.userid;
      });
      const options = [{ label: "全部申请人", value: "" }].concat(
        users
          .filter((item) => item && item.userid)
          .map((item) => ({
            label: item.name || item.userid,
            value: item.userid
          }))
      );
      this.setData({ applicantOptions: options, userNameMap });
    } catch {
      this.setData({ applicantOptions: [{ label: "全部申请人", value: "" }], userNameMap: {} });
    }
  },

  formatUserName(userid) {
    if (!userid) return "-";
    const name = this.data.userNameMap[userid];
    return name || "-";
  },

  onApplicantChange(e) {
    const idx = Number(e.detail.value || 0);
    const selected = this.data.applicantOptions[idx] || this.data.applicantOptions[0];
    this.setData({ applicantIndex: idx, applicantUserid: selected.value || "" });
  },

  async loadProjectOptions() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/project?page=1&pageSize=500" });
      const rows = Array.isArray(res.data) ? res.data : [];
      const options = [{ label: "全部项目", value: "" }].concat(
        rows
          .map((item) => {
            const id = Number(item.id || 0);
            if (!id) return null;
            const label = item.project_name || item.project_code || `项目#${id}`;
            return { label, value: String(id) };
          })
          .filter(Boolean)
      );
      this.setData({ projectOptions: options });
    } catch {
      this.setData({ projectOptions: [{ label: "全部项目", value: "" }] });
    }
  },

  onProjectChange(e) {
    const idx = Number(e.detail.value || 0);
    const selected = this.data.projectOptions[idx] || this.data.projectOptions[0];
    this.setData({ projectIndex: idx, projectId: selected.value || "" });
  },

  onDateFromChange(e) {
    this.setData({ dateFrom: e.detail.value || "" });
  },

  onDateToChange(e) {
    this.setData({ dateTo: e.detail.value || "" });
  },

  search() {
    this.setData({ page: 1 }, () => this.loadList());
  },

  resetFilters() {
    this.setData(
      {
        page: 1,
        applicantUserid: "",
        applicantIndex: 0,
        projectId: "",
        projectIndex: 0,
        dateFrom: "",
        dateTo: ""
      },
      () => this.loadList()
    );
  },

  prevPage() {
    if (this.data.loading || this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 }, () => this.loadList());
  },

  nextPage() {
    if (this.data.loading || !this.data.hasNext) return;
    this.setData({ page: this.data.page + 1 }, () => this.loadList());
  },

  async loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const { page, pageSize, applicantUserid, projectId, dateFrom, dateTo } = this.data;
      const query = [`page=${page}`, `pageSize=${pageSize}`];
      if (applicantUserid) query.push(`applicant_userid=${encodeURIComponent(applicantUserid)}`);
      if (projectId) query.push(`project_id=${encodeURIComponent(projectId)}`);
      if (dateFrom) query.push(`date_from=${encodeURIComponent(dateFrom)}`);
      if (dateTo) query.push(`date_to=${encodeURIComponent(dateTo)}`);

      const res = await request({ method: "GET", path: `/api/v1/receipt?${query.join("&")}` });
      const rows = Array.isArray(res.data) ? res.data : [];
      const list = rows.map((item) => ({
        id: item.id,
        receiptNo: item.receipt_no,
        amountText: formatAmount(item.amount),
        applicant: this.formatUserName(item.receiver_userid),
        receivedDate: item.received_date || "-",
        paymentAccount: item.payment_account || "-",
        statusText: statusText(item.status),
        statusTheme: statusTheme(item.status)
      }));

      this.setData({
        list,
        total: (res.pagination && res.pagination.total) || list.length,
        hasNext: page * pageSize < ((res.pagination && res.pagination.total) || list.length)
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
      this.setData({ list: [], total: 0, hasNext: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/query-receipt-detail/index?id=${id}` });
  }
});
