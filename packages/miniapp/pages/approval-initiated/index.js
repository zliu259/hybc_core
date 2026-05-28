const { request } = require("../../utils/request");
const { sayToast } = require("../../utils/interaction");

const INITIATED_BUCKET_OPTIONS = [
  { value: "returned_needs_action", label: "被退回（待处理）" },
  { value: "in_progress", label: "审批中" },
  { value: "done", label: "已完成" }
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
    summary: {
      total: 0,
      returned_needs_action: 0,
      in_progress: 0,
      done: 0
    },
    list: [],
    bucketFilterOptions: INITIATED_BUCKET_OPTIONS,
    typeFilterOptions: TYPE_FILTER_OPTIONS,
    bucketFilterIndex: 0,
    typeFilterIndex: 0
  },

  onShow() {
    this.reloadAll();
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
      transferred: "已转签",
      returned: "已退回"
    };
    return map[status] || "未知";
  },

  initiatedBucketLabel(bucket) {
    const map = {
      returned_needs_action: "被退回（待处理）",
      in_progress: "审批中",
      done: "已完成"
    };
    return map[bucket] || "审批中";
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
    const bizSummary = item.biz_summary || "-";
    const bizDetail = item.biz_detail || "";
    const shouldAppendBizDetail = item.biz_type === "payment_request" || bizSummary.startsWith("智能发单台-");
    const displaySummary = bizDetail && shouldAppendBizDetail
      ? `${bizSummary}｜${bizDetail}`
      : bizSummary;
    return {
      ...item,
      displaySummary,
      bizDetail,
      bizTypeLabel: this.bizTypeLabel(item.biz_type),
      cardClass: this.cardClassByType(item.biz_type),
      initiatedBucketText: this.initiatedBucketLabel(item.initiated_bucket),
      statusText: this.statusLabel(item.status),
      submittedAtText: this.formatBeijingTime(item.submitted_at),
      updatedAtText: this.formatBeijingTime(item.last_updated_at || item.updated_at)
    };
  },

  currentBucketFilterValue() {
    const selected = this.data.bucketFilterOptions[this.data.bucketFilterIndex] || INITIATED_BUCKET_OPTIONS[0];
    return selected.value;
  },

  currentTypeFilterValue() {
    const selected = this.data.typeFilterOptions[this.data.typeFilterIndex] || TYPE_FILTER_OPTIONS[0];
    return selected.value;
  },

  async loadSummary() {
    const res = await request({
      method: "GET",
      path: "/api/v1/approval/initiated/summary?initiator=me"
    });
    this.setData({
      summary: {
        total: Number(res.data?.total || 0),
        returned_needs_action: Number(res.data?.returned_needs_action || 0),
        in_progress: Number(res.data?.in_progress || 0),
        done: Number(res.data?.done || 0)
      }
    });
  },

  onTypeFilterChange(e) {
    const nextIndex = Number(e.detail.value || 0);
    this.setData({ typeFilterIndex: nextIndex });
    this.loadList();
  },

  onBucketFilterChange(e) {
    const nextIndex = Number(e.currentTarget.dataset.index || 0);
    if (nextIndex === this.data.bucketFilterIndex) return;
    this.setData({ bucketFilterIndex: nextIndex });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const initiatedBucket = this.currentBucketFilterValue();
      const bizType = this.currentTypeFilterValue();
      const query = [
        `initiator=me`,
        `initiatedBucket=${encodeURIComponent(initiatedBucket)}`,
        "page=1",
        "pageSize=50"
      ];
      if (bizType !== "all") {
        query.push(`biz_type=${encodeURIComponent(bizType)}`);
      }

      const res = await request({
        method: "GET",
        path: `/api/v1/approval?${query.join("&")}`
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      const mapped = rows.map((item) => this.mapListItem(item));
      this.setData({
        list: mapped,
        count: mapped.length
      });
    } catch (error) {
      this.setData({ count: 0, list: [] });
      sayToast({ title: error.message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async reloadAll() {
    this.setData({ loading: true });
    try {
      await this.loadSummary();
      await this.loadList();
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
