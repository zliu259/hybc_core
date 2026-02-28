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
      section_id: "",
      log_date: today(),
      shift: "day",
      completed_pipe_count: "0",
      cumulative_pipe_count: "0",
      footage_m: "",
      weather: "",
      issue_summary: "",
      remark: ""
    },
    projectId: 0,
    sectionId: 0,
    editingLogId: 0,
    submitLabel: "提交日志",
    shiftOptions: SHIFT_OPTIONS.map((item) => item.label),
    shiftIndex: 0,
    busy: false
  },

  onLoad(query) {
    const projectId = Number(query.projectId || 0);
    const sectionId = Number(query.sectionId || 0);
    const editingLogId = Number(query.id || 0);

    const patch = {
      editingLogId,
      submitLabel: editingLogId ? "保存修改" : "提交日志"
    };

    if (projectId > 0) {
      patch.projectId = projectId;
      patch["form.project_id"] = String(projectId);
    }
    if (sectionId > 0) {
      patch.sectionId = sectionId;
      patch["form.section_id"] = String(sectionId);
    }

    this.setData(patch);

    if (editingLogId > 0) {
      this.loadLogDetail(editingLogId);
    }
  },

  async loadLogDetail(id) {
    return this.runBusy(async () => {
      const res = await request({ method: "GET", path: `/api/v1/log/operator/${id}` });
      const detail = (res && res.data) || {};
      const shift = detail.shift || "day";
      const shiftIndex = SHIFT_OPTIONS.findIndex((item) => item.value === shift);
      const projectId = Number(detail.project_id || this.data.projectId || 0);
      const sectionId = Number(detail.section_id || this.data.sectionId || 0);
      this.setData({
        projectId,
        sectionId,
        shiftIndex: shiftIndex < 0 ? 0 : shiftIndex,
        "form.project_id": projectId ? String(projectId) : "",
        "form.section_id": sectionId ? String(sectionId) : "",
        "form.log_date": detail.log_date || today(),
        "form.shift": shift,
        "form.completed_pipe_count": String(detail.completed_pipe_count || 0),
        "form.cumulative_pipe_count": String(detail.cumulative_pipe_count || 0),
        "form.footage_m": detail.footage_m === null || detail.footage_m === undefined ? "" : String(detail.footage_m),
        "form.weather": detail.weather || "",
        "form.issue_summary": detail.issue_summary || "",
        "form.remark": detail.remark || ""
      });
    }).catch((error) => wx.showToast({ title: error.message || "日志加载失败", icon: "none" }));
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

  onSectionInput(e) {
    const raw = (e.detail.value || "").trim();
    const sectionId = Number(raw || 0);
    this.setData({
      sectionId,
      "form.section_id": raw
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
      positiveNumber(form.completed_pipe_count, "本班下管数"),
      positiveNumber(form.cumulative_pipe_count, "累计下管数")
    ]);
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    return this.runBusy(async () => {
      const payload = {
        project_id: Number(form.project_id),
        section_id: form.section_id ? Number(form.section_id) : undefined,
        log_date: form.log_date,
        shift: form.shift,
        completed_pipe_count: Number(form.completed_pipe_count || 0),
        cumulative_pipe_count: Number(form.cumulative_pipe_count || 0),
        footage_m: form.footage_m === "" ? undefined : Number(form.footage_m),
        weather: form.weather,
        issue_summary: form.issue_summary,
        remark: form.remark,
        status: "submitted"
      };

      if (this.data.editingLogId > 0) {
        await request({
          method: "PUT",
          path: `/api/v1/log/operator/${this.data.editingLogId}`,
          data: payload
        });
      } else {
        await request({
          method: "POST",
          path: "/api/v1/log/operator",
          data: payload
        });
      }
      wx.showToast({ title: this.data.editingLogId > 0 ? "修改成功" : "提交成功", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 250);
    }).catch((error) => wx.showToast({ title: error.message || "提交失败", icon: "none" }));
  }
});
