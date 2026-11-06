/**
 * 项目列表和详情页的流程测试：真实页面代码 + 真实视图模型，只替换接口、登录态和 wx。
 * 运行：node utils/project-pages.test.js
 */
const assert = require("assert");
const path = require("path");

const realSetTimeout = setTimeout;
// 搜索输入有防抖，测试里不必真等
global.setTimeout = (fn) => realSetTimeout(fn, 0);
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 5));

const state = {};

const resetState = () => {
  state.calls = [];
  state.responses = {};
  state.failures = {};
  state.toasts = [];
  state.navigations = [];
  state.previews = [];
  state.pullStops = 0;
  state.profile = { username: "me", roles: ["manager"] };
  state.hold = null;
};

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const matchFailure = (requestPath) =>
  Object.keys(state.failures).find((key) => requestPath.includes(key));

const respond = (requestPath) => {
  const failure = matchFailure(requestPath);
  if (failure) return Promise.reject(new Error(state.failures[failure]));
  const key = Object.keys(state.responses)
    .sort((a, b) => b.length - a.length)
    .find((item) => requestPath.includes(item));
  return Promise.resolve(key ? state.responses[key](requestPath) : { success: true, data: [] });
};

stub("./request.js", {
  request: ({ path: requestPath }) => {
    state.calls.push(requestPath);
    if (state.hold) {
      return new Promise((resolve) => {
        state.hold.push(() => resolve(respond(requestPath)));
      });
    }
    return respond(requestPath);
  }
});
stub("./auth.js", { getUserProfile: () => state.profile });

global.wx = {
  showToast: (options) => state.toasts.push(options.title),
  navigateTo: ({ url }) => state.navigations.push(url),
  previewImage: (options) => state.previews.push(options),
  stopPullDownRefresh: () => {
    state.pullStops += 1;
  }
};

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};

const loadPage = (file) => {
  const resolved = require.resolve(path.join(__dirname, "..", file));
  delete require.cache[resolved];
  require(resolved);
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    }
  };
  return page;
};

const contacts = {
  success: true,
  data: { users: [{ userid: "XiaoLianZhong", name: "肖连中" }] }
};

const projectRow = (id, patch = {}) => ({
  id,
  project_code: `PRJ-${id}`,
  project_name: `工程${id}`,
  manager_userid: "XiaoLianZhong",
  status: "active",
  ...patch
});

const eventWith = (dataset) => ({ currentTarget: { dataset } });

const callsTo = (fragment) => state.calls.filter((item) => item.includes(fragment));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── 项目列表 ──

const listResponse = (rows, total) => () => ({
  success: true,
  data: rows,
  pagination: { page: 1, pageSize: 20, total }
});

test("列表：首屏分页取数，占位项目不显示，负责人显示名字", async () => {
  state.responses["/api/v1/auth/wecom/contacts"] = () => contacts;
  state.responses["/api/v1/project?"] = listResponse(
    [
      { id: 143, project_code: "办公室", project_name: "办公室", status: "active" },
      { id: 144, project_code: "仓库", project_name: "仓库", status: "active" },
      projectRow(1)
    ],
    155
  );
  const page = loadPage("pages/project-list/index.js");
  page.onLoad();
  await flush();

  assert.ok(callsTo("/api/v1/project?")[0].includes("page=1&pageSize=20"));
  assert.deepStrictEqual(page.data.projects.map((item) => item.id), [1]);
  assert.strictEqual(page.data.projects[0].managerName, "肖连中");
  assert.strictEqual(page.data.total, 153);
  assert.strictEqual(page.data.hasMore, true);
  assert.strictEqual(page.data.loading, false);
});

test("列表：触底接着加载，到底后不再请求", async () => {
  state.responses["/api/v1/project?"] = (requestPath) =>
    requestPath.includes("page=1&")
      ? listResponse([projectRow(1)], 21)()
      : listResponse([projectRow(2)], 21)();
  const page = loadPage("pages/project-list/index.js");
  page.onLoad();
  await flush();

  page.onReachBottom();
  await flush();
  assert.deepStrictEqual(page.data.projects.map((item) => item.id), [1, 2]);
  assert.strictEqual(page.data.hasMore, false);

  const before = callsTo("/api/v1/project?").length;
  page.onReachBottom();
  await flush();
  assert.strictEqual(callsTo("/api/v1/project?").length, before);
});

test("列表：状态和只看我负责的交给接口筛选，并回到第一页", async () => {
  state.responses["/api/v1/project?"] = listResponse([projectRow(1)], 40);
  const page = loadPage("pages/project-list/index.js");
  page.onLoad();
  await flush();
  page.onReachBottom();
  await flush();

  page.selectStatus(eventWith({ value: "archived" }));
  await flush();
  const statusCall = callsTo("/api/v1/project?").pop();
  assert.ok(statusCall.includes("page=1&"));
  assert.ok(statusCall.includes("status=archived"));
  assert.strictEqual(page.data.projects.length, 1);

  page.toggleMine();
  await flush();
  assert.ok(callsTo("/api/v1/project?").pop().includes("manager_userid=me"));

  page.toggleMine();
  await flush();
  assert.ok(!callsTo("/api/v1/project?").pop().includes("manager_userid"));
});

test("列表：输入关键字自动搜索，清除后恢复", async () => {
  state.responses["/api/v1/project?"] = listResponse([projectRow(1)], 1);
  const page = loadPage("pages/project-list/index.js");
  page.onLoad();
  await flush();

  page.onKeywordInput({ detail: { value: " 黄土岗 " } });
  await flush();
  assert.ok(callsTo("/api/v1/project?").pop().includes(`keyword=${encodeURIComponent("黄土岗")}`));

  page.clearKeyword();
  await flush();
  assert.ok(!callsTo("/api/v1/project?").pop().includes("keyword="));
});

test("列表：先发的慢请求后回来，不能盖掉新结果", async () => {
  state.responses["/api/v1/project?"] = (requestPath) =>
    requestPath.includes("status=archived")
      ? listResponse([projectRow(2)], 1)()
      : listResponse([projectRow(1)], 1)();
  const page = loadPage("pages/project-list/index.js");
  page._page = 0;
  page._requestId = 0;
  state.hold = [];
  const slow = page.loadFirstPage();
  await flush();
  const heldSlow = state.hold;

  state.hold = null;
  page.setData({ status: "archived" });
  await page.loadFirstPage();
  heldSlow.forEach((release) => release());
  await slow;

  assert.deepStrictEqual(page.data.projects.map((item) => item.id), [2]);
});

test("列表：加载失败显示原因可重试；翻页失败不清空已有内容", async () => {
  state.failures["/api/v1/project?"] = "网络不通";
  const failed = loadPage("pages/project-list/index.js");
  failed.onLoad();
  await flush();
  assert.strictEqual(failed.data.loadError, "网络不通");
  assert.strictEqual(failed.data.loading, false);

  state.failures = {};
  state.responses["/api/v1/project?"] = listResponse([projectRow(1)], 40);
  await failed.loadFirstPage();
  assert.strictEqual(failed.data.loadError, "");
  assert.strictEqual(failed.data.projects.length, 1);

  state.failures["/api/v1/project?"] = "网络不通";
  failed.onReachBottom();
  await flush();
  assert.strictEqual(failed.data.projects.length, 1);
  assert.deepStrictEqual(state.toasts, ["网络不通"]);
  assert.strictEqual(failed.data.loadingMore, false);
});

test("列表：下拉刷新结束后收起；进入详情带上只读标记", async () => {
  state.profile = { username: "someone", roles: ["operator"] };
  state.responses["/api/v1/project?"] = listResponse([projectRow(1)], 1);
  const page = loadPage("pages/project-list/index.js");
  page.onLoad();
  await flush();
  await page.onPullDownRefresh();
  assert.strictEqual(state.pullStops, 1);

  const card = page.data.projects[0];
  assert.strictEqual(card.readonly, true);
  page.openProjectDetail(eventWith({ id: card.id, readonly: card.readonly }));
  assert.deepStrictEqual(state.navigations, ["/pages/project-detail/index?id=1&readonly=1"]);
});

// ── 项目详情 ──

const setDetailResponses = (projectPatch = {}) => {
  state.responses["/api/v1/auth/wecom/contacts"] = () => contacts;
  state.responses["/api/v1/project/7"] = () => ({
    success: true,
    data: projectRow(7, {
      project_name: "26-07丰台区黄土岗蓄滞洪区建设工程",
      location_text: "北京市丰台区黄土岗",
      project_start_at: "2026-03-27",
      project_briefing: "开工日期：大约5月初；管径：DN2000钢管",
      ...projectPatch
    })
  });
  state.responses["/api/v1/project/7/sections"] = () => ({
    success: true,
    data: [{ id: 1, section_code: "A", section_name: "一标段", status: "active", section_length: 100 }]
  });
  state.responses["/api/v1/project/7/financial-summary"] = () => ({
    success: true,
    data: {
      outboundPaidAmount: 1000.5,
      reimbursementAmount: 0,
      inboundInvoicedAmount: 0,
      inboundReceivedAmount: 0
    }
  });
  state.responses["/api/v1/log/manager"] = () => ({
    success: true,
    data: Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      log_date: `2026-11-0${index + 1}`,
      status: "submitted",
      title: `日志${index + 1}`,
      manager_userid: "XiaoLianZhong",
      photos: [{ file_url: `https://x/${index + 1}.jpg` }]
    }))
  });
  state.responses["/api/v1/log/operator"] = () => ({
    success: true,
    data: [{ section_id: 1, log_date: "2026-11-03", footage_m: 5, cumulative_footage_m: 40 }]
  });
  state.responses["/api/v1/survey/breakthrough"] = () => ({ success: true, data: [] });
  state.responses["/external-log-submissions"] = () => ({
    success: true,
    data: [],
    pagination: { total: 3 }
  });
};

const openDetail = async (query = { id: "7", readonly: "0" }) => {
  const page = loadPage("pages/project-detail/index.js");
  page.onLoad(query);
  page.onShow();
  await flush();
  return page;
};

test("详情：项目交底、阶段、资料都显示出来", async () => {
  setDetailResponses();
  const page = await openDetail();

  assert.strictEqual(page.data.pageState, "ready");
  assert.deepStrictEqual(
    page.data.briefing.rows.map((row) => [row.label, row.value]),
    [
      ["开工日期", "大约5月初"],
      ["管径", "DN2000钢管"]
    ]
  );
  assert.strictEqual(page.data.project.statusText, "施工中");
  assert.strictEqual(page.data.stages[2].state, "current");
  assert.strictEqual(page.data.facts[0].value, "肖连中");
  assert.strictEqual(page.data.sectionCards[0].percent, 40);
  assert.strictEqual(page.data.financeRows[0].value, "¥1,000.50");
});

test("详情：交底是一段话或没填时也能正确显示", async () => {
  setDetailResponses({ project_briefing: "顶进方式：泥水平衡，全长89米。" });
  const prose = await openDetail();
  assert.strictEqual(prose.data.briefing.mode, "text");
  assert.strictEqual(prose.data.briefing.text, "顶进方式：泥水平衡，全长89米。");

  setDetailResponses({ project_briefing: null });
  const empty = await openDetail();
  assert.strictEqual(empty.data.briefing.mode, "empty");
});

test("详情：打开只加载一次，返回页面才刷新", async () => {
  setDetailResponses();
  const page = await openDetail();
  assert.strictEqual(callsTo("/sections").length, 1);

  page.onShow();
  await flush();
  assert.strictEqual(callsTo("/sections").length, 2);
  assert.strictEqual(page.data.pageState, "ready");
});

test("详情：施工日志按标段分别取，按接口每页上限取", async () => {
  setDetailResponses();
  await openDetail();
  const [call] = callsTo("/api/v1/log/operator");
  assert.ok(call.includes("section_id=1"));
  assert.ok(call.includes("pageSize=100"));
});

test("详情：标段的施工日志取不到时，不能显示成没有进度", async () => {
  setDetailResponses();
  state.failures["/api/v1/log/operator"] = "超时";
  const page = await openDetail();
  const [card] = page.data.sectionCards;
  assert.strictEqual(page.data.pageState, "ready");
  assert.strictEqual(card.percent, null);
  assert.strictEqual(card.latestText, "进度没有取到，下拉刷新重试");
});

test("详情：某一块取不到只影响那一块，其他照常显示", async () => {
  setDetailResponses();
  state.failures["/financial-summary"] = "没有权限";
  state.failures["/api/v1/log/manager"] = "超时";
  const page = await openDetail();

  assert.strictEqual(page.data.pageState, "ready");
  assert.strictEqual(page.data.financeFailed, true);
  assert.strictEqual(page.data.financeRows, null);
  assert.strictEqual(page.data.logsFailed, true);
  assert.strictEqual(page.data.sectionsFailed, false);
  assert.strictEqual(page.data.sectionCards.length, 1);
  assert.strictEqual(page.data.briefing.mode, "rows");
});

test("详情：项目本身取不到时显示原因，重试后恢复", async () => {
  setDetailResponses();
  state.failures["/api/v1/project/7"] = "项目不存在";
  const page = await openDetail();
  assert.strictEqual(page.data.pageState, "error");
  assert.strictEqual(page.data.loadError, "项目不存在");

  state.failures = {};
  await page.loadData();
  assert.strictEqual(page.data.pageState, "ready");
  assert.strictEqual(page.data.loadError, "");
});

test("详情：刷新失败不清掉已经显示的内容", async () => {
  setDetailResponses();
  const page = await openDetail();
  state.failures["/api/v1/project/7"] = "超时";

  await page.loadData();

  assert.strictEqual(page.data.pageState, "ready");
  assert.strictEqual(page.data.project.name, "26-07丰台区黄土岗蓄滞洪区建设工程");
  assert.deepStrictEqual(state.toasts, ["刷新失败，请稍后再试"]);
});

test("详情：没有项目号时直接提示，不发请求", async () => {
  const page = await openDetail({});
  assert.strictEqual(page.data.pageState, "error");
  assert.strictEqual(state.calls.length, 0);
});

test("详情：日志默认露 5 条，可展开收起，展开一条能看图", async () => {
  setDetailResponses();
  const page = await openDetail();

  assert.strictEqual(page.data.visibleLogs.length, 5);
  assert.strictEqual(page.data.visibleLogs[0].title, "日志7");
  assert.strictEqual(page.data.hiddenLogCount, 2);

  page.toggleAllLogs();
  assert.strictEqual(page.data.visibleLogs.length, 7);
  page.toggleAllLogs();
  assert.strictEqual(page.data.visibleLogs.length, 5);

  page.toggleLog(eventWith({ id: 7 }));
  assert.strictEqual(page.data.expandedLogId, 7);
  page.toggleLog(eventWith({ id: 7 }));
  assert.strictEqual(page.data.expandedLogId, 0);

  page.previewLogPhoto(eventWith({ logid: 7, current: "https://x/7.jpg" }));
  assert.deepStrictEqual(state.previews[0].urls, ["https://x/7.jpg"]);
});

test("详情：复核入口只给有权限的人，别人不发这个请求", async () => {
  setDetailResponses();
  state.profile = { username: "XiaoLianZhong", roles: ["site_manager"] };
  const reviewer = await openDetail();
  assert.strictEqual(reviewer.data.canReview, true);
  assert.strictEqual(reviewer.data.externalReviewCount, 3);

  resetState();
  setDetailResponses();
  state.profile = { username: "other", roles: ["manager"] };
  const other = await openDetail();
  assert.strictEqual(other.data.canReview, false);
  assert.strictEqual(callsTo("/external-log-submissions").length, 0);
});

test("详情：写日志按钮只给能写的人，已归档的项目不显示", async () => {
  setDetailResponses();
  assert.strictEqual((await openDetail({ id: "7", readonly: "0" })).data.canWriteLog, true);
  assert.strictEqual((await openDetail({ id: "7", readonly: "1" })).data.canWriteLog, false);

  setDetailResponses({ status: "archived" });
  assert.strictEqual((await openDetail({ id: "7", readonly: "0" })).data.canWriteLog, false);
});

test("详情：重试时先回到加载状态", async () => {
  setDetailResponses();
  state.failures["/api/v1/project/7"] = "超时";
  const page = await openDetail();
  assert.strictEqual(page.data.pageState, "error");

  state.failures = {};
  const retrying = page.loadData();
  assert.strictEqual(page.data.pageState, "loading");
  await retrying;
  assert.strictEqual(page.data.pageState, "ready");
});

test("详情：写日志和进标段带上项目号；只读标记传到标段页", async () => {
  setDetailResponses();
  const page = await openDetail({ id: "7", readonly: "1" });
  assert.strictEqual(page.data.readonly, true);

  page.openSectionPage(eventWith({ id: 1 }));
  page.goCreateManagerLog();
  assert.deepStrictEqual(state.navigations, [
    "/packageProject/project-section/index?projectId=7&sectionId=1&readonly=1",
    "/pages/manager-log/index?projectId=7"
  ]);
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
  console.log(`project-pages: ${tests.length} ok`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
