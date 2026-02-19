const { request } = require("../../utils/request");

Page({
  data: {
    pending: [],
    commentMap: {}
  },

  onShow() {
    this.loadPending();
  },

  async loadPending() {
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=50"
      });
      this.setData({ pending: res.data || [] });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onComment(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`commentMap.${id}`]: e.detail.value });
  },

  async handleAction(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const comment = this.data.commentMap[id] || "";
    try {
      if (action === "approve") {
        await request({ method: "POST", path: `/api/v1/approval/${id}/approve`, data: { comment } });
      } else if (action === "reject") {
        await request({ method: "POST", path: `/api/v1/approval/${id}/reject`, data: { comment } });
      } else if (action === "return") {
        await request({ method: "POST", path: `/api/v1/approval/${id}/return`, data: { type: "initiator", comment } });
      } else {
        await request({
          method: "POST",
          path: `/api/v1/approval/${id}/transfer`,
          data: { to_userid: "operator", reason: comment || "miniapp transfer" }
        });
      }
      wx.showToast({ title: "已处理", icon: "success" });
      this.loadPending();
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    }
  }
});
