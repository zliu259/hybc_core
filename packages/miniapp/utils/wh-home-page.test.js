/** 库房 tab 页的流程测试：真实页面代码 + 真实视图模型。运行：node utils/wh-home-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("../packageWarehouse/common/wh-test-harness");

const HOME = {
  success: true,
  data: {
    caps: { is_keeper: true, can_create_kit: true },
    my_tasks: {
      todo: 2,
      items: [{ id: 9, title: "返库检查", device_code: "DG-01", device_name: "顶管机", due_date: "2026-11-10" }]
    },
    my_projects: [],
    keeper: { kits_to_confirm: 1, tasks_to_confirm: 0, tasks_unassigned: 0, tasks_overdue: 0, low_stock_count: 0 }
  }
};

const setup = () => {
  const h = createPageHarness({ page: "pages/warehouse/index" });
  h.respond("GET", "/api/v1/warehouse/home", HOME);
  return h;
};

runTests("wh-home-page", [
  [
    "打开页面取首页数据",
    async () => {
      const h = setup();
      const page = await h.open();
      assert.deepStrictEqual(h.callsTo("GET", "/api/v1/warehouse/home").length, 1);
      assert.strictEqual(page.data.view.myTasks.count, 2);
      assert.strictEqual(page.data.view.tiles.length, 5);
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.loadFailed, false);
    }
  ],
  [
    "接口失败有提示，再次进入恢复",
    async () => {
      const h = createPageHarness({ page: "pages/warehouse/index" });
      h.failOnce("GET", "/api/v1/warehouse/home", "服务器出错，请稍后重试", 500);
      const page = await h.open();
      assert.strictEqual(page.data.loadFailed, true);
      assert.strictEqual(page.data.loading, false);
      assert.deepStrictEqual(h.state.toasts, ["服务器出错，请稍后重试"]);

      h.respond("GET", "/api/v1/warehouse/home", HOME);
      await page.onShow();
      await h.flush();
      assert.strictEqual(page.data.loadFailed, false);
      assert.strictEqual(page.data.view.myTasks.count, 2);
    }
  ],
  [
    "刷新失败时保留原来的内容",
    async () => {
      const h = setup();
      const page = await h.open();
      h.failOnce("GET", "/api/v1/warehouse/home", "网络连接失败");
      await page.onPullDownRefresh();
      await h.flush();
      assert.strictEqual(page.data.loadFailed, true);
      assert.strictEqual(page.data.view.myTasks.count, 2);
      assert.strictEqual(h.state.pullStops, 1);
    }
  ],
  [
    "扫到设备码进设备页",
    async () => {
      const h = setup();
      h.respond("GET", "/device/by-code/DG-01", { success: true, data: { id: 7, device_code: "DG-01" } });
      const page = await h.open();
      h.state.scans = ["HYBC:D:DG-01"];
      await page.onScan();
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/device/index?id=7"]);
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "扫到的不是设备码：提示，不跳转，按钮恢复",
    async () => {
      const h = setup();
      const page = await h.open();
      h.state.scans = ["https://example.com"];
      await page.onScan();
      assert.deepStrictEqual(h.state.toasts, ["不是设备码"]);
      assert.deepStrictEqual(h.state.navigations, []);
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "设备码查不到、断网：各有提示，按钮恢复",
    async () => {
      const h = setup();
      h.fail("GET", "/device/by-code/DG-99", "设备不存在", 404);
      h.fail("GET", "/device/by-code/DG-50", "网络连接失败");
      const page = await h.open();
      h.state.scans = ["HYBC:D:DG-99", "HYBC:D:DG-50"];
      await page.onScan();
      await page.onScan();
      assert.deepStrictEqual(h.state.toasts, ["没有这台设备：DG-99", "网络连接失败"]);
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "取消扫码不提示",
    async () => {
      const h = setup();
      const page = await h.open();
      await page.onScan();
      assert.deepStrictEqual(h.state.toasts, []);
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "搜设备，点结果进设备页",
    async () => {
      const h = setup();
      h.respond("GET", "/api/v1/warehouse/device?", {
        success: true,
        data: [{ id: 7, device_code: "DG-01", name: "顶管机", state_label: "可用" }]
      });
      const page = await h.open();
      page.onSearchInput(h.event({}, { value: "DG" }));
      await h.flush(350);
      assert.deepStrictEqual(
        h.callsTo("GET", "/api/v1/warehouse/device?").map((call) => call.path),
        ["/api/v1/warehouse/device?keyword=DG&pageSize=10"]
      );
      assert.deepStrictEqual(page.data.searchResults, [
        { id: 7, code: "DG-01", name: "顶管机", stateLabel: "可用" }
      ]);

      page.onPickDevice(h.event({ id: 7 }));
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/device/index?id=7"]);
      assert.deepStrictEqual(page.data.searchResults, []);
      assert.strictEqual(page.data.keyword, "");
    }
  ],
  [
    "连续输入只查最后一次；清空输入收起结果",
    async () => {
      const h = setup();
      h.respond("GET", "/api/v1/warehouse/device?", { success: true, data: [] });
      const page = await h.open();
      page.onSearchInput(h.event({}, { value: "D" }));
      page.onSearchInput(h.event({}, { value: "DG" }));
      await h.flush(350);
      assert.strictEqual(h.callsTo("GET", "/api/v1/warehouse/device?").length, 1);
      assert.strictEqual(page.data.searched, true);

      page.onSearchInput(h.event({}, { value: "  " }));
      await h.flush(350);
      assert.strictEqual(h.callsTo("GET", "/api/v1/warehouse/device?").length, 1);
      assert.strictEqual(page.data.searched, false);
    }
  ],
  [
    "点数字、动作、任务、项目各去对应的页面",
    async () => {
      const h = setup();
      const page = await h.open();
      page.goTo(h.event({ url: "/packageWarehouse/kit-list/index?status=submitted" }));
      page.openTask(h.event({ id: 9 }));
      page.openProject(h.event({ id: 3 }));
      page.goTo(h.event({}));
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/kit-list/index?status=submitted",
        "/packageWarehouse/task-detail/index?id=9",
        "/packageWarehouse/project/index?projectId=3"
      ]);
    }
  ]
]);
