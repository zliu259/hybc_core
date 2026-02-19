const wxLogin = () =>
  new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject
    });
  });

const wxScanCode = () =>
  new Promise((resolve, reject) => {
    wx.scanCode({
      onlyFromCamera: false,
      success: resolve,
      fail: reject
    });
  });

const wxChooseMediaImage = () =>
  new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      success: resolve,
      fail: reject
    });
  });

const wxGetLocation = () =>
  new Promise((resolve, reject) => {
    wx.getLocation({
      type: "gcj02",
      success: resolve,
      fail: reject
    });
  });

module.exports = {
  wxLogin,
  wxScanCode,
  wxChooseMediaImage,
  wxGetLocation
};
