const vibrateSuccess = () => {
  if (typeof wx.vibrateShort === "function") {
    wx.vibrateShort({ type: "light" });
  }
};

const vibrateWarning = () => {
  if (typeof wx.vibrateLong === "function") {
    wx.vibrateLong();
  }
};

const sayToast = ({ title, icon = "none", danger = false }) => {
  wx.showToast({ title, icon });
  if (danger) {
    vibrateWarning();
  }
};

module.exports = {
  vibrateSuccess,
  vibrateWarning,
  sayToast
};
