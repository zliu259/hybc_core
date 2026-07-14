// 小程序强制更新（原生 OTA）：冷启动检测到新版本 → 不可取消弹框 → 完全重启。
// 设计见 docs/superpowers/specs/2026-07-14-miniapp-force-update-design.md
function setupForceUpdate() {
  // 老基础库无 getUpdateManager，静默降级，不影响启动
  if (typeof wx === "undefined" || typeof wx.getUpdateManager !== "function") {
    return;
  }

  const updateManager = wx.getUpdateManager();

  // WeChat 冷启动检测到新版本并后台下载完成时触发
  updateManager.onUpdateReady(() => {
    wx.showModal({
      title: "更新提示",
      content: "已为你下载最新版本，需要重启后继续使用。",
      showCancel: false, // 无取消键 = 强制
      confirmText: "立即重启",
      success: () => updateManager.applyUpdate() // 完全重启并加载新版本
    });
  });

  // 新版本下载失败：无法自动修复，引导用户彻底重开
  updateManager.onUpdateFailed(() => {
    wx.showModal({
      title: "更新失败",
      content: "新版本下载失败，请删除当前小程序后重新进入。",
      showCancel: false,
      confirmText: "我知道了"
    });
  });
}

module.exports = {
  setupForceUpdate
};
