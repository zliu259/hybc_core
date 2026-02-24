const { runVoiceAssistant } = require("../../utils/voice-assistant");

Page({
  data: {
    currentProject: "[未定位项目]",
    sections: [
      { name: "东线顶管", done: 120, total: 300, percent: 40 },
      { name: "西线顶管", done: 84, total: 200, percent: 42 }
    ]
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  onShow() {
    wx.getLocation({
      type: "gcj02",
      success: () => this.setData({ currentProject: "[A1 顶管项目]" }),
      fail: () => this.setData({ currentProject: "[定位失败，请手选项目]" })
    });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎙️ 录音识别指令", "🎤 写现场概况", "🎤 报顶进数据", "🎤 现场勘查"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await runVoiceAssistant({ scene: "warehouse" }).catch(() => {});
          return;
        }
        if (res.tapIndex === 1) {
          wx.navigateTo({ url: "/pages/manager-log/index" });
          return;
        }
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: "/pages/operator-log/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/survey/index" });
      }
    });
  }
});
