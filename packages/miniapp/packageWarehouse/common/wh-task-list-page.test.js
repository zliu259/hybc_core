/** 库房任务列表页的流程测试。运行：node packageWarehouse/common/wh-task-list-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const taskRow = (id, overrides = {}) => ({
  id,
  task_no: `KFR-${id}`,
  kind: "inspection",
  status: "todo",
  title: `任务 ${id}`,
  blocking: 1,
  required_photo_count: 0,
  photo_count: 0,
  assignee_userid: "wang",
  due_date: null,
  device_id: null,
  device_code: null,
  device_name: null,
  ...overrides
});

const pageOf = (ids, total) => ({
  success: true,
  data: ids.map((id) => taskRow(id)),
  pagination: { page: 1, pageSize: 20, total }
});

const setup = (caps) => {
  const h = createPageHarness({ page: "packageWarehouse/task-list/index" });
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  return h;
};

const listCalls = (h) => h.callsTo("GET", "/warehouse/task?").map((call) => call.path);

runTests("wh-task-list-page", [
  [
    "非库管只有我的页签，传别的页签也落到我的",
    async () => {
      const h = setup({ is_keeper: false });
      h.respond("GET", "/warehouse/task?", pageOf([1, 2], 2));
      const page = await h.open({ tab: "confirm" });
      assert.deepStrictEqual(page.data.tabs.map((tab) => tab.key), ["mine"]);
      assert.strictEqual(page.data.activeTab, "mine");
      assert.deepStrictEqual(listCalls(h), ["/api/v1/warehouse/task?scope=mine&status=todo&page=1&pageSize=20"]);
      assert.strictEqual(page.data.rows.length, 2);
      assert.strictEqual(page.data.canCreate, false);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "库管按参数进待确认，切到待派工时列表换掉",
    async () => {
      const h = setup({ is_keeper: true });
      h.respond("GET", "/warehouse/task?", (call) =>
        call.path.includes("assigned=no") ? pageOf([7], 1) : pageOf([1, 2, 3], 3)
      );
      const page = await h.open({ tab: "confirm" });
      assert.strictEqual(page.data.tabs.length, 4);
      assert.strictEqual(page.data.activeTab, "confirm");
      assert.strictEqual(listCalls(h)[0], "/api/v1/warehouse/task?status=submitted&page=1&pageSize=20");
      assert.strictEqual(page.data.canCreate, true);

      await page.onTab(h.event({ key: "unassigned" }));
      assert.strictEqual(listCalls(h)[1], "/api/v1/warehouse/task?status=todo&assigned=no&page=1&pageSize=20");
      assert.deepStrictEqual(page.data.rows.map((row) => row.id), [7]);
      assert.strictEqual(page.data.activeTab, "unassigned");
    }
  ],
  [
    "触底加载下一页并追加，取完后不再请求",
    async () => {
      const h = setup({ is_keeper: true });
      h.respond("GET", "/warehouse/task?", (call) =>
        call.path.includes("page=2") ? pageOf([21, 22], 22) : pageOf(Array.from({ length: 20 }, (_, i) => i + 1), 22)
      );
      const page = await h.open({ tab: "all" });
      assert.strictEqual(page.data.rows.length, 20);
      assert.strictEqual(page.data.finished, false);
      await page.onReachBottom();
      assert.strictEqual(listCalls(h)[1], "/api/v1/warehouse/task?page=2&pageSize=20");
      assert.strictEqual(page.data.rows.length, 22);
      assert.strictEqual(page.data.finished, true);
      await page.onReachBottom();
      assert.strictEqual(listCalls(h).length, 2);
    }
  ],
  [
    "加载失败有提示，忙碌状态复位",
    async () => {
      const h = setup({ is_keeper: false });
      h.fail("GET", "/warehouse/task?", "网络连接失败");
      const page = await h.open({});
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.loadFailed, true);
    }
  ],
  [
    "从详情回来时刷新第一页",
    async () => {
      const h = setup({ is_keeper: false });
      h.respond("GET", "/warehouse/task?", pageOf([1], 1));
      const page = await h.open({});
      await page.onShow();
      assert.strictEqual(listCalls(h).length, 2);
      assert.strictEqual(page.data.rows.length, 1);
      assert.strictEqual(h.callsTo("GET", "/warehouse/me").length, 1);
    }
  ],
  [
    "点任务进详情，新建任务进新建页",
    async () => {
      const h = setup({ is_keeper: true });
      h.respond("GET", "/warehouse/task?", pageOf([1], 1));
      const page = await h.open({});
      page.openTask(h.event({ id: 1 }));
      page.goNew();
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/task-detail/index?id=1",
        "/packageWarehouse/task-new/index"
      ]);
    }
  ]
]);
