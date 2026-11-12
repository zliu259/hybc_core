/** 配套清单列表页的流程测试。运行：node packageWarehouse/common/wh-kit-list-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const kitRow = (id, overrides = {}) => ({
  id,
  kit_no: `PT-${id}`,
  title: "主清单",
  status: "submitted",
  project_id: 3,
  project_name: "一号工程",
  project_manager_userid: "zhang",
  line_count: 180,
  confirmed_at: null,
  close_reason: null,
  ...overrides
});

const listOf = (ids, total) => ({
  success: true,
  data: ids.map((id) => kitRow(id)),
  pagination: { page: 1, pageSize: 20, total }
});

const setup = (caps = { is_keeper: true, can_create_kit: true }) => {
  const h = createPageHarness({ page: "packageWarehouse/kit-list/index" });
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  h.respond("GET", "/warehouse/kit?", listOf([1, 2], 2));
  h.respond("GET", "/warehouse/kit-template", {
    success: true,
    data: [{ id: 11, name: "泥水平衡", status: "active" }, { id: 12, name: "土压平衡", status: "active" }]
  });
  return h;
};

const listCalls = (h) => h.callsTo("GET", "/warehouse/kit?").map((call) => call.path);

runTests("wh-kit-list-page", [
  [
    "按参数筛选状态，对应的页签选中",
    async () => {
      const h = setup();
      const page = await h.open({ status: "submitted" });
      assert.deepStrictEqual(listCalls(h), ["/api/v1/warehouse/kit?status=submitted&page=1&pageSize=20"]);
      assert.strictEqual(page.data.activeStatus, "submitted");
      assert.strictEqual(page.data.rows.length, 2);
      assert.strictEqual(page.data.rows[0].title, "PT-1 主清单");
      assert.strictEqual(page.data.canCreate, true);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "状态参数不认识时看全部；带项目参数只看这个项目",
    async () => {
      const h = setup();
      const page = await h.open({ status: "weird", projectId: "3" });
      assert.strictEqual(page.data.activeStatus, "");
      assert.deepStrictEqual(listCalls(h), ["/api/v1/warehouse/kit?project_id=3&page=1&pageSize=20"]);
    }
  ],
  [
    "切页签、触底加载",
    async () => {
      const h = setup();
      h.respond("GET", "/warehouse/kit?", (call) =>
        call.path.includes("page=2")
          ? listOf([21], 21)
          : listOf(Array.from({ length: 20 }, (_, i) => i + 1), 21)
      );
      const page = await h.open({});
      await page.onReachBottom();
      assert.strictEqual(page.data.rows.length, 21);
      assert.strictEqual(page.data.finished, true);
      await page.onReachBottom();
      assert.strictEqual(listCalls(h).length, 2);

      await page.onStatusTab(h.event({ key: "confirmed" }));
      assert.strictEqual(listCalls(h)[2], "/api/v1/warehouse/kit?status=confirmed&page=1&pageSize=20");
    }
  ],
  [
    "加载失败有提示",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/kit?", "网络连接失败");
      const page = await h.open({});
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.loadFailed, true);
    }
  ],
  [
    "带 create 参数：进页面就打开新建面板，项目已预选",
    async () => {
      const h = setup();
      const page = await h.open({ create: "1", projectId: "3" });
      assert.strictEqual(page.data.createOpen, true);
      assert.strictEqual(page.data.createForm.projectId, 3);
      assert.deepStrictEqual(page.data.templates.range, ["空白清单", "泥水平衡", "土压平衡"]);
      assert.strictEqual(page.data.createForm.title, "主清单");
    }
  ],
  [
    "新建：没选项目不提交；选好后提交并进新清单",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/kit", { success: true, data: { id: 31, kit_no: "PT-31" } });
      const page = await h.open({});
      await page.openCreate();
      await page.submitCreate();
      assert.deepStrictEqual(h.state.toasts, ["请选择项目"]);
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit"), []);

      page.onCreateProject(h.event({}, { projectId: 3, projectName: "一号工程" }));
      page.onTemplatePick(h.event({}, { value: 1 }));
      page.onCreateTitle(h.event({}, { value: " 追加 " }));
      await page.submitCreate();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit")[0].data, {
        project_id: 3,
        title: "追加",
        template_id: 11
      });
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/kit/index?id=31"]);
      assert.strictEqual(page.data.createOpen, false);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "新建空白清单不带模板；后端拒绝时提示后端的话，面板还在",
    async () => {
      const h = setup({ is_keeper: false, can_create_kit: true });
      h.fail("POST", "/warehouse/kit", "只能给自己负责的项目建清单", 403);
      const page = await h.open({});
      await page.openCreate();
      page.onCreateProject(h.event({}, { projectId: 4, projectName: "二号工程" }));
      await page.submitCreate();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit")[0].data, { project_id: 4, title: "主清单" });
      assert.deepStrictEqual(h.state.toasts, ["只能给自己负责的项目建清单"]);
      assert.strictEqual(page.data.createOpen, true);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "没有建清单权限：没有新建入口，create 参数也不打开面板",
    async () => {
      const h = setup({ is_keeper: false, can_create_kit: false });
      const page = await h.open({ create: "1" });
      assert.strictEqual(page.data.canCreate, false);
      assert.strictEqual(page.data.createOpen, false);
    }
  ],
  [
    "点清单进详情",
    async () => {
      const h = setup();
      const page = await h.open({});
      page.openKit(h.event({ id: 2 }));
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/kit/index?id=2"]);
    }
  ]
]);
