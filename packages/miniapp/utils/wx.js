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

const wxRecordAudioOnce = ({
  duration = 6000,
  format = "mp3",
  sampleRate = 16000,
  numberOfChannels = 1,
  encodeBitRate = 96000
} = {}) =>
  new Promise((resolve, reject) => {
    const recorder = wx.getRecorderManager();
    let settled = false;

    const cleanup = () => {
      if (typeof recorder.offStop === "function") {
        recorder.offStop();
      }
      if (typeof recorder.offError === "function") {
        recorder.offError();
      }
    };

    recorder.onStop((res) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    });

    recorder.onError((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    recorder.start({
      duration,
      sampleRate,
      numberOfChannels,
      encodeBitRate,
      format
    });
  });

module.exports = {
  wxLogin,
  wxScanCode,
  wxChooseMediaImage,
  wxGetLocation,
  wxRecordAudioOnce
};
