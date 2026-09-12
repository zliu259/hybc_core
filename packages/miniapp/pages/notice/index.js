const { request } = require("../../utils/request");
const { bizTypeLabel, humanizeBizSummary } = require("../../utils/enum-labels");

Page({
  data: {
    notices: [],
    loading: false
  },

  onShow() {
    this.loadNotices();
  },

  async loadNotices() {
    this.setData({ loading: true });
    try {
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const notices = (pending.data || []).map((item) => ({
        id: item.id,
        title: `审批待办 ${item.instance_no}`,
        content: humanizeBizSummary(item.biz_summary) || bizTypeLabel(item.biz_type)
      }));
      this.setData({ notices });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
