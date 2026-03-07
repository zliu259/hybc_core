const { request, buildUrl } = require("../../utils/request");
const { clearToken, getUserProfile, setUserProfile } = require("../../utils/auth");
const { runVoiceAssistant } = require("../../utils/voice-assistant");

Page({
  data: {
    profile: {},
    busy: false,
    timeline: [
      { icon: "💸", text: "付款申请 #P20260224-01", status: "👨‍💼 王总审批中" },
      { icon: "🧾", text: "报销信封 #R20260223-03", status: "⏳ 排队中" },
      { icon: "📝", text: "合同申请 #C20260222-02", status: "🟢 已通过" }
    ],
    certificates: [
      {
        id: "cert-1",
        name: "特种作业证",
        statusText: "7天后到期",
        level: "warn",
        fileName: "未上传附件",
        fileUrl: ""
      },
      {
        id: "cert-2",
        name: "安全员证",
        statusText: "正常",
        level: "ok",
        fileName: "未上传附件",
        fileUrl: ""
      }
    ]
  },

  normalizeCertificates(profile) {
    const list = Array.isArray(profile && profile.certificates)
      ? profile.certificates
      : [];
    if (!list.length) return null;
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

  onShow() {
    this.reloadProfile();
  },

  async reloadProfile() {
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/user/me" });
      const profile = res.data || getUserProfile() || {};
      const certificates = this.normalizeCertificates(profile);
      setUserProfile(profile);
      this.setData({
        profile,
        certificates: certificates || this.data.certificates
      });
    } catch {
      this.setData({ profile: getUserProfile() || {} });
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

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "🎤 催办我的申请", "🎤 打开我的报销提交", "🎤 打开审批待办"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "profile" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          wx.showToast({ title: "已推送催办卡片", icon: "success" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/reimbursement-list/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/approval/index" });
      }
    });
  }
});
