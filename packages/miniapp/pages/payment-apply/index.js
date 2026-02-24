const { request } = require("../../utils/request");
const { firstError, required, positiveNumber } = require("../../utils/validation");
const { getUserProfile } = require("../../utils/auth");

const today = () => new Date().toISOString().slice(0, 10);

Page({
  data: {
    busy: false,
    form: {
      contract_id: "",
      project_id: "",
      payee_id: "",
      expected_payment_date: today(),
      category: "工程款",
      payment_method: "bank_transfer",
      amount: "",
      content: "",
      remark: ""
    }
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const allowed = roles.includes("super_admin") || roles.includes("manager") || roles.includes("site_manager");
    if (!allowed) {
      wx.showToast({ title: "当前角色无对外付款权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 400);
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value || "" });
  },

  onDateChange(e) {
    this.setData({ "form.expected_payment_date": e.detail.value });
  },

  validate() {
    const form = this.data.form;
    return firstError([
      positiveNumber(form.contract_id, "关联合同ID"),
      positiveNumber(form.project_id, "项目ID"),
      positiveNumber(form.payee_id, "收款方ID"),
      required(form.expected_payment_date, "预计付款日期"),
      required(form.category, "付款类别"),
      required(form.payment_method, "付款方式"),
      positiveNumber(form.amount, "付款金额"),
      required(form.content, "付款内容")
    ]);
  },

  async createDraft() {
    const form = this.data.form;
    const res = await request({
      method: "POST",
      path: "/api/v1/payment",
      data: {
        contract_id: Number(form.contract_id),
        project_id: Number(form.project_id),
        payee_id: Number(form.payee_id),
        expected_payment_date: form.expected_payment_date,
        category: form.category,
        amount: Number(form.amount),
        content: form.content,
        payment_method: form.payment_method,
        attachments_json: null,
        remark: form.remark || undefined
      }
    });
    return res?.data?.id ? Number(res.data.id) : 0;
  },

  async submitDraft() {
    const errorText = this.validate();
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }
    if (this.data.busy) return;

    this.setData({ busy: true });
    try {
      const id = await this.createDraft();
      wx.showToast({ title: id ? "草稿已创建" : "创建成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async submitAndApproval() {
    const errorText = this.validate();
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }
    if (this.data.busy) return;

    this.setData({ busy: true });
    try {
      const id = await this.createDraft();
      if (!id) {
        throw new Error("付款单创建失败");
      }
      await request({
        method: "POST",
        path: `/api/v1/payment/${id}/submit-approval`,
        data: {}
      });
      wx.showToast({ title: "已提交审批", icon: "success" });
      setTimeout(() => {
        wx.navigateTo({ url: "/pages/approval/index" });
      }, 400);
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  }
});
