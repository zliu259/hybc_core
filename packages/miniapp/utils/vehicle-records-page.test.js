/**
 * 「我的车辆记录」三个页面和油卡申请页「去补充资料」带入的流程测试：
 * 真实页面代码 + 真实视图模型，只替换接口、附件打开和 wx。运行：node utils/vehicle-records-page.test.js
 * 界面仍要在开发者工具和真机上看。
 */
const assert = require("assert");
const path = require("path");

const state = {};

const resetState = () => {
  state.calls = [];
  state.responses = {};
  state.failures = {};
  state.deferred = [];
  state.holdPaths = [];
  state.navigations = [];
  state.toasts = [];
  state.opened = [];
  state.pullStops = 0;
};

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const findResponse = (requestPath) => {
  const failKey = Object.keys(state.failures).find((item) => requestPath.includes(item));
  if (failKey) return { error: new Error(state.failures[failKey]) };
  // 最长的匹配优先，「/fuel-applications/12」不会被「/fuel-applications」截走
  const key = Object.keys(state.responses)
    .filter((item) => requestPath.includes(item))
    .sort((a, b) => b.length - a.length)[0];
  return { value: key ? state.responses[key] : { success: true, data: [] } };
};

stub("./request.js", {
  request: ({ path: requestPath }) => {
    state.calls.push(requestPath);
    const result = findResponse(requestPath);
    const settle = () => (result.error ? Promise.reject(result.error) : Promise.resolve(result.value));
    if (state.holdPaths.some((item) => requestPath.includes(item))) {
      return new Promise((resolve, reject) => {
        state.deferred.push({ path: requestPath, release: () => settle().then(resolve, reject) });
      });
    }
    return settle();
  },
  buildUrl: (value) => `https://api.test${value}`
});

stub("./attachment-open.js", {
  ...require("./attachment-open.js"),
  openQueryAttachment: async (file, tag) => {
    state.opened.push({ ...file, tag });
  }
});

global.wx = {
  navigateTo: ({ url }) => state.navigations.push(url),
  stopPullDownRefresh: () => {
    state.pullStops += 1;
  },
  showToast: ({ title }) => state.toasts.push(title),
  showLoading: () => {},
  hideLoading: () => {}
};

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};

const flush = async () => {
  for (let index = 0; index < 10; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** 简化版 setData：支持「a.b.c」路径写法，和小程序一样按路径改嵌套字段 */
const applyPatch = (data, patch) =>
  Object.keys(patch).reduce((acc, key) => {
    const parts = key.split(".");
    const write = (target, index) => {
      const part = parts[index];
      if (index === parts.length - 1) return { ...target, [part]: patch[key] };
      return { ...target, [part]: write(target[part] || {}, index + 1) };
    };
    return write(acc, 0);
  }, data);

const loadPage = (relativePath) => {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  delete require.cache[resolved];
  delete require.cache[require.resolve(path.join(__dirname, "./user-names.js"))];
  require(resolved);
  return {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch, callback) {
      this.data = applyPatch(this.data, patch);
      if (callback) callback();
    }
  };
};

const openPage = async (relativePath, options = {}) => {
  const page = loadPage(relativePath);
  if (page.onLoad) page.onLoad(options);
  if (page.onShow) page.onShow();
  await flush();
  return page;
};

const fuelRow = (id, fields = {}) => ({
  id,
  application_no: `FQ-${id}`,
  applicant_userid: "driver-a",
  vehicle_id: 3,
  fuel_card_id: 5,
  requested_amount: 100 * id,
  vehicle_mileage_km: 1000 + id,
  photo_keys_json: null,
  status: "pending",
  requested_at: "2026-11-08T01:00:00.000Z",
  current_plate_no: "粤B12345",
  card_no: "CARD-001",
  ...fields
});

const maintenanceRow = (id, fields = {}) => ({
  id,
  record_no: `VM-${id}`,
  vehicle_id: 3,
  maintenance_type: "routine",
  content: "换机油",
  mileage_km: 9000,
  cost: 300,
  serviced_at: "2026-11-01",
  attachments_json: null,
  status: "active",
  created_by_userid: "driver-a",
  created_at: "2026-11-01T02:00:00.000Z",
  current_plate_no: "粤B12345",
  ...fields
});

const fuelPage = (rows, total) => ({
  success: true,
  data: rows,
  pagination: { page: 1, pageSize: 20, total }
});

const LIST = "packageFinance/vehicle-records/index.js";
const FUEL_DETAIL = "packageFinance/fuel-record-detail/index.js";
const MAINT_DETAIL = "packageFinance/maintenance-record-detail/index.js";
const FUEL_APPLY = "packageFinance/fuel-apply/index.js";
const at = (file) => `../${file}`;
const eventWith = (dataset) => ({ currentTarget: { dataset } });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("列表：默认打开油卡页签，只请求本人第一页", async () => {
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(2), fuelRow(1)], 2);
  const page = await openPage(at(LIST));
  assert.strictEqual(page.data.tab, "fuel");
  assert.deepStrictEqual(state.calls, ["/api/v1/fleet/fuel-applications?mine=true&page=1&pageSize=20"]);
  const fuel = page.data.tabs.fuel;
  assert.deepStrictEqual(fuel.list.map((item) => item.title), ["FQ-2", "FQ-1"]);
  assert.strictEqual(fuel.total, 2);
  assert.strictEqual(fuel.loading, false);
  assert.strictEqual(fuel.loaded, true);
});

test("列表：切到保养页签取保养记录和类型字典，切回油卡不重复请求", async () => {
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(1)], 1);
  state.responses["/fleet/maintenance"] = fuelPage([maintenanceRow(7)], 1);
  state.responses["/dict"] = { success: true, data: [{ dict_value: "routine", dict_label: "常规保养" }] };
  const page = await openPage(at(LIST));
  state.calls = [];
  page.switchTab(eventWith({ tab: "maintenance" }));
  await flush();
  assert.deepStrictEqual(state.calls.sort(), [
    "/api/v1/dict?dict_type=vehicle_maintenance_type",
    "/api/v1/fleet/maintenance?mine=true&page=1&pageSize=20"
  ]);
  assert.strictEqual(page.data.tabs.maintenance.list[0].metaText, "粤B12345 ｜ 常规保养 ｜ 9,000 km");
  state.calls = [];
  page.switchTab(eventWith({ tab: "fuel" }));
  await flush();
  assert.deepStrictEqual(state.calls, []);
  page.switchTab(eventWith({ tab: "nonsense" }));
  assert.strictEqual(page.data.tab, "fuel");
});

test("列表：带 tab=maintenance 进来直接看保养", async () => {
  const page = await openPage(at(LIST), { tab: "maintenance" });
  assert.strictEqual(page.data.tab, "maintenance");
  assert.ok(state.calls.some((item) => item.startsWith("/api/v1/fleet/maintenance?mine=true")));
});

test("列表：按状态筛选从第一页重新取", async () => {
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(1)], 1);
  const page = await openPage(at(LIST));
  state.calls = [];
  page.onStatusChange({ detail: { value: 2 } });
  await flush();
  assert.deepStrictEqual(state.calls, [
    "/api/v1/fleet/fuel-applications?mine=true&page=1&pageSize=20&status=needs_info"
  ]);
});

test("列表：翻页接在后面、按 id 去重，取完了不再请求", async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => fuelRow(30 - index));
  state.responses["/fleet/fuel-applications"] = fuelPage(firstPage, 22);
  const page = await openPage(at(LIST));
  // 第二页带回一条第一页已有的（翻页期间有新单插入）
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(11), fuelRow(10), fuelRow(9)], 22);
  state.calls = [];
  page.onReachBottom();
  await flush();
  assert.deepStrictEqual(state.calls, ["/api/v1/fleet/fuel-applications?mine=true&page=2&pageSize=20"]);
  const fuel = page.data.tabs.fuel;
  assert.strictEqual(fuel.list.length, 22);
  assert.strictEqual(new Set(fuel.list.map((item) => item.id)).size, 22);
  assert.strictEqual(fuel.page, 2);
  state.calls = [];
  page.onReachBottom();
  await flush();
  assert.deepStrictEqual(state.calls, []);
});

test("列表：旧接口不分页时整表当一页，不会一直翻", async () => {
  state.responses["/fleet/fuel-applications"] = { success: true, data: [fuelRow(2), fuelRow(1)] };
  const page = await openPage(at(LIST));
  assert.strictEqual(page.data.tabs.fuel.total, 2);
  state.calls = [];
  page.onReachBottom();
  await flush();
  assert.deepStrictEqual(state.calls, []);
});

test("列表：晚到的旧结果不覆盖新筛选的结果", async () => {
  state.holdPaths = ["/fleet/fuel-applications"];
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(1, { status: "pending" })], 1);
  const page = await openPage(at(LIST));
  // 桩在发请求时就定下返回值：第二个请求（筛「已通过」）拿到的是已通过的单子
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(5, { status: "processed" })], 1);
  page.onStatusChange({ detail: { value: 3 } });
  await flush();
  assert.strictEqual(state.deferred.length, 2);
  await state.deferred[1].release();
  await flush();
  await state.deferred[0].release();
  await flush();
  assert.deepStrictEqual(page.data.tabs.fuel.list.map((item) => item.id), [5]);
  assert.strictEqual(page.data.tabs.fuel.loading, false);
});

test("列表：第一页失败显示错误，重试成功后恢复", async () => {
  state.failures["/fleet/fuel-applications"] = "网络不稳定";
  const page = await openPage(at(LIST));
  assert.strictEqual(page.data.tabs.fuel.errorText, "网络不稳定");
  assert.deepStrictEqual(page.data.tabs.fuel.list, []);
  delete state.failures["/fleet/fuel-applications"];
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(1)], 1);
  page.retry();
  await flush();
  assert.strictEqual(page.data.tabs.fuel.errorText, "");
  assert.strictEqual(page.data.tabs.fuel.list.length, 1);
});

test("列表：翻页失败只提示，已加载的保留", async () => {
  state.responses["/fleet/fuel-applications"] = fuelPage(
    Array.from({ length: 20 }, (_, index) => fuelRow(40 - index)),
    30
  );
  const page = await openPage(at(LIST));
  state.failures["/fleet/fuel-applications"] = "超时";
  page.onReachBottom();
  await flush();
  assert.strictEqual(page.data.tabs.fuel.list.length, 20);
  assert.deepStrictEqual(state.toasts, ["超时"]);
});

test("列表：点卡片进对应详情，新建按钮按页签去提交页，下拉刷新会收起", async () => {
  state.responses["/fleet/fuel-applications"] = fuelPage([fuelRow(12)], 1);
  const page = await openPage(at(LIST));
  page.goDetail(eventWith({ id: 12 }));
  page.goCreate();
  page.setData({ tab: "maintenance" });
  page.goDetail(eventWith({ id: 7 }));
  page.goCreate();
  page.goDetail(eventWith({ id: "" }));
  assert.deepStrictEqual(state.navigations, [
    "/packageFinance/fuel-record-detail/index?id=12",
    "/packageFinance/fuel-apply/index",
    "/packageFinance/maintenance-record-detail/index?id=7",
    "/packageFinance/vehicle-maintenance/index"
  ]);
  page.onPullDownRefresh();
  await flush();
  assert.strictEqual(state.pullStops, 1);
});

test("油卡详情：取单张申请和通讯录，处理人显示姓名", async () => {
  state.responses["/fleet/fuel-applications/12"] = {
    success: true,
    data: fuelRow(12, {
      status: "processed",
      processed_by_userid: "ZhangSan",
      processed_at: "2026-11-08T03:00:00.000Z",
      latest_card_balance: 800,
      photo_keys_json: '["fuel-application/x.jpg"]'
    })
  };
  state.responses["/wecom/contacts"] = { success: true, data: { users: [{ userid: "ZhangSan", name: "张三" }] } };
  const page = await openPage(at(FUEL_DETAIL), { id: "12" });
  assert.ok(state.calls.includes("/api/v1/fleet/fuel-applications/12"));
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.detail.handleFacts[0].value, "张三");
  page.openPhoto(eventWith({ key: "fuel-application/x.jpg", url: "", name: "现场照片 1.jpg" }));
  assert.deepStrictEqual(state.opened, [
    { key: "fuel-application/x.jpg", url: "", name: "现场照片 1.jpg", tag: "fuel-record-detail" }
  ]);
  page.goResubmit();
  assert.deepStrictEqual(state.navigations, [], "已通过的申请不能去补充");
});

test("油卡详情：待补充时去补充资料带上申请编号", async () => {
  state.responses["/fleet/fuel-applications/12"] = {
    success: true,
    data: fuelRow(12, { status: "needs_info", needs_info_reason: "补照片" })
  };
  const page = await openPage(at(FUEL_DETAIL), { id: "12" });
  assert.strictEqual(page.data.detail.canResubmit, true);
  page.goResubmit();
  assert.deepStrictEqual(state.navigations, ["/packageFinance/fuel-apply/index?resubmit=12"]);
});

test("油卡详情：看不了时显示接口的原话，编号不对不发请求", async () => {
  state.failures["/fleet/fuel-applications/13"] = "无权查看";
  const page = await openPage(at(FUEL_DETAIL), { id: "13" });
  assert.strictEqual(page.data.detailState, "error");
  assert.strictEqual(page.data.detailErrorText, "无权查看");
  state.calls = [];
  const bad = await openPage(at(FUEL_DETAIL), { id: "abc" });
  assert.strictEqual(bad.data.detailState, "error");
  assert.deepStrictEqual(state.calls, []);
});

test("保养详情：取记录和类型字典；字典失败也能看", async () => {
  state.responses["/fleet/maintenance/7"] = {
    success: true,
    data: maintenanceRow(7, {
      attachments_json: JSON.stringify([{ file_key: "vehicle-maintenance/a.pdf", file_name: "结算单.pdf" }])
    })
  };
  state.failures["/dict"] = "字典挂了";
  const page = await openPage(at(MAINT_DETAIL), { id: "7" });
  assert.ok(state.calls.includes("/api/v1/fleet/maintenance/7"));
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.detail.facts[1].value, "routine");
  page.openAttachment(eventWith({ key: "vehicle-maintenance/a.pdf", url: "", name: "结算单.pdf" }));
  assert.strictEqual(state.opened[0].tag, "maintenance-record-detail");
});

const fuelApplyResponses = (applications) => {
  state.responses["/fleet/vehicles"] = { success: true, data: [{ id: 3, current_plate_no: "粤B12345" }] };
  state.responses["/fleet/fuel-applications?mine=true"] = { success: true, data: applications };
};

test("油卡申请页：带 resubmit 进来，待补充的单子自动带入", async () => {
  fuelApplyResponses([
    fuelRow(12, { status: "needs_info", vehicle_mileage_km: 2000, requested_amount: 600 }),
    fuelRow(11)
  ]);
  const page = await openPage(at(FUEL_APPLY), { resubmit: "12" });
  assert.strictEqual(page.data.resubmitApplicationId, "12");
  assert.strictEqual(page.data.form.vehicle_id, 3);
  assert.strictEqual(page.data.form.fuel_card_id, 5);
  assert.strictEqual(page.data.form.requested_amount, 600);
  assert.strictEqual(page.data.vehicleIndex, 1);
  assert.deepStrictEqual(state.toasts, []);
  // 再次显示（比如从选图回来）不会重复带入或提示
  page.onShow();
  await flush();
  assert.deepStrictEqual(state.toasts, []);
});

test("油卡申请页：单子不在待补充时提示，不带入", async () => {
  fuelApplyResponses([fuelRow(12, { status: "processed" })]);
  const page = await openPage(at(FUEL_APPLY), { resubmit: "12" });
  assert.strictEqual(page.data.resubmitApplicationId, "");
  assert.deepStrictEqual(state.toasts, ["这张申请现在不需要补充资料"]);
});

test("油卡申请页：记录没取到时提示去下方操作；参数不对就当普通进入", async () => {
  state.failures["/fleet/fuel-applications?mine=true"] = "超时";
  const page = await openPage(at(FUEL_APPLY), { resubmit: "12" });
  assert.strictEqual(page.data.resubmitApplicationId, "");
  assert.strictEqual(state.toasts.length, 1);
  resetState();
  fuelApplyResponses([fuelRow(12, { status: "needs_info" })]);
  const plain = await openPage(at(FUEL_APPLY), { resubmit: "12abc" });
  assert.strictEqual(plain.data.resubmitApplicationId, "");
  assert.deepStrictEqual(state.toasts, []);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    resetState();
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  if (failed) {
    console.error(`${failed} 个用例失败`);
    process.exit(1);
  }
  console.log(`全部 ${tests.length} 个用例通过`);
})();
