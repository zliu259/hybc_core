const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");

Page({
  data: {
    operator: {
      project_id: "",
      log_date: "",
      shift: "day",
      completed_pipe_count: "0",
      weather: "",
      issue_summary: ""
    },
    manager: {
      project_id: "",
      log_date: "",
      title: "",
      detail_html: "",
      photos: []
    }
  },

  onOperatorInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`operator.${key}`]: e.detail.value });
  },

  onManagerInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`manager.${key}`]: e.detail.value });
  },

  async smartFill() {
    try {
      const op = this.data.operator;
      const res = await request({
        method: "POST",
        path: "/api/v1/log/operator/smart-fill",
        data: {
          project_id: Number(op.project_id),
          log_date: op.log_date,
          shift: op.shift,
          completed_pipe_count: Number(op.completed_pipe_count || 0)
        }
      });
      this.setData({
        "operator.weather": res.data?.prefill?.weather || "",
        "operator.issue_summary": res.data?.prefill?.issue_summary || ""
      });
      wx.showToast({ title: "预填完成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "预填失败", icon: "none" });
    }
  },

  async submitOperator() {
    try {
      const op = this.data.operator;
      await request({
        method: "POST",
        path: "/api/v1/log/operator",
        data: {
          project_id: Number(op.project_id),
          log_date: op.log_date,
          shift: op.shift,
          completed_pipe_count: Number(op.completed_pipe_count || 0),
          weather: op.weather,
          issue_summary: op.issue_summary,
          status: "submitted"
        }
      });
      wx.showToast({ title: "提交成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    }
  },

  async pickManagerPhoto() {
    try {
      const choose = await wxChooseMediaImage();
      const filePath = choose.tempFiles?.[0]?.tempFilePath;
      if (!filePath) return;
      const signed = await uploadFileToR2(filePath);
      const photos = this.data.manager.photos.concat([
        { file_key: signed.key, caption: "miniapp" }
      ]);
      this.setData({ "manager.photos": photos });
      wx.showToast({ title: "上传完成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    }
  },

  async submitManager() {
    try {
      const mg = this.data.manager;
      await request({
        method: "POST",
        path: "/api/v1/log/manager",
        data: {
          project_id: Number(mg.project_id),
          log_date: mg.log_date,
          title: mg.title,
          detail_html: mg.detail_html,
          photos: mg.photos,
          status: "submitted"
        }
      });
      wx.showToast({ title: "提交成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    }
  }
});
