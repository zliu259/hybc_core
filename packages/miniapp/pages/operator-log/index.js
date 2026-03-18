const { request } = require("../../utils/request");
const { required, positiveNumber, ymdDate, firstError } = require("../../utils/validation");

const today = () => new Date().toISOString().slice(0, 10);
const SHIFT_OPTIONS = [
  { label: "白班", value: "day" },
  { label: "夜班", value: "night" }
];

const toNumberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toNonNegative = (value) => {
  const num = toNumberOrNull(value);
  if (num === null) return null;
  return Math.max(0, num);
};

const inferShiftByCurrentTime = () => {
  const hour = new Date().getHours();
  if (hour >= 17) return "day";
  if (hour < 10) return "night";
  return "day";
};

Page({
  data: {
    form: {
      project_id: "",
      section_id: "",
      log_date: today(),
      shift: inferShiftByCurrentTime(),
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
    shiftIndex: SHIFT_OPTIONS.findIndex((item) => item.value === inferShiftByCurrentTime()),
    sectionOptions: [],
    sectionNames: [],
    sectionIndex: -1,
    previousCumulative: 0,
    lastEditedField: "completed",
    calcHint: "",
    busy: false
  },

  onLoad(query) {
    const projectId = Number(query.projectId || 0);
    const sectionId = Number(query.sectionId || 0);
    const editingLogId = Number(query.id || 0);
    const shift = inferShiftByCurrentTime();
    const shiftIndex = SHIFT_OPTIONS.findIndex((item) => item.value === shift);

    const patch = {
      editingLogId,
      submitLabel: editingLogId ? "保存修改" : "提交日志",
      shiftIndex: shiftIndex < 0 ? 0 : shiftIndex,
      "form.shift": shift
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
      return;
    }
    if (projectId > 0) {
      this.loadSections(projectId, sectionId).then(() => this.refreshBaselineAndDerive());
    }
  },

  runBusy(fn) {
    if (this.data.busy) return Promise.resolve();
    this.setData({ busy: true });
    return Promise.resolve()
      .then(() => fn())
      .finally(() => this.setData({ busy: false }));
  },

  applyShift(shiftValue) {
    const shift = shiftValue === "night" ? "night" : "day";
    const index = SHIFT_OPTIONS.findIndex((item) => item.value === shift);
    this.setData({
      shiftIndex: index < 0 ? 0 : index,
      "form.shift": shift
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  async loadSections(projectId, preferSectionId = 0) {
    if (!projectId) {
      this.setData({ sectionOptions: [], sectionNames: [], sectionIndex: -1, sectionId: 0, "form.section_id": "" });
      return;
    }
    try {
      const res = await request({ method: "GET", path: `/api/v1/project/${projectId}/sections` });
      const list = Array.isArray(res.data) ? res.data : [];
      const sectionOptions = list.map((item) => ({
        id: Number(item.id),
        code: item.section_code || "-",
        name: item.section_name || "未命名标段"
      }));
      const sectionNames = sectionOptions.map((item) => `${item.code} · ${item.name}`);

      let sectionIndex = -1;
      if (preferSectionId > 0) {
        sectionIndex = sectionOptions.findIndex((item) => item.id === Number(preferSectionId));
      }
      if (sectionIndex < 0 && sectionOptions.length === 1) {
        sectionIndex = 0;
      }
      const selected = sectionIndex >= 0 ? sectionOptions[sectionIndex] : null;

      this.setData({
        sectionOptions,
        sectionNames,
        sectionIndex,
        sectionId: selected ? selected.id : 0,
        "form.section_id": selected ? String(selected.id) : ""
      });
    } catch (error) {
      this.setData({ sectionOptions: [], sectionNames: [], sectionIndex: -1 });
      wx.showToast({ title: error.message || "标段加载失败", icon: "none" });
    }
  },

  async loadLogDetail(id) {
    return this.runBusy(async () => {
      const res = await request({ method: "GET", path: `/api/v1/log/operator/${id}` });
      const detail = (res && res.data) || {};
      const shift = detail.shift || inferShiftByCurrentTime();
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

      await this.loadSections(projectId, sectionId);
      await this.refreshBaselineAndDerive();
    }).catch((error) => wx.showToast({ title: error.message || "日志加载失败", icon: "none" }));
  },

  onProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    if (!projectId) return;
    this.setData({
      projectId,
      sectionId: 0,
      sectionIndex: -1,
      "form.project_id": String(projectId),
      "form.section_id": ""
    });
    this.loadSections(projectId).then(() => this.refreshBaselineAndDerive());
  },

  onSectionChange(e) {
    const index = Number(e.detail.value || 0);
    const section = this.data.sectionOptions[index];
    if (!section) return;
    this.setData({
      sectionIndex: index,
      sectionId: section.id,
      "form.section_id": String(section.id)
    });
  },

  autoShiftByTime() {
    const shift = inferShiftByCurrentTime();
    this.applyShift(shift);
    this.refreshBaselineAndDerive();
    wx.showToast({ title: shift === "day" ? "已判定为白班" : "已判定为夜班", icon: "none" });
  },

  onDateChange(e) {
    this.setData({ "form.log_date": e.detail.value });
    this.refreshBaselineAndDerive();
  },

  onShiftChange(e) {
    const index = Number(e.detail.value || 0);
    const shift = SHIFT_OPTIONS[index] || SHIFT_OPTIONS[0];
    this.setData({
      shiftIndex: index,
      "form.shift": shift.value
    });
    this.refreshBaselineAndDerive();
  },

  deriveByCompleted() {
    const completed = toNonNegative(this.data.form.completed_pipe_count);
    if (completed === null) return;
    const cumulative = this.data.previousCumulative + completed;
    this.setData({
      "form.cumulative_pipe_count": String(cumulative),
      calcHint: `历史累计${this.data.previousCumulative}，自动推算累计为${cumulative}`
    });
  },

  deriveByCumulative() {
    const cumulative = toNonNegative(this.data.form.cumulative_pipe_count);
    if (cumulative === null) return;
    const completed = Math.max(0, cumulative - this.data.previousCumulative);
    this.setData({
      "form.completed_pipe_count": String(completed),
      calcHint: `历史累计${this.data.previousCumulative}，自动推算本班为${completed}`
    });
  },

  onCompletedInput(e) {
    const value = e.detail.value;
    this.setData({
      "form.completed_pipe_count": value,
      lastEditedField: "completed"
    });
    this.deriveByCompleted();
  },

  onCumulativeInput(e) {
    const value = e.detail.value;
    this.setData({
      "form.cumulative_pipe_count": value,
      lastEditedField: "cumulative"
    });
    this.deriveByCumulative();
  },

  async refreshBaselineAndDerive() {
    const form = this.data.form;
    if (!form.project_id || !form.log_date || !form.shift) return;
    try {
      const res = await request({
        method: "POST",
        path: "/api/v1/log/operator/smart-fill",
        data: {
          project_id: Number(form.project_id),
          log_date: form.log_date,
          shift: form.shift,
          completed_pipe_count: 0
        }
      });
      const prefill = ((res || {}).data || {}).prefill || {};
      const previousCumulative = Number(prefill.cumulative_pipe_count || 0);
      this.setData({ previousCumulative });
      if (this.data.lastEditedField === "cumulative") {
        this.deriveByCumulative();
      } else {
        this.deriveByCompleted();
      }
    } catch {
      this.setData({ previousCumulative: 0, calcHint: "历史累计读取失败，可手动填写" });
    }
  },

  async smartFill() {
    const form = this.data.form;
    const errorText = firstError([required(form.project_id, "项目"), ymdDate(form.log_date, "日期")]);
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
      const prefill = ((res || {}).data || {}).prefill || {};
      const cumulative = Number(prefill.cumulative_pipe_count || 0);
      const previousCumulative = Math.max(0, cumulative - Number(form.completed_pipe_count || 0));
      this.setData({
        previousCumulative,
        "form.weather": prefill.weather || "",
        "form.issue_summary": prefill.issue_summary || "",
        "form.cumulative_pipe_count": String(cumulative),
        calcHint: `AI预填完成：历史累计${previousCumulative}，当前累计${cumulative}`
      });
      wx.showToast({ title: "AI预填完成", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "预填失败", icon: "none" }));
  },

  async submit() {
    const form = this.data.form;
    const errorText = firstError([
      required(form.project_id, "项目"),
      required(form.section_id, "标段"),
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
      wx.showLoading({ title: "提交中...", mask: true });
      const payload = {
        project_id: Number(form.project_id),
        section_id: Number(form.section_id),
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
      wx.hideLoading();
      wx.showToast({ title: this.data.editingLogId > 0 ? "修改成功" : "提交成功", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 250);
    }).catch((error) => {
      wx.hideLoading();
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    });
  }
});
