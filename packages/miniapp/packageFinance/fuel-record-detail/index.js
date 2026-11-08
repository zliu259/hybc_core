/** 油卡申请详情：申请人看自己的单子（后端只允许本人和车队管理角色查看）。 */
const { request } = require("../../utils/request");
const { openQueryAttachment } = require("../../utils/attachment-open");
const { loadUserNameMap } = require("../../utils/user-names");
const { buildFuelDetail } = require("../common/vehicle-records-view");

Page({
  data: {
    id: 0,
    detailState: "loading",
    detailErrorText: "",
    detail: null
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (!Number.isInteger(id) || id <= 0) {
      this.setData({ detailState: "error", detailErrorText: "缺少申请编号" });
      return;
    }
    this.setData({ id });
  },

  // 去补充资料回来后状态会变，每次显示都重新取
  onShow() {
    if (this.data.id) this.loadDetail();
  },

  onPullDownRefresh() {
    const done = this.data.id ? this.loadDetail() : Promise.resolve();
    done.finally(() => wx.stopPullDownRefresh());
  },

  async loadDetail() {
    const seq = (this.loadSeq || 0) + 1;
    this.loadSeq = seq;
    if (!this.data.detail) this.setData({ detailState: "loading" });
    try {
      const [res, userNames] = await Promise.all([
        request({ method: "GET", path: `/api/v1/fleet/fuel-applications/${this.data.id}` }),
        loadUserNameMap()
      ]);
      if (seq !== this.loadSeq) return;
      if (!res || !res.data) throw new Error("申请不存在");
      this.setData({
        detail: buildFuelDetail(res.data, userNames),
        detailState: "ready",
        detailErrorText: ""
      });
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.setData({
        detail: null,
        detailState: "error",
        detailErrorText: (error && error.message) || "加载失败"
      });
    }
  },

  openPhoto(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "fuel-record-detail");
  },

  goResubmit() {
    if (!this.data.detail || !this.data.detail.canResubmit) return;
    wx.navigateTo({ url: `/packageFinance/fuel-apply/index?resubmit=${this.data.id}` });
  }
});
