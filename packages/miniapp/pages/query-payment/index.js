const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const statusText = (status) => {
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

const statusTheme = (status) => {
  const map = {
    draft: "primary",
    pending_approval: "warning",
    approved: "success",
    paid: "success",
    rejected: "danger",
    cancelled: "danger"
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
    projectNameMap: {},
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
    await Promise.all([this.loadApplicantOptions(), this.loadProjectData()]);
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

  async loadProjectData() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/project?page=1&pageSize=500" });
      const rows = Array.isArray(res.data) ? res.data : [];
      const projectNameMap = {};
      const projectOptions = [{ label: "全部项目", value: "" }];
      rows.forEach((item) => {
        const id = Number(item.id || 0);
        if (!id) return;
        const label = item.project_name || item.project_code || `项目#${id}`;
        projectNameMap[id] = label;
        if (label) projectOptions.push({ label, value: String(id) });
      });
      this.setData({ projectNameMap, projectOptions });
    } catch {
      this.setData({ projectNameMap: {}, projectOptions: [{ label: "全部项目", value: "" }] });
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

  onApplicantChange(e) {
    const idx = Number(e.detail.value || 0);
    const selected = this.data.applicantOptions[idx] || this.data.applicantOptions[0];
    this.setData({ applicantIndex: idx, applicantUserid: selected.value || "" });
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

      const res = await request({ method: "GET", path: `/api/v1/payment?${query.join("&")}` });
      const rows = Array.isArray(res.data) ? res.data : [];
      const list = rows.map((item) => ({
        id: item.id,
        serialNo: item.serial_no,
        amountText: formatAmount(item.amount),
        applicant: this.formatUserName(item.applicant_userid),
        projectName: this.formatProjectName(item.project_id),
        expectDate: item.expected_payment_date || "-",
        content: item.content || "-",
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
    wx.navigateTo({ url: `/pages/query-payment-detail/index?id=${id}` });
  }
});
