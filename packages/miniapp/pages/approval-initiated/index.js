const { request } = require("../../utils/request");
const { sayToast } = require("../../utils/interaction");

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "审批中（默认）" },
  { value: "pending", label: "待处理" },
  { value: "in_progress", label: "进行中" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "cancelled", label: "已取消" },
  { value: "withdrawn", label: "已撤回" },
  { value: "completed", label: "已完成" },
  { value: "transferred", label: "已转签" }
];

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "payment_request", label: "付款审批" },
  { value: "outbound_contract", label: "对外合同审批" },
  { value: "inbound_contract", label: "收款合同审批" },
  { value: "reimbursement_batch", label: "报销审批" }
];

Page({
  data: {
    loading: false,
    count: 0,
    totalCount: 0,
    list: [],
    allList: [],
    statusFilterOptions: STATUS_FILTER_OPTIONS,
    typeFilterOptions: TYPE_FILTER_OPTIONS,
    statusFilterIndex: 1,
    typeFilterIndex: 0
  },

  onShow() {
    this.loadList();
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
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  },

  mapListItem(item) {
    return {
      ...item,
      bizTypeLabel: this.bizTypeLabel(item.biz_type),
      cardClass: this.cardClassByType(item.biz_type),
      statusText: this.statusLabel(item.status),
      submittedAtText: this.formatBeijingTime(item.submitted_at)
    };
  },

  isActiveStatus(status) {
    return status === "pending" || status === "in_progress";
  },

  currentStatusFilterValue() {
    const selected = this.data.statusFilterOptions[this.data.statusFilterIndex] || STATUS_FILTER_OPTIONS[1];
    return selected.value;
  },

  currentTypeFilterValue() {
    const selected = this.data.typeFilterOptions[this.data.typeFilterIndex] || TYPE_FILTER_OPTIONS[0];
    return selected.value;
  },

  applyFilters() {
    const rows = Array.isArray(this.data.allList) ? this.data.allList : [];
    const statusFilter = this.currentStatusFilterValue();
    const typeFilter = this.currentTypeFilterValue();
    const filtered = rows.filter((item) => {
      const statusMatched =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? this.isActiveStatus(item.status)
            : item.status === statusFilter;
      const typeMatched = typeFilter === "all" ? true : item.biz_type === typeFilter;
      return statusMatched && typeMatched;
    });
    this.setData({
      list: filtered,
      count: filtered.length
    });
  },

  onStatusFilterChange(e) {
    const nextIndex = Number(e.detail.value || 0);
    this.setData({ statusFilterIndex: nextIndex });
    this.applyFilters();
  },

  onTypeFilterChange(e) {
    const nextIndex = Number(e.detail.value || 0);
    this.setData({ typeFilterIndex: nextIndex });
    this.applyFilters();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/approval?initiator=me&page=1&pageSize=50"
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      const mapped = rows.map((item) => this.mapListItem(item));
      this.setData({
        totalCount: mapped.length,
        allList: mapped
      });
      this.applyFilters();
    } catch (error) {
      this.setData({ count: 0, totalCount: 0, list: [], allList: [] });
      sayToast({ title: error.message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/approval-detail/index?id=${id}&readonly=1&from=initiated` });
  }
});
