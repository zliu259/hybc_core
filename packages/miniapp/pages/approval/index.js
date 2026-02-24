const { request } = require("../../utils/request");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");

Page({
  data: {
    pending: [],
    commentMap: {},
    loading: false,
    acting: false,
    sliderReadyMap: {},
    transferUsers: []
  },

  onShow() {
    this.loadTransferUsers();
    this.loadPending();
  },

  async loadTransferUsers() {
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/auth/wecom/contacts"
      });
      const users = (((res || {}).data || {}).users || []).filter((item) => item && item.userid);
      this.setData({ transferUsers: users.slice(0, 20) });
    } catch {
      this.setData({ transferUsers: [] });
    }
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
      sayToast({ title: error.message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  markSliderReady(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`sliderReadyMap.${id}`]: true });
  },

  clearSliderReady(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`sliderReadyMap.${id}`]: false });
  },

  handleApproveUnlock(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.sliderReadyMap[id]) {
      sayToast({ title: "请长按后再滑动确认", icon: "none" });
      return;
    }
    this.handleAction({ currentTarget: { dataset: { id, action: "approve" } } });
    this.setData({ [`sliderReadyMap.${id}`]: false });
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
        if (!this.data.transferUsers.length) {
          throw new Error("暂无可转签成员，请先同步企业微信通讯录");
        }
        const pickIndex = await new Promise((resolve, reject) => {
          wx.showActionSheet({
            itemList: this.data.transferUsers.map((item) => `${item.name} (${item.userid})`),
            success: (res) => resolve(Number(res.tapIndex)),
            fail: () => reject(new Error("已取消转签"))
          });
        });
        const selected = this.data.transferUsers[pickIndex];
        if (!selected || !selected.userid) {
          throw new Error("未选择有效转签对象");
        }
        await request({
          method: "POST",
          path: `/api/v1/approval/${id}/transfer`,
          data: { to_userid: selected.userid, reason: comment || "miniapp transfer" }
        });
      }
      vibrateSuccess();
      sayToast({ title: "已处理", icon: "success" });
      await this.loadPending();
    } catch (error) {
      vibrateWarning();
      sayToast({ title: error.message || "操作失败", icon: "none", danger: true });
    } finally {
      this.setData({ acting: false });
    }
  }
});
