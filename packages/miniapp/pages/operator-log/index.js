const { request } = require("../../utils/request");
const { required, positiveNumber, ymdDate, firstError } = require("../../utils/validation");

const today = () => new Date().toISOString().slice(0, 10);
const SHIFT_OPTIONS = [
  { label: "白班", value: "day" },
  { label: "夜班", value: "night" }
];

Page({
  data: {
    form: {
      project_id: "",
      log_date: today(),
      shift: "day",
      completed_pipe_count: "0",
      weather: "",
      issue_summary: ""
    },
    projectId: 0,
    shiftOptions: SHIFT_OPTIONS.map((item) => item.label),
    shiftIndex: 0,
    busy: false
  },

  runBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  onProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    if (!projectId) return;
    this.setData({
      projectId,
      "form.project_id": String(projectId)
    });
  },

  onDateChange(e) {
    this.setData({ "form.log_date": e.detail.value });
  },

  onShiftChange(e) {
    const index = Number(e.detail.value || 0);
    const shift = SHIFT_OPTIONS[index] || SHIFT_OPTIONS[0];
    this.setData({
      shiftIndex: index,
      "form.shift": shift.value
    });
  },

  async smartFill() {
    const form = this.data.form;
    const errorText = firstError([
      required(form.project_id, "项目"),
      ymdDate(form.log_date, "日期")
    ]);
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    return this.runBusy(async () => {
      const res = await request({
        method: "POST",
        path: "/api/v1/log/operator/smart-fill",
        data: {
          project_id: Number(form.project_id),
          log_date: form.log_date,
          shift: form.shift,
          completed_pipe_count: Number(form.completed_pipe_count || 0)
        }
      });
      this.setData({
        "form.weather": (((res || {}).data || {}).prefill || {}).weather || "",
        "form.issue_summary": (((res || {}).data || {}).prefill || {}).issue_summary || ""
      });
      wx.showToast({ title: "AI预填完成", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "预填失败", icon: "none" }));
  },

  async submit() {
    const form = this.data.form;
    const errorText = firstError([
      required(form.project_id, "项目"),
      ymdDate(form.log_date, "日期"),
      required(form.shift, "班次"),
      positiveNumber(form.completed_pipe_count, "本班下管数")
    ]);
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    return this.runBusy(async () => {
      await request({
        method: "POST",
        path: "/api/v1/log/operator",
        data: {
          project_id: Number(form.project_id),
          log_date: form.log_date,
          shift: form.shift,
          completed_pipe_count: Number(form.completed_pipe_count || 0),
          weather: form.weather,
          issue_summary: form.issue_summary,
          status: "submitted"
        }
      });
      wx.showToast({ title: "提交成功", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "提交失败", icon: "none" }));
  }
});
