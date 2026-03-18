const { request, buildUrl } = require("../../utils/request");
const { clearToken, getUserProfile, setUserProfile } = require("../../utils/auth");

const canLaunchPayment = (roles) => {
  const list = Array.isArray(roles) ? roles : [];
  return (
    list.includes("super_admin") ||
    list.includes("manager") ||
    list.includes("site_manager") ||
    list.includes("operator") ||
    list.includes("finance")
  );
};

Page({
  data: {
    profile: {},
    busy: false,
    timeline: [],
    certificates: [],
    profileRoleText: "-",
    profileAuthMethodText: "-"
  },

  normalizeStatusText(value) {
    const map = {
      pending: "待处理",
      in_progress: "进行中",
      approved: "已通过",
      rejected: "已驳回",
      completed: "已完成",
      draft: "草稿",
      submitted: "已提交"
    };
    return map[value] || "未知";
  },

  normalizeTimeline(profile) {
    const list = Array.isArray(profile && profile.timeline) ? profile.timeline : [];
    if (!list.length) return [];
    return list.map((item, index) => ({
      icon: item.icon || "📝",
      text: item.text || item.title || `动态${index + 1}`,
      status: this.normalizeStatusText(item.status || item.status_text || "-")
    }));
  },

  normalizeCertificates(profile) {
    const list = Array.isArray(profile && profile.certificates)
      ? profile.certificates
      : [];
    if (!list.length) return [];
    return list.map((item, index) => {
      const certName = item.name || item.certificate_name || `证书${index + 1}`;
      const rawUrl = item.file_url || item.fileUrl || "";
      const fileUrl = rawUrl ? buildUrl(rawUrl) : "";
      const statusText = item.status_text || item.statusText || "正常";
      return {
        id: item.id || `cert-${index + 1}`,
        name: certName,
        statusText,
        level: /过期|预警|到期/.test(statusText) ? "warn" : "ok",
        fileName: item.file_name || item.fileName || (rawUrl ? certName : "未上传附件"),
        fileUrl
      };
    });
  },

  roleText(roles) {
    const map = {
      super_admin: "超级管理员",
      manager: "经理",
      site_manager: "现场管理员",
      operator: "现场操作员",
      finance: "财务"
    };
    const list = Array.isArray(roles) ? roles : [];
    if (!list.length) return "-";
    return list.map((item) => map[item] || "未知角色").join("、");
  },

  authMethodText(value) {
    const map = {
      wecom_oauth: "企业微信登录",
      passkey: "Passkey",
      wecom: "企业微信登录"
    };
    return map[value] || "未知";
  },

  onShow() {
    this.reloadProfile();
  },

  async reloadProfile() {
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      const profile = res.data || getUserProfile() || {};
      const timeline = this.normalizeTimeline(profile);
      const certificates = this.normalizeCertificates(profile);
      setUserProfile(profile);
      this.setData({
        profile,
        timeline,
        certificates,
        profileRoleText: this.roleText(profile.roles),
        profileAuthMethodText: this.authMethodText(profile.auth_method)
      });
    } catch {
      const profile = getUserProfile() || {};
      this.setData({
        profile,
        timeline: this.normalizeTimeline(profile),
        certificates: this.normalizeCertificates(profile),
        profileRoleText: this.roleText(profile.roles),
        profileAuthMethodText: this.authMethodText(profile.auth_method)
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  openCertFile(e) {
    const { url } = e.currentTarget.dataset;
    if (!url) {
      wx.showToast({ title: "该证书暂无附件", icon: "none" });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const filePath = res.tempFilePath;
        if (!filePath) {
          wx.showToast({ title: "文件打开失败", icon: "none" });
          return;
        }
        wx.openDocument({
          filePath,
          showMenu: true,
          fail: () => wx.showToast({ title: "无法预览该文件", icon: "none" })
        });
      },
      fail: () => wx.showToast({ title: "文件下载失败", icon: "none" })
    });
  },

  downloadCertFile(e) {
    const { url, name } = e.currentTarget.dataset;
    if (!url) {
      wx.showToast({ title: "该证书暂无附件", icon: "none" });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const tempFilePath = res.tempFilePath;
        if (!tempFilePath) {
          wx.showToast({ title: "下载失败", icon: "none" });
          return;
        }
        wx.saveFile({
          tempFilePath,
          success: () => {
            wx.showToast({
              title: `${name || "证书文件"}已保存`,
              icon: "success"
            });
          },
          fail: () => {
            wx.showToast({ title: "保存失败，请检查权限", icon: "none" });
          }
        });
      },
      fail: () => wx.showToast({ title: "文件下载失败", icon: "none" })
    });
  },

  logout() {
    wx.showModal({
      title: "确认退出",
      content: "退出后需要重新登录，是否继续？",
      success: (res) => {
        if (!res.confirm) return;
        clearToken();
        wx.showToast({ title: "已退出", icon: "success" });
      }
    });
  },

  goToReimbursement() {
    wx.navigateTo({ url: "/pages/reimbursement-list/index" });
  },

  goToPaymentApply() {
    const roles = (this.data.profile && this.data.profile.roles) || [];
    if (!canLaunchPayment(roles)) {
      wx.showToast({ title: "当前角色无对外付款权限", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/payment-apply/index" });
  },

  goToFuelApply() {
    wx.navigateTo({ url: "/pages/fuel-apply/index" });
  },

  bizTypeLabel(value) {
    const map = {
      outbound_contract: "对外合同审批",
      inbound_contract: "收款合同审批",
      payment_request: "付款审批",
      reimbursement_batch: "报销审批",
      stock_order: "出库审批",
      invoice_request: "发票审批"
    };
    return map[value] || "审批";
  },

  async urgeApprovalFlow() {
    if (this.data.busy) return;
    wx.showLoading({ title: "提交中...", mask: true });
    this.setData({ busy: true });
    try {
      const listRes = await request({
        method: "GET",
        path: "/api/v1/approval/remindable?page=1&pageSize=100"
      });
      const instances = Array.isArray(listRes.data) ? listRes.data : [];
      if (!instances.length) {
        wx.hideLoading();
        wx.showToast({ title: "暂无可催办审批", icon: "none" });
        return;
      }
      wx.hideLoading();

      const instanceLabels = instances.map((item) => {
        const typeLabel = this.bizTypeLabel(item.biz_type);
        const count = Array.isArray(item.pending_tasks) ? item.pending_tasks.length : 0;
        return `${item.instance_no}｜${typeLabel}｜待处理${count}人`;
      });

      const instancePick = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: instanceLabels,
          success: resolve,
          fail: reject
        });
      }).catch(() => null);
      if (!instancePick || typeof instancePick.tapIndex !== "number") return;

      const selectedInstance = instances[instancePick.tapIndex];
      const tasks = Array.isArray(selectedInstance.pending_tasks) ? selectedInstance.pending_tasks : [];
      if (!tasks.length) {
        wx.hideLoading();
        wx.showToast({ title: "该审批暂无待催办人", icon: "none" });
        return;
      }

      const assigneeLabels = tasks.map((task) => `${task.assignee_userid}（待审批）`);
      const taskPick = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: assigneeLabels,
          success: resolve,
          fail: reject
        });
      }).catch(() => null);
      if (!taskPick || typeof taskPick.tapIndex !== "number") return;

      const targetTask = tasks[taskPick.tapIndex];
      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: "确认催办",
          content: `将向 ${targetTask.assignee_userid} 发送二次企业微信催办消息，是否继续？`,
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false)
        });
      });
      if (!confirmed) return;

      wx.showLoading({ title: "提交中...", mask: true });
      await request({
        method: "POST",
        path: `/api/v1/approval/${Number(selectedInstance.id)}/urge`,
        data: {
          task_id: Number(targetTask.task_id),
          reason: "申请人发起催办"
        }
      });
      wx.hideLoading();
      wx.showToast({ title: "催办已发送", icon: "success" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "催办失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: [
        "🎤 催办我的申请",
        "🎤 打开我的报销提交",
        "🎤 打开智能发单台",
        "🎤 打开油卡额度申请",
        "🎤 打开审批待办"
      ],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await this.urgeApprovalFlow();
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/reimbursement-list/index" });
          return;
        }
        if (res.tapIndex === 2) {
          this.goToPaymentApply();
          return;
        }
        if (res.tapIndex === 3) {
          wx.navigateTo({ url: "/pages/fuel-apply/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/approval/index" });
      }
    });
  }
});
