const getBaseUrl = () => {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.apiBaseUrl) {
    return app.globalData.apiBaseUrl;
  }
  return "http://127.0.0.1:8787";
};

module.exports = {
  getBaseUrl
};
