const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxGetLocation, wxChooseMediaImage } = require("../../utils/wx");
const { required, positiveNumber, ymdDate, firstError } = require("../../utils/validation");

Page({
  data: {
    form: {
      project_id: "",
      survey_date: "",
      location: "",
      weather: "",
      summary: ""
    },
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

  async fillLocation() {
    return this.runBusy(async () => {
      const loc = await wxGetLocation();
      this.setData({
        "form.location": `${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)}`
      });
    }).catch(() => wx.showToast({ title: "定位失败", icon: "none" }));
  },

  async addPhoto() {
    return this.runBusy(async () => {
      const choose = await wxChooseMediaImage();
      const path = choose.tempFiles?.[0]?.tempFilePath;
      if (!path) return;
      const file = await uploadFileToR2(path);
      this.setData({ photoKeys: this.data.photoKeys.concat([file.key]) });
      wx.showToast({ title: "照片已上传", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "上传失败", icon: "none" }));
  },

  async submitSurvey() {
    const form = this.data.form;
    const errorText = firstError([
      positiveNumber(form.project_id, "项目ID"),
      ymdDate(form.survey_date, "勘查日期"),
      required(form.location, "位置")
    ]);
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    return this.runBusy(async () => {
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
      wx.showToast({ title: "提交成功", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "提交失败", icon: "none" }));
  }
});
