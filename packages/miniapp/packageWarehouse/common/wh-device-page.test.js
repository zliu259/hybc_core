/** 设备卡片页的流程测试。运行：node packageWarehouse/common/wh-device-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const DETAIL = {
  id: 7,
  device_code: "DG-01",
  name: "顶管机",
  alias: null,
  state: "on_project",
  state_label: "在项目",
  location: "project",
  project_name: "一号工程",
  current_project_id: 3,
  storage_note: null,
  category_name: "顶管机",
  spec: "DN1200",
  model: null,
  open_tasks: [{ id: 11, task_no: "KFR-1", kind: "inspection", status: "todo", title: "返库检查", blocking: 1 }],
  events: Array.from({ length: 12 }, (_, index) => ({
    id: 100 - index,
    summary: `记事 ${index}`,
    operator_userid: "lz",
    occurred_at: "2026-11-12T01:05:00.000Z"
  })),
  usage_records: [],
  usage_meters_total: 0
};

const setup = (caps = { is_keeper: true }) => {
  const h = createPageHarness({ page: "packageWarehouse/device/index" });
  h.respond("GET", "/warehouse/device/7", { success: true, data: DETAIL });
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  h.respond("GET", "/wecom/contacts", { success: true, data: { users: [{ userid: "lz", name: "李震" }] } });
  return h;
};

runTests("wh-device-page", [
  [
    "打开页面取设备和权限",
    async () => {
      const h = setup();
      const page = await h.open({ id: "7" });
      assert.strictEqual(h.callsTo("GET", "/warehouse/device/7").length, 1);
      assert.strictEqual(h.callsTo("GET", "/warehouse/me").length, 1);
      assert.strictEqual(page.data.view.header.code, "DG-01");
      assert.strictEqual(page.data.view.actions.canReturn, true);
      assert.strictEqual(page.data.view.timeline[0].operatorName, "李震");
      assert.strictEqual(page.data.loading, false);
      assert.deepStrictEqual(h.state.titles, ["DG-01"]);
    }
  ],
  [
    "时间线默认 10 条，点展开看全部",
    async () => {
      const h = setup();
      const page = await h.open({ id: "7" });
      assert.strictEqual(page.data.timeline.length, 10);
      assert.strictEqual(page.data.hiddenEvents, 2);
      page.toggleEvents();
      assert.strictEqual(page.data.timeline.length, 12);
      assert.strictEqual(page.data.hiddenEvents, 0);
    }
  ],
  [
    "设备不存在",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/device/index" });
      h.fail("GET", "/warehouse/device/7", "设备不存在", 404);
      const page = await h.open({ id: "7" });
      assert.strictEqual(page.data.notFound, true);
      assert.strictEqual(page.data.loading, false);
      assert.deepStrictEqual(h.state.toasts, ["设备不存在"]);
    }
  ],
  [
    "参数不对",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/device/index" });
      const page = await h.open({ id: "abc" });
      assert.strictEqual(page.data.notFound, true);
      assert.deepStrictEqual(h.state.calls, []);
    }
  ],
  [
    "返库：打开面板、确认、重新加载",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", {
        success: true,
        data: { id: 50, doc_no: "KF-20261112-001", replayed: false, created_task_ids: [21] }
      });
      const page = await h.open({ id: "7" });
      page.openReturn();
      assert.strictEqual(page.data.returnOpen, true);
      page.onReturnInput(h.event({ field: "usageMeters" }, { value: "120.5" }));
      page.onReturnInput(h.event({ field: "soilType" }, { value: "粉质黏土" }));
      await page.confirmReturn();
      await h.flush();
      const [post] = h.callsTo("POST", "/warehouse/doc");
      assert.deepStrictEqual(
        { ...post.data, client_request_id: "x" },
        {
          doc_type: "back",
          client_request_id: "x",
          project_id: 3,
          device_lines: [{ device_id: 7, usage_meters: 120.5, soil_type: "粉质黏土" }],
          material_lines: []
        }
      );
      assert.ok(post.data.client_request_id.length >= 8);
      assert.deepStrictEqual(h.state.toasts, ["已返库，已生成检查任务"]);
      assert.strictEqual(page.data.returnOpen, false);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/device/7").length, 2);
    }
  ],
  [
    "返库失败：提示、面板还在；再点一次用同一个请求号",
    async () => {
      const h = setup();
      h.failOnce("POST", "/warehouse/doc", "数据已变化，请刷新后重试", 409);
      h.respond("POST", "/warehouse/doc", {
        success: true,
        data: { id: 50, doc_no: "KF-1", replayed: true, created_task_ids: [] }
      });
      const page = await h.open({ id: "7" });
      page.openReturn();
      await page.confirmReturn();
      assert.deepStrictEqual(h.state.toasts, ["数据已变化，请刷新后重试"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(page.data.returnOpen, true);

      await page.confirmReturn();
      await h.flush();
      const posts = h.callsTo("POST", "/warehouse/doc");
      assert.strictEqual(posts.length, 2);
      assert.strictEqual(posts[0].data.client_request_id, posts[1].data.client_request_id);
      assert.strictEqual(page.data.returnOpen, false);
      assert.strictEqual(h.state.toasts[1], "已返库");

      // 下一次返库是新的请求号
      page.openReturn();
      await page.confirmReturn();
      const third = h.callsTo("POST", "/warehouse/doc")[2];
      assert.notStrictEqual(third.data.client_request_id, posts[0].data.client_request_id);
    }
  ],
  [
    "顶进距离填错不提交",
    async () => {
      const h = setup();
      const page = await h.open({ id: "7" });
      page.openReturn();
      page.onReturnInput(h.event({ field: "usageMeters" }, { value: "abc" }));
      await page.confirmReturn();
      assert.deepStrictEqual(h.state.toasts, ["顶进距离只填数字（米）"]);
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/doc"), []);
    }
  ],
  [
    "忙的时候再点确认不重复提交",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", {
        success: true,
        data: { id: 50, doc_no: "KF-1", replayed: false, created_task_ids: [] }
      });
      const page = await h.open({ id: "7" });
      page.openReturn();
      await Promise.all([page.confirmReturn(), page.confirmReturn()]);
      assert.strictEqual(h.callsTo("POST", "/warehouse/doc").length, 1);
    }
  ],
  [
    "记事：空的不提交，有内容就提交并刷新",
    async () => {
      const h = setup();
      const page = await h.open({ id: "7" });
      h.state.modalInput = "   ";
      await page.addNote();
      assert.deepStrictEqual(h.callsTo("POST", "/note"), []);

      h.state.modalInput = "换了液压油";
      await page.addNote();
      await h.flush();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/device/7/note")[0].data, { summary: "换了液压油" });
      assert.strictEqual(h.callsTo("GET", "/warehouse/device/7").length, 2);

      h.state.modalConfirm = false;
      await page.addNote();
      assert.strictEqual(h.callsTo("POST", "/warehouse/device/7/note").length, 1);
    }
  ],
  [
    "发货、建任务、看任务各去对应的页面",
    async () => {
      const h = setup();
      const page = await h.open({ id: "7" });
      page.goShip();
      page.goNewTask();
      page.openTask(h.event({ id: 11 }));
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/ship/index?type=out&deviceId=7",
        "/packageWarehouse/task-new/index?deviceId=7",
        "/packageWarehouse/task-detail/index?id=11"
      ]);
    }
  ],
  [
    "不是库管没有动作按钮",
    async () => {
      const h = setup({ is_keeper: false });
      const page = await h.open({ id: "7" });
      assert.deepStrictEqual(page.data.view.actions, {
        canReturn: false,
        canShip: false,
        canNote: false,
        canNewTask: false
      });
    }
  ]
]);
