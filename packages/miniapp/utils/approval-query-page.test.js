/** 流程查询页和入口的流程测试：真实页面代码，只替换接口、登录态和 wx。运行：node utils/approval-query-page.test.js */
const assert = require("assert");
const path = require("path");

const realSetTimeout = setTimeout;
global.setTimeout = (fn) => realSetTimeout(fn, 0);
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 5));

const state = {};

const resetState = () => {
  state.calls = [];
  state.toasts = [];
  state.navigations = [];
  state.backs = 0;
  state.failures = [];
  state.profile = { username: "boss", roles: ["super_admin"] };
  state.total = 1;
  state.rows = [
    {
      id: 7,
      instance_no: "SP-20261014-0010",
      biz_type: "payment_request",
      biz_summary: "工资",
      initiator_userid: "LiuPeng",
      status: "in_progress",
      current_round: 1,
      submitted_at: "2026-11-05T06:20:00.000Z",
      current_node_name: "财务审核",
      pending_assignees: "LiuPeng"
    }
  ];
};

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

stub("./request.js", {
  request: async ({ path: requestPath }) => {
    state.calls.push(requestPath);
    if (state.failures.some((item) => requestPath.includes(item))) throw new Error("接口失败");
    if (requestPath.includes("/wecom/contacts")) {
      return { success: true, data: { users: [{ userid: "LiuPeng", name: "刘鹏" }, { userid: "Zhao", name: "赵六" }] } };
    }
    return { success: true, data: state.rows, pagination: { total: state.total } };
  }
});
stub("./auth.js", { getUserProfile: () => state.profile });

global.wx = {
  showToast: (options) => state.toasts.push(options.title),
  navigateTo: ({ url }) => state.navigations.push(url),
  navigateBack: () => {
    state.backs += 1;
  },
  stopPullDownRefresh() {}
};

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};

const loadPage = (file) => {
  const resolved = require.resolve(path.join(__dirname, "..", file));
  delete require.cache[resolved];
  delete require.cache[require.resolve(path.join(__dirname, "./user-names.js"))];
  require(resolved);
  return {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    }
  };
};

const open = async () => {
  const page = loadPage("packageTools/query-approval/index.js");
  page.onLoad();
  await flush();
  return page;
};

const listCalls = () => state.calls.filter((item) => item.includes("/approval/admin/all"));
const lastList = () => listCalls().pop();

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("超级管理员能查，列表说清楚卡在哪、等谁", async () => {
  const page = await open();
  assert.strictEqual(page.data.allowed, true);
  assert.ok(lastList().includes("page=1&pageSize=20"));
  assert.strictEqual(page.data.total, 1);
  assert.strictEqual(page.data.rows[0].waitText, "财务审核：等 刘鹏");
  assert.strictEqual(page.data.rows[0].instanceNo, "SP-20261014-0010");
});

test("其他角色进不来，也不发查询请求", async () => {
  for (const roles of [["manager"], ["finance"], ["operator"], []]) {
    resetState();
    state.profile = { username: "x", roles };
    const page = await open();
    assert.strictEqual(page.data.allowed, false, roles.join());
    assert.strictEqual(state.calls.length, 0, roles.join());
    assert.deepStrictEqual(state.toasts, ["流程查询仅限超级管理员使用"]);
    assert.strictEqual(state.backs, 1);
    page.onReachBottom();
    await page.onPullDownRefresh();
    assert.strictEqual(state.calls.length, 0);
  }
});

test("状态、类型、发起人、关键字都交给接口，并回到第一页", async () => {
  state.total = 40;
  const page = await open();
  page.onReachBottom();
  await flush();
  assert.ok(lastList().includes("page=2&"));

  page.selectStatus({ currentTarget: { dataset: { value: "returned" } } });
  await flush();
  assert.ok(lastList().includes("page=1&"));
  assert.ok(lastList().includes("status=returned"));

  page.onTypeChange({ detail: { value: 1 } });
  await flush();
  assert.ok(lastList().includes("biz_type=payment_request"));

  const index = page.data.initiatorLabels.indexOf("赵六");
  assert.ok(index > 0);
  page.onInitiatorChange({ detail: { value: index } });
  await flush();
  assert.ok(lastList().includes("initiator=Zhao"));

  page.onKeywordInput({ detail: { value: " SP-2026 " } });
  await flush();
  assert.ok(lastList().includes("keyword=SP-2026"));

  page.clearFilters();
  await flush();
  assert.ok(!/status=|biz_type=|initiator=|keyword=/.test(lastList()));
});

test("触底加载更多，到底不再请求", async () => {
  state.total = 21;
  const page = await open();
  page.onReachBottom();
  await flush();
  assert.strictEqual(page.data.rows.length, 2);
  assert.strictEqual(page.data.hasMore, false);
  const before = listCalls().length;
  page.onReachBottom();
  await flush();
  assert.strictEqual(listCalls().length, before);
});

test("加载失败显示原因；通讯录取不到时其他筛选照常", async () => {
  state.failures = ["/approval/admin/all"];
  const failed = await open();
  assert.strictEqual(failed.data.loadError, "接口失败");

  resetState();
  state.failures = ["/wecom/contacts"];
  const page = await open();
  assert.strictEqual(page.data.rows.length, 1);
  assert.deepStrictEqual(page.data.initiatorLabels, ["全部发起人"]);
});

test("点一条进审批详情", async () => {
  const page = await open();
  page.openDetail({ currentTarget: { dataset: { id: 7 } } });
  assert.deepStrictEqual(state.navigations, ["/pages/approval-detail/index?id=7"]);
});

test("综合查询：只有超级管理员看得到流程查询入口", async () => {
  const titles = (page) => page.data.entries.map((item) => item.title);
  const hasEntry = (page) => titles(page).some((title) => title.includes("流程查询"));

  const admin = loadPage("pages/query/index.js");
  admin.onShow();
  assert.strictEqual(hasEntry(admin), true);
  assert.strictEqual(admin.data.entries.length, 4);
  assert.strictEqual(admin.data.entries[3].path, "/packageTools/query-approval/index");

  for (const roles of [["manager"], ["finance"]]) {
    state.profile = { username: "x", roles };
    const page = loadPage("pages/query/index.js");
    page.onShow();
    assert.strictEqual(hasEntry(page), false, roles.join());
    assert.strictEqual(page.data.entries.length, 3);
  }
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
  console.log(`approval-query-page: ${tests.length} ok`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
