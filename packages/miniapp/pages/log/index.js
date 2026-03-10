Page({
  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  },

  openGlobalHelper() {
    wx.showActionSheet({
      itemList: ["🎤 写现场概况", "🎤 报顶进数据"],
      success: async (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: "/pages/manager-log/index" });
          return;
        }
        wx.navigateTo({ url: "/pages/operator-log/index" });
      }
    });
  }
});
