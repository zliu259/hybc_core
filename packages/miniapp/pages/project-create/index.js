const { request } = require("../../utils/request");
const { firstError, required } = require("../../utils/validation");
const { getUserProfile } = require("../../utils/auth");

const today = () => new Date().toISOString().slice(0, 10);

Page({
  data: {
    form: {
      project_code: "",
      project_name: "",
      manager_userid: "",
      start_date: today(),
      end_date: ""
    },
    busy: false
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const allowed = roles.includes("super_admin") || roles.includes("manager") || roles.includes("site_manager");
    if (!allowed) {
      wx.showToast({ title: "当前角色无项目立项权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 400);
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value || "" });
  },

  onDateChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value || "" });
  },

  fillTodayCode() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    this.setData({
      "form.project_code": `PRJ-${y}${m}${day}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`
    });
  },

  async submit() {
    if (this.data.busy) return;
    const errorText = firstError([
      required(this.data.form.project_code, "项目编号"),
      required(this.data.form.project_name, "项目名称")
    ]);
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    this.setData({ busy: true });
    try {
      const form = this.data.form;
      const res = await request({
        method: "POST",
        path: "/api/v1/project",
        data: {
          project_code: form.project_code.trim(),
          project_name: form.project_name.trim(),
          manager_userid: form.manager_userid.trim() || undefined,
          status: "planning",
          start_date: form.start_date || undefined,
          end_date: form.end_date || undefined
        }
      });

      wx.showToast({ title: "立项成功", icon: "success" });
      setTimeout(() => {
        wx.navigateTo({
          url: `/pages/project-detail/index?id=${res.data.id}&readonly=0`
        });
      }, 400);
    } catch (error) {
      wx.showToast({ title: error.message || "立项失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  }
});
