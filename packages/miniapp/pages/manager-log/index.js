const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");
const { required, ymdDate, firstError } = require("../../utils/validation");

const today = () => new Date().toISOString().slice(0, 10);

Page({
  data: {
    form: {
      project_id: "",
      log_date: today(),
      title: "",
      detail_html: "",
      photos: []
    },
    projectId: 0,
    busy: false
  },

  onLoad(query) {
    const projectId = Number(query.projectId || 0);
    if (projectId > 0) {
      this.setData({
        projectId,
        "form.project_id": String(projectId)
      });
    }
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

  async pickPhoto() {
    return this.runBusy(async () => {
      const choose = await wxChooseMediaImage();
      const filePath = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0].tempFilePath : "";
      if (!filePath) return;
      const signed = await uploadFileToR2(filePath);
      const photos = this.data.form.photos.concat([
        {
          file_key: signed.key,
          file_url: signed.fileUrl || signed.viewUrl || signed.publicUrl || "",
          caption: "manager-log"
        }
      ]);
      this.setData({ "form.photos": photos });
      wx.showToast({ title: "上传完成", icon: "success" });
    }).catch((error) => wx.showToast({ title: error.message || "上传失败", icon: "none" }));
  },

  async submit() {
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
      await request({
        method: "POST",
        path: "/api/v1/log/manager",
        data: {
          project_id: Number(form.project_id),
          log_date: form.log_date,
          title: form.title,
          detail_html: form.detail_html,
          photos: form.photos,
          status: "submitted"
        }
      });
      wx.showToast({ title: "提交成功", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 250);
    }).catch((error) => wx.showToast({ title: error.message || "提交失败", icon: "none" }));
  }
});
