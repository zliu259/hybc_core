const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const {
  buildEntrySections,
  buildGreeting,
  buildPendingPreview,
  buildTodoTiles,
  todoKeysFor
} = require("../../utils/workbench-view");

const USAGE_KEY_PREFIX = "workbench:usage:v1:";

const totalOf = (result) =>
  Number((result && result.pagination && result.pagination.total) || 0);

const lengthOf = (result) =>
  Array.isArray(result && result.data) ? result.data.length : 0;

/** 每个待办数字怎么取。各取各的，一个接口失败不影响其他数字。 */
const TODO_LOADERS = {
  returned: {
    path: "/api/v1/approval/initiated/summary",
    read: (result) => Number((result.data && result.data.returned_needs_action) || 0)
  },
  review: {
    path: "/api/v1/project/external-log-submissions?status=needs_manual_review&page=1&pageSize=1",
    read: totalOf
  },
  warning: { path: "/api/v1/log/progress-alert", read: lengthOf },
  tasks: {
    path: "/api/v1/warehouse/task?scope=mine&status=todo&page=1&pageSize=1",
    read: totalOf
  }
};

const get = (path) => request({ method: "GET", path });

const settle = (promise) =>
  promise.then(
    (result) => ({ ok: true, result }),
    () => ({ ok: false, result: null })
  );

const readUsage = (key) => {
  try {
    return wx.getStorageSync(key) || {};
  } catch {
    return {};
  }
};

const writeUsage = (key, usage) => {
  try {
    wx.setStorageSync(key, usage);
  } catch {
    // 只影响常用入口的排序，存不下不必打扰用户
  }
};

const nameFromProfile = (profile, userNames) => {
  const nickname = String(profile.nickname || "");
  if (/[一-鿿]/.test(nickname)) return nickname;
  const name = toUserName(profile.username, userNames, "");
  return name === "-" ? "" : name;
};

Page({
  data: {
    greeting: { text: "", dateText: "" },
    todos: [],
    common: [],
    more: [],
    pendingPreview: [],
    pendingTotal: 0,
    someCountsFailed: false
  },

  onLoad() {
    // 上一次取到的数字。刷新失败时留着，不能变成 0 让人以为没有待办
    this._counts = {};
    this._requestId = 0;
  },

  onShow() {
    this.syncEntries();
    this.loadWorkbench();
  },

  async onPullDownRefresh() {
    await this.loadWorkbench();
    wx.stopPullDownRefresh();
  },

  /** 入口只在换了账号或角色时重排，一次使用过程中位置不变，才能凭手感点。 */
  syncEntries() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const identity = `${profile.username || ""}|${roles.join(",")}`;
    if (identity === this._identity) return;
    this._identity = identity;
    this._usageKey = `${USAGE_KEY_PREFIX}${profile.username || ""}`;
    const { common, more } = buildEntrySections(roles, readUsage(this._usageKey));
    this.setData({ common, more });
  },

  async loadWorkbench() {
    this._requestId += 1;
    const requestId = this._requestId;
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const keys = todoKeysFor(roles).filter((key) => TODO_LOADERS[key]);

    const [userNames, pending, ...others] = await Promise.all([
      loadUserNameMap(),
      settle(get("/api/v1/approval/pending?page=1&pageSize=3")),
      ...keys.map((key) => settle(get(TODO_LOADERS[key].path)))
    ]);
    if (requestId !== this._requestId) return;

    const counts = {
      ...this._counts,
      ...(pending.ok ? { pending: totalOf(pending.result) } : {}),
      ...Object.fromEntries(
        keys
          .map((key, index) => [key, others[index]])
          .filter(([, outcome]) => outcome.ok)
          .map(([key, outcome]) => [key, TODO_LOADERS[key].read(outcome.result)])
      )
    };
    this._counts = counts;

    const toName = (userid) => toUserName(userid, userNames);
    this.setData({
      greeting: buildGreeting(new Date(), nameFromProfile(profile, userNames)),
      todos: buildTodoTiles(roles, counts),
      ...(pending.ok
        ? {
            pendingPreview: buildPendingPreview(pending.result.data, toName),
            pendingTotal: counts.pending
          }
        : {}),
      someCountsFailed: !pending.ok || others.some((outcome) => !outcome.ok)
    });
  },

  openPath(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.path });
  },

  openEntry(e) {
    const { key, path } = e.currentTarget.dataset;
    const usage = readUsage(this._usageKey);
    writeUsage(this._usageKey, { ...usage, [key]: Number(usage[key] || 0) + 1 });
    wx.navigateTo({ url: path });
  },

  openApproval(e) {
    wx.navigateTo({ url: `/pages/approval-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  openAllApprovals() {
    wx.navigateTo({ url: "/pages/approval/index" });
  }
});
