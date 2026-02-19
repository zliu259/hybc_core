Page({
  goTo(e) {
    const path = e.currentTarget.dataset.path;
    wx.navigateTo({ url: path });
  }
});
