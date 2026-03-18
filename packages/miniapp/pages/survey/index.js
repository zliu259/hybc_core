const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxGetLocation, wxChooseMediaImage } = require("../../utils/wx");
const { required, positiveNumber, ymdDate, firstError } = require("../../utils/validation");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");

const today = () => new Date().toISOString().slice(0, 10);

Page({
  data: {
    form: {
      project_id: "",
      survey_date: today(),
      location: "",
      weather: "",
      summary: ""
    },
    sharedProjectId: 0,
    photoKeys: [],
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
      sharedProjectId: projectId,
      "form.project_id": String(projectId)
    });
  },

  onDateChange(e) {
    this.setData({ "form.survey_date": e.detail.value });
  },

  async fillLocation() {
    return this.runBusy(async () => {
      const loc = await wxGetLocation();
      this.setData({
        "form.location": `${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)}`
      });
    }).catch(() => sayToast({ title: "定位失败", icon: "none", danger: true }));
  },

  async addPhoto() {
    return this.runBusy(async () => {
      const choose = await wxChooseMediaImage();
      const path = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].tempFilePath : "";
      if (!path) return;
      const file = await uploadFileToR2(path);
      this.setData({ photoKeys: this.data.photoKeys.concat([file.key]) });
      vibrateSuccess();
      sayToast({ title: "照片已上传", icon: "success" });
    }).catch((error) => sayToast({ title: error.message || "上传失败", icon: "none", danger: true }));
  },

  async submitSurvey() {
    const form = this.data.form;
    const errorText = firstError([
      positiveNumber(form.project_id, "项目ID"),
      ymdDate(form.survey_date, "勘查日期"),
      required(form.location, "位置")
    ]);
    if (errorText) {
      sayToast({ title: errorText, icon: "none", danger: true });
      return;
    }

    return this.runBusy(async () => {
      wx.showLoading({ title: "提交中...", mask: true });
      const form = this.data.form;
      const photoText = this.data.photoKeys.join(",");
      await request({
        method: "POST",
        path: "/api/v1/survey/site-survey",
        data: {
          project_id: Number(form.project_id),
          survey_date: form.survey_date,
          location: form.location,
          weather: form.weather,
          summary: photoText ? `${form.summary}\nphotos:${photoText}` : form.summary,
          status: "submitted",
          items: [
            {
              item_name: "miniapp_photos",
              item_value: photoText
            }
          ]
        }
      });
      vibrateSuccess();
      wx.hideLoading();
      sayToast({ title: "提交成功", icon: "success" });
    }).catch((error) => {
      vibrateWarning();
      wx.hideLoading();
      sayToast({ title: error.message || "提交失败", icon: "none", danger: true });
    });
  }
});
