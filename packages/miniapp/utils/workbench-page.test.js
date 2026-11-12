/** 工作台的流程测试：真实页面代码 + 真实视图模型，只替换接口、登录态和 wx。运行：node utils/workbench-page.test.js */
const assert = require("assert");
const path = require("path");

const state = {};

const resetState = () => {
  state.calls = [];
  state.responses = {};
  state.failures = [];
  state.navigations = [];
  state.storage = {};
  state.pullStops = 0;
  state.profile = { username: "LiuPeng", nickname: "LiuPeng", roles: ["manager"] };
  state.storageFails = false;
};

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

stub("./request.js", {
  request: async ({ path: requestPath }) => {
    state.calls.push(requestPath);
    if (state.failures.some((item) => requestPath.includes(item))) {
      throw new Error("接口失败");
    }
    const key = Object.keys(state.responses).find((item) => requestPath.includes(item));
    return key ? state.responses[key] : { success: true, data: [] };
  }
});
stub("./auth.js", { getUserProfile: () => state.profile });

global.wx = {
  navigateTo: ({ url }) => state.navigations.push(url),
  stopPullDownRefresh: () => {
    state.pullStops += 1;
  },
  getStorageSync: (key) => {
    if (state.storageFails) throw new Error("storage");
    return state.storage[key];
  },
  setStorageSync: (key, value) => {
    if (state.storageFails) throw new Error("storage");
    state.storage[key] = value;
  }
};

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};

const openPage = async () => {
  const resolved = require.resolve(path.join(__dirname, "../pages/index/index.js"));
  delete require.cache[resolved];
  // user-names 有模块级缓存，每条用例要重新取
  delete require.cache[require.resolve(path.join(__dirname, "./user-names.js"))];
  require(resolved);
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    }
  };
  page.onLoad();
  page.onShow();
  await new Promise((resolve) => setTimeout(resolve, 5));
  return page;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

const setResponses = () => {
  state.responses["/wecom/contacts"] = {
    success: true,
    data: { users: [{ userid: "LiuPeng", name: "刘鹏" }] }
  };
  state.responses["/approval/pending"] = {
    success: true,
    data: [
      {
        id: 101,
        biz_type: "payment_request",
        biz_summary: "PM-1 | 工资",
        biz_amount: 100,
        initiator_userid: "LiuPeng",
        submitted_at: "2026-11-05T06:20:00.000Z"
      }
    ],
    pagination: { total: 37 }
  };
  state.responses["/approval/initiated/summary"] = {
    success: true,
    data: { total: 9, returned_needs_action: 2, in_progress: 3, done: 4 }
  };
  state.responses["/external-log-submissions"] = {
    success: true,
    data: [],
    pagination: { total: 3 }
  };
  state.responses["/log/progress-alert"] = { success: true, data: [{}, {}] };
  // 库房任务数取分页里的总数，不是这一页的条数
  state.responses["/warehouse/task?scope=mine"] = {
    success: true,
    data: [{}],
    pagination: { total: 4 }
  };
};

const countOf = (page, key) => page.data.todos.find((tile) => tile.key === key).countText;
const eventWith = (dataset) => ({ currentTarget: { dataset } });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("待审批用接口的总数，不是这一页的条数", async () => {
  setResponses();
  const page = await openPage();
  assert.strictEqual(countOf(page, "pending"), "37");
  assert.strictEqual(page.data.pendingTotal, 37);
  assert.strictEqual(countOf(page, "returned"), "2");
  assert.strictEqual(countOf(page, "review"), "3");
  assert.strictEqual(countOf(page, "warning"), "2");
  assert.strictEqual(countOf(page, "tasks"), "4");
  assert.ok(
    state.calls.includes("/api/v1/warehouse/task?scope=mine&status=todo&page=1&pageSize=1"),
    "库房任务数要查新接口"
  );
  assert.ok(!state.calls.some((item) => item.includes("/work-order/")), "不能再调旧的库房工单接口");
});

test("预览只取 3 条，不再查项目总数", async () => {
  setResponses();
  await openPage();
  assert.ok(state.calls.some((item) => item.includes("/approval/pending?page=1&pageSize=3")));
  assert.ok(!state.calls.some((item) => item.includes("/api/v1/project?")));
});

test("角色取不了的接口不发请求", async () => {
  setResponses();
  state.profile = { username: "f", nickname: "财务", roles: ["finance"] };
  const page = await openPage();
  assert.deepStrictEqual(page.data.todos.map((tile) => tile.key), ["pending", "returned"]);
  ["/external-log-submissions", "/log/progress-alert", "/warehouse/task"].forEach((item) => {
    assert.ok(!state.calls.some((call) => call.includes(item)), item);
  });
});

test("每个数字都能点进对应页面", async () => {
  setResponses();
  const page = await openPage();
  page.openPath(eventWith({ path: page.data.todos[0].path }));
  assert.deepStrictEqual(state.navigations, ["/pages/approval/index"]);
});

test("待审批预览点一下直接进详情", async () => {
  setResponses();
  const page = await openPage();
  assert.strictEqual(page.data.pendingPreview[0].title, "工资");
  page.openApproval(eventWith({ id: 101 }));
  page.openAllApprovals();
  assert.deepStrictEqual(state.navigations, [
    "/pages/approval-detail/index?id=101",
    "/pages/approval/index"
  ]);
});

test("某个数字取不到显示 -，其他照常，并提示可以刷新", async () => {
  setResponses();
  state.failures = ["/log/progress-alert"];
  const page = await openPage();
  assert.strictEqual(countOf(page, "warning"), "-");
  assert.strictEqual(countOf(page, "pending"), "37");
  assert.strictEqual(page.data.someCountsFailed, true);
});

test("待审批取不到时不显示成 0，也不白屏", async () => {
  setResponses();
  state.failures = ["/approval/pending"];
  const page = await openPage();
  assert.strictEqual(countOf(page, "pending"), "-");
  assert.strictEqual(page.data.common.length, 8);
  assert.deepStrictEqual(page.data.pendingPreview, []);
});

test("刷新失败时留着上次的数字，不能变成没有待办", async () => {
  setResponses();
  const page = await openPage();
  state.failures = ["/approval/pending", "/approval/initiated/summary"];
  await page.onPullDownRefresh();
  assert.strictEqual(countOf(page, "pending"), "37");
  assert.strictEqual(countOf(page, "returned"), "2");
  assert.strictEqual(page.data.pendingPreview.length, 1);
  assert.strictEqual(page.data.someCountsFailed, true);
  assert.strictEqual(state.pullStops, 1);
});

test("问候用中文名：昵称是拼音时查通讯录", async () => {
  setResponses();
  const page = await openPage();
  assert.ok(page.data.greeting.text.endsWith("，刘鹏"), page.data.greeting.text);

  resetState();
  setResponses();
  state.profile = { username: "unknown", nickname: "unknown", roles: ["operator"] };
  const stranger = await openPage();
  assert.ok(!/unknown|，$/.test(stranger.data.greeting.text), stranger.data.greeting.text);
});

test("点入口记次数，用满 3 次下次打开排到前面", async () => {
  setResponses();
  state.profile = { username: "LiuPeng", nickname: "刘鹏", roles: ["site_manager"] };
  const page = await openPage();
  assert.strictEqual(page.data.common[0].key, "managerLog");

  const fuel = page.data.more.find((item) => item.key === "fuel");
  [1, 2, 3].forEach(() => page.openEntry(eventWith({ key: fuel.key, path: fuel.path })));
  assert.strictEqual(state.navigations.length, 3);
  assert.strictEqual(state.navigations[0], "/packageFinance/fuel-apply/index");

  // 这次使用过程中位置不变
  page.onShow();
  await flush();
  assert.strictEqual(page.data.common[0].key, "managerLog");

  const reopened = await openPage();
  assert.strictEqual(reopened.data.common[0].key, "fuel");
});

test("换账号后按新账号的角色和习惯重排", async () => {
  setResponses();
  state.storage["workbench:usage:v1:other"] = { fuel: 9 };
  const page = await openPage();
  assert.strictEqual(page.data.common[0].key, "dashboard");

  state.profile = { username: "other", nickname: "别人", roles: ["operator"] };
  page.onShow();
  await flush();
  assert.strictEqual(page.data.common[0].key, "fuel");
});

test("本地存储坏了也能用，只是不记次数", async () => {
  setResponses();
  state.storageFails = true;
  const page = await openPage();
  assert.strictEqual(page.data.common.length, 8);
  page.openEntry(eventWith({ key: "reimbursement", path: "/packageFinance/reimbursement-list/index" }));
  assert.deepStrictEqual(state.navigations, ["/packageFinance/reimbursement-list/index"]);
});

(async () => {
  for (const [name, fn] of tests) {
    resetState();
    try {
      await fn();
    } catch (error) {
      console.error(`失败：${name}`);
      throw error;
    }
  }
  console.log(`workbench-page: ${tests.length} ok`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
