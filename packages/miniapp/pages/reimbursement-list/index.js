const { request } = require("../../utils/request");

const statusText = (status) => {
  const map = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已填报",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已拒绝"
  };
  return map[status] || status || "未知";
};

const channelText = (channel) => {
  if (channel === "electronic") return "电子发票";
  return "实物信封";
};

const formatAmount = (amount) => {
  const numeric = Number(amount || 0);
  return numeric.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatTime = (value) => {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
};

Page({
  data: {
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    keyword: "",
    status: "",
    statusOptions: [
      { label: "全部状态", value: "" },
      { label: "草稿", value: "draft" },
      { label: "已填报", value: "submitted" },
      { label: "已收件", value: "received" },
      { label: "待审批", value: "pending_approval" },
      { label: "已审批", value: "approved" },
      { label: "已打款", value: "paid" },
      { label: "已拒绝", value: "rejected" }
    ],
    statusIndex: 0,
    summary: {
      draft: 0,
      processing: 0,
      done: 0
    },
    list: []
  },

  onShow() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
  },

  onStatusChange(e) {
    const statusIndex = Number(e.detail.value || 0);
    const selected = this.data.statusOptions[statusIndex] || this.data.statusOptions[0];
    this.setData({ statusIndex, status: selected.value, page: 1 }, () => this.loadList());
  },

  search() {
    this.setData({ page: 1 }, () => this.loadList());
  },

  async loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const { page, pageSize, status, keyword } = this.data;
      const query = [
        `page=${page}`,
        `pageSize=${pageSize}`,
        "creator_id=me"
      ];
      if (status) query.push(`status=${encodeURIComponent(status)}`);
      if (keyword) query.push(`keyword=${encodeURIComponent(keyword)}`);
      const res = await request({
        method: "GET",
        path: `/api/v1/reimbursement?${query.join("&")}`
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      const mapped = rows.map((item) => ({
        id: item.id,
        envelope_no: item.envelope_no,
        envelope_uuid: item.envelope_uuid,
        amountText: formatAmount(item.amount),
        status: item.status,
        statusLabel: statusText(item.status),
        channelLabel: channelText(item.channel),
        updatedAtText: formatTime(item.updated_at),
        canSubmit: item.status === "draft"
      }));

      const summary = mapped.reduce(
        (acc, item) => {
          if (item.status === "draft") acc.draft += 1;
          else if (["paid", "approved", "rejected"].includes(item.status)) acc.done += 1;
          else acc.processing += 1;
          return acc;
        },
        { draft: 0, processing: 0, done: 0 }
      );

      this.setData({
        list: mapped,
        summary,
        total: (res.pagination && res.pagination.total) || mapped.length
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
      this.setData({ list: [], total: 0 });
    } finally {
      this.setData({ loading: false });
    }
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/reimbursement/index?mode=create" });
  },

  goDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/reimbursement/index?id=${id}` });
  },

  async submitFromList(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    try {
      await request({ method: "POST", path: `/api/v1/reimbursement/${id}/submit` });
      wx.showToast({ title: "已提交报销", icon: "success" });
      this.loadList();
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    }
  }
});
