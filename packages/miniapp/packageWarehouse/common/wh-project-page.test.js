/** 项目在场页的流程测试。运行：node packageWarehouse/common/wh-project-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const LEDGER = {
  project_id: 3,
  project_name: "一号工程",
  project_manager_userid: "zhang",
  settled: false,
  devices_on_site: 1,
  turnover_kinds_on_site: 1,
  materials: [{ material_id: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", shipped: 100, returned: 15, lost: 5, on_site: 80 }],
  device_categories: [],
  devices: [{ id: 7, device_code: "DG-01", name: "顶管机", state: "on_project", state_label: "在项目" }],
  kits: [{ id: 5, kit_no: "PT-1", title: "主清单", status: "confirmed", confirmed_at: "2026-11-12T03:00:00.000Z" }]
};
const DOCS = {
  success: true,
  data: [{ id: 48, doc_no: "KF-1", doc_type: "out", occurred_at: "2026-11-10T01:05:00.000Z", project_name: "一号工程", to_project_name: null, line_count: 12, reverses_doc_id: null, reversed_by_doc_no: null }]
};

const KEEPER = { profile: { username: "lz", roles: ["operator"] }, caps: { is_keeper: true, can_create_kit: true } };
const LEAD = { profile: { username: "zhang", roles: ["site_manager"] }, caps: { is_keeper: false, can_create_kit: true } };

const setup = (who = KEEPER, ledger = LEDGER) => {
  const h = createPageHarness({ page: "packageWarehouse/project/index", profile: who.profile });
  h.respond("GET", "/warehouse/project/3/ledger", { success: true, data: ledger });
  h.respond("GET", "/warehouse/doc?", DOCS);
  h.respond("GET", "/warehouse/me", { success: true, data: who.caps });
  return h;
};

runTests("wh-project-page", [
  [
    "打开：项目物资、清单、库房单都取到，标题是项目名",
    async () => {
      const h = setup();
      const page = await h.open({ projectId: "3" });
      assert.strictEqual(h.callsTo("GET", "/warehouse/project/3/ledger").length, 1);
      assert.deepStrictEqual(
        h.callsTo("GET", "/warehouse/doc?").map((call) => call.path),
        ["/api/v1/warehouse/doc?project_id=3&pageSize=10"]
      );
      assert.strictEqual(h.callsTo("GET", "/warehouse/me").length, 1);
      assert.strictEqual(page.data.view.devices.length, 1);
      assert.strictEqual(page.data.view.materials.length, 1);
      assert.strictEqual(page.data.view.kits.length, 1);
      assert.strictEqual(page.data.view.docs.length, 1);
      assert.strictEqual(page.data.ledgerFailed, false);
      assert.strictEqual(page.data.docsFailed, false);
      assert.strictEqual(page.data.loading, false);
      assert.deepStrictEqual(h.state.titles, ["一号工程"]);
    }
  ],
  [
    "项目物资取不到：上面几段标加载失败，库房单照常",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/project/3/ledger", "服务器出错，请稍后重试", 500);
      const page = await h.open({ projectId: "3" });
      assert.strictEqual(page.data.ledgerFailed, true);
      assert.strictEqual(page.data.docsFailed, false);
      assert.strictEqual(page.data.view.docs.length, 1);
      assert.deepStrictEqual(page.data.view.devices, []);
      assert.deepStrictEqual(h.state.toasts, ["服务器出错，请稍后重试"]);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "库房单取不到：只有那一段标加载失败",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/doc?", "网络连接失败");
      const page = await h.open({ projectId: "3" });
      assert.strictEqual(page.data.docsFailed, true);
      assert.strictEqual(page.data.ledgerFailed, false);
      assert.strictEqual(page.data.view.devices.length, 1);
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
    }
  ],
  [
    "库管：返库、发货、转场各去录单页；点设备、清单进各自的页面",
    async () => {
      const h = setup();
      const page = await h.open({ projectId: "3" });
      assert.deepStrictEqual(page.data.view.actions, { canShip: true, canReturn: true, canTransfer: true, canCreateKit: true });
      page.goShip(h.event({ type: "back" }));
      page.goShip(h.event({ type: "out" }));
      page.goShip(h.event({ type: "transfer" }));
      page.goShip(h.event({ type: "weird" }));
      page.openDevice(h.event({ id: 7 }));
      page.openKit(h.event({ id: 5 }));
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/ship/index?type=back&projectId=3",
        "/packageWarehouse/ship/index?type=out&projectId=3",
        "/packageWarehouse/ship/index?type=transfer&projectId=3",
        "/packageWarehouse/device/index?id=7",
        "/packageWarehouse/kit/index?id=5"
      ]);
    }
  ],
  [
    "已结清时库管没有返库和转场",
    async () => {
      const h = setup(KEEPER, { ...LEDGER, settled: true, devices_on_site: 0, turnover_kinds_on_site: 0, devices: [], materials: [] });
      const page = await h.open({ projectId: "3" });
      assert.strictEqual(page.data.view.settledText, "已结清");
      assert.strictEqual(page.data.view.actions.canReturn, false);
      assert.strictEqual(page.data.view.actions.canTransfer, false);
    }
  ],
  [
    "自己项目的现场负责人：新建清单",
    async () => {
      const h = setup(LEAD);
      const page = await h.open({ projectId: "3" });
      assert.deepStrictEqual(page.data.view.actions, { canShip: false, canReturn: false, canTransfer: false, canCreateKit: true });
      page.goCreateKit();
      page.goKitList();
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/kit-list/index?projectId=3&create=1",
        "/packageWarehouse/kit-list/index?projectId=3"
      ]);
    }
  ],
  [
    "参数不对",
    async () => {
      const h = setup();
      const page = await h.open({ projectId: "x" });
      assert.strictEqual(page.data.notFound, true);
      assert.deepStrictEqual(h.state.calls, []);
    }
  ]
]);
