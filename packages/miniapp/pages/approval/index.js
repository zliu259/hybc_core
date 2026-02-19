const { request } = require("../../utils/request");

Page({
  data: {
    pending: [],
    commentMap: {},
    loading: false,
    acting: false
  },

  onShow() {
    this.loadPending();
  },

  async loadPending() {
    this.setData({ loading: true });
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/approval/pending?page=1&pageSize=50"
      });
      this.setData({ pending: res.data || [] });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onComment(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`commentMap.${id}`]: e.detail.value });
  },

  async handleAction(e) {
    if (this.data.acting) return;
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const comment = this.data.commentMap[id] || "";
    const actionName =
      action === "approve"
        ? "通过"
        : action === "reject"
          ? "拒绝"
          : action === "return"
            ? "退回"
            : "转签";

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: `确认${actionName}`,
        content: `${actionName}后将立即生效，是否继续？`,
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirm) return;

    this.setData({ acting: true });
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
      await this.loadPending();
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    } finally {
      this.setData({ acting: false });
    }
  }
});
