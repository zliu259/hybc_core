# 小程序强制更新（原生 OTA） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当小程序运行版本落后于最新发布版本时，冷启动弹出不可取消的重启弹框并完全重启到新版本。

**Architecture:** 新增自成一体的 `utils/update.js`，封装 `wx.getUpdateManager` 的 `onUpdateReady`/`onUpdateFailed` 回调；在 `app.js` 的 `onLaunch` 调用一次。零后端、零 D1。

**Tech Stack:** 微信小程序原生 JS（CommonJS），WeChat `UpdateManager` API。

> **测试说明：** 小程序仓库无单元测试框架（`packages/miniapp` 的 `test` 脚本不存在，`typecheck`=`tsc --noEmit`，`allowJs` 开、`checkJs` 关）。因此本计划的"验证"用 `node --check`（语法）+ `npm run typecheck`（工程级）+ 微信开发者工具手动触发更新（运行时行为）。这是该环境下能拿到的最强验证手段。

---

### Task 1: 新增 `utils/update.js`

**Files:**
- Create: `packages/miniapp/utils/update.js`

- [ ] **Step 1: 写入模块完整代码**

创建 `packages/miniapp/utils/update.js`，内容如下（完整、可直接落盘）：

```js
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
```

- [ ] **Step 2: 语法校验**

Run: `cd packages/miniapp && node --check utils/update.js`
Expected: 无输出、退出码 0（语法正确）。

- [ ] **Step 3: 提交**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core
git add packages/miniapp/utils/update.js
git commit -m "feat(miniapp): 新增原生 OTA 强制更新模块 setupForceUpdate"
```

---

### Task 2: 在 `app.js` 接入

**Files:**
- Modify: `packages/miniapp/app.js`（顶部 require 区 + `onLaunch`）

- [ ] **Step 1: 顶部引入模块**

在 `packages/miniapp/app.js` 顶部 require 区，找到：

```js
const {
  getBaseUrl,
  isLocalOnlyBaseUrl,
  DEFAULT_REMOTE_BASE_URL
} = require("./utils/config");
```

紧随其后加一行：

```js
const { setupForceUpdate } = require("./utils/update");
```

- [ ] **Step 2: 在 onLaunch 调用**

找到：

```js
  onLaunch: function () {
    this.ensureSession();
  },
```

改为（更新检测先注册，与会话初始化并列，互不阻塞）：

```js
  onLaunch: function () {
    setupForceUpdate();
    this.ensureSession();
  },
```

- [ ] **Step 3: 语法 + 工程校验**

Run: `cd packages/miniapp && node --check app.js && npm run typecheck`
Expected: `node --check` 无输出；`typecheck` 退出码 0，无报错。

- [ ] **Step 4: 提交**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core
git add packages/miniapp/app.js
git commit -m "feat(miniapp): onLaunch 接入强制更新检测"
```

---

### Task 3: 文档补记

**Files:**
- Modify: `doc/开发记录.md`（追加新 dated section，append-only）
- Modify: `doc/UI设计文档.md`（小程序页面段补一行）

- [ ] **Step 1: 追加开发记录**

在 `doc/开发记录.md` 文件末尾追加一个新 section（格式对齐既有条目）：

```markdown
## 2026-07-14 小程序强制更新（原生 OTA）

### 目标

员工不及时重启导致长期运行旧版本；发布新版本后自动强制其重启到最新版。

### 变更

- 新增 `packages/miniapp/utils/update.js` 的 `setupForceUpdate()`：封装 `wx.getUpdateManager`，`onUpdateReady` 弹不可取消弹框（`showCancel:false`）→ `applyUpdate()` 完全重启；`onUpdateFailed` 引导用户删除小程序重进；缺 API 静默降级。
- `app.js` `onLaunch` 开头调用 `setupForceUpdate()`，与 `ensureSession()` 并列。
- 仅原生方案，冷启动触发（WeChat 检查更新时机），零后端、零 D1、零版本号手工维护。

### 影响范围

- `packages/miniapp/utils/update.js`（新增）、`packages/miniapp/app.js`
- 无后端改动、无 D1 迁移。

### 已知边界

- 检测仅在冷启动发生；纯长期热启动的极端个例不 100% 覆盖（需服务端最低版本硬闸门，本期未做）。

### 下一步

- 微信开发者工具「模拟更新」验证弹框与重启；正式发布后线上观察。
```

- [ ] **Step 2: 追加 UI 设计文档小程序段**

在 `doc/UI设计文档.md` 小程序页面清单中，找到这一行：

```markdown
- 登录恢复页：`packages/miniapp/pages/login/index`
```

在其后加一行：

```markdown
- 强制更新（2026-07-14）：冷启动检测到新发布版本时弹出不可取消的「立即重启」弹框并完全重启到新版（`wx.getUpdateManager`），逻辑在 `packages/miniapp/utils/update.js`，`app.js` onLaunch 接入。
```

- [ ] **Step 3: 提交**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core
git add doc/开发记录.md doc/UI设计文档.md
git commit -m "docs: 小程序强制更新记录与 UI 文档补记"
```

---

## 手动验证（微信开发者工具，实现完成后执行）

1. 打开 `packages/miniapp` 项目 → 模拟器「编译模式 / 编译设置 → 下次编译时模拟更新」勾选 → 重新编译。
2. 预期：启动后弹出「更新提示」，只有「立即重启」按钮（无取消、点遮罩不关），点击后小程序重启。
3. 取消勾选后正常冷启动，确认无任何弹框。
4. （可选）把调试基础库调到 < 1.9.90，确认无 `getUpdateManager` 时不报错、正常启动。

## 完成标准

- `node --check` 与 `packages/miniapp typecheck` 均通过。
- 微信开发者工具「模拟更新」下弹框与重启行为符合预期。
- 三次提交（模块 / 接入 / 文档），未 push。
