const { request } = require("../../utils/request");

Page({
  data: {
    notices: []
  },

  onShow() {
    this.loadNotices();
  },

  async loadNotices() {
    try {
      const pending = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=20"
      });
      const notices = (pending.data || []).map((item) => ({
        id: item.id,
        title: `审批待办 ${item.instance_no}`,
        content: item.biz_summary || item.biz_type
      }));
      this.setData({ notices });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  }
});
