/** 车辆保养记录详情：提交人看自己的记录（后端只允许本人和管理角色查看）。 */
const { request } = require("../../utils/request");
const { openQueryAttachment } = require("../../utils/attachment-open");
const { buildMaintenanceDetail, buildTypeMap } = require("../common/vehicle-records-view");

/** 类型字典取不到时显示原值，不挡详情 */
const loadTypeMap = () =>
  request({ method: "GET", path: "/api/v1/dict?dict_type=vehicle_maintenance_type" })
    .then((res) => buildTypeMap(res && res.data))
    .catch(() => ({}));

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
      this.setData({ detailState: "error", detailErrorText: "缺少记录编号" });
      return;
    }
    this.setData({ id });
    this.loadDetail();
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
      const [res, typeMap] = await Promise.all([
        request({ method: "GET", path: `/api/v1/fleet/maintenance/${this.data.id}` }),
        loadTypeMap()
      ]);
      if (seq !== this.loadSeq) return;
      if (!res || !res.data) throw new Error("记录不存在");
      this.setData({
        detail: buildMaintenanceDetail(res.data, typeMap),
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

  openAttachment(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "maintenance-record-detail");
  }
});
