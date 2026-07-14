# 小程序强制更新（原生 OTA）设计

日期：2026-07-14
状态：已确认

## 背景与目标

企业微信小程序发布新版本后，员工常常不及时重启导致长期运行旧版本，产生与后端不一致、旧 bug 复现等问题。

目标：当运行的小程序版本落后于最新发布版本时，弹出**不可取消的重启弹框**并完全重启到新版本，把「不重启就不更新」的窗口压到最小。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 实现范围 | **仅原生 OTA**（`wx.getUpdateManager`），零后端、零 D1、零版本号手工维护 |
| 触发时机 | 冷启动（WeChat 自动检测新版本的时机） |
| 强制方式 | `wx.showModal({ showCancel: false })` → `applyUpdate()` 完全重启 |
| 下载失败 | 弹信息框引导用户删除小程序后重新进入（无法自动修复） |
| 热启动兜底 | 不做。极端「长期只热启动」个例不 100% 覆盖——已否掉服务端硬闸门方案 |

### 关于「仅冷启动」为何可接受

WeChat 只在冷启动时检查是否有新发布版本；一旦检测到会后台下载，下载完成触发 `onUpdateReady`。WeChat 对后台小程序回收较激进（内存压力 / 数分钟后），因此绝大多数「恢复」实际是冷启动，该机制能覆盖绝大多数不重启员工。纯长期热启动的极端个例需要服务端最低版本硬闸门，本期不做。

## 实现

### 新模块 `packages/miniapp/utils/update.js`

导出单个函数 `setupForceUpdate()`，自成一体、无外部依赖，便于阅读与后续扩展：

```js
function setupForceUpdate() {
  // 老基础库无 getUpdateManager，静默降级
  if (typeof wx === "undefined" || typeof wx.getUpdateManager !== "function") return;
  const updateManager = wx.getUpdateManager();

  // WeChat 冷启动检测到新版本并后台下载完成时触发
  updateManager.onUpdateReady(() => {
    wx.showModal({
      title: "更新提示",
      content: "已为你下载最新版本，需要重启后继续使用。",
      showCancel: false,          // 无取消键 = 强制
      confirmText: "立即重启",
      success: () => updateManager.applyUpdate()  // 完全重启并加载新版本
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

module.exports = { setupForceUpdate };
```

### 接入点 `packages/miniapp/app.js`

- 顶部 `const { setupForceUpdate } = require("./utils/update");`
- 在 `App.onLaunch` 开头调用 `setupForceUpdate()`，与既有 `this.ensureSession()` 并列。两者互不阻塞：更新回调注册是同步的，不影响登录会话初始化。

### 「完全强制重启」语义说明

- `showCancel: false` → 弹框只有「立即重启」一个按钮，点击遮罩不关闭，等价于阻断式弹框。
- `applyUpdate()` 由 WeChat 执行小程序完全重启并切换到已下载的新版本包。
- `onUpdateReady` 在冷启动早期（`onLaunch` 阶段）触发，此时用户尚未深入操作，强制重启体验损耗最小。

## 错误处理与降级

- 缺 `wx.getUpdateManager`（极老基础库）→ 整个机制静默跳过，不报错、不影响启动。
- 下载失败 → `onUpdateFailed` 信息弹框，唯一可行引导是删除小程序重进。
- 无新版本 → `onUpdateReady` 不触发，正常启动，无任何弹框。

## 测试计划

小程序无单元测试框架，本机以微信开发者工具手动验证：

1. 模拟器「编译模式 / 编译设置 → 下次编译时模拟更新」勾选，触发 `onUpdateReady`，确认弹出不可取消的「立即重启」框，点击后小程序重启。
2. 关闭模拟更新后正常冷启动，确认无弹框。
3. 老基础库（调低调试基础库版本）下确认不报错。
4. `node --check packages/miniapp/utils/update.js` 语法校验；`packages/miniapp` typecheck 通过。

## 影响范围

- 新增 `packages/miniapp/utils/update.js`
- 修改 `packages/miniapp/app.js`（require + onLaunch 调用）
- 无后端改动、无 D1 迁移。
- 文档：`doc/开发记录.md` 追加、`doc/UI设计文档.md` 小程序段补记（实现阶段完成）。
