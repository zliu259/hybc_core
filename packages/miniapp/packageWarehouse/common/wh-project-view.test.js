/** 项目在场页和库存页的视图模型。运行：node packageWarehouse/common/wh-project-view.test.js */
const assert = require("assert");

const { buildProjectView, toMaterialRow } = require("./wh-project-view");

const caps = (patch = {}) => ({ is_keeper: false, can_create_kit: false, ...patch });
const KEEPER = { userid: "lz", roles: ["operator"], caps: caps({ is_keeper: true, can_create_kit: true }) };
const MANAGER = { userid: "mg", roles: ["manager"], caps: caps({ can_create_kit: true }) };
const LEAD = { userid: "zhang", roles: ["site_manager"], caps: caps({ can_create_kit: true }) };
const OTHER_LEAD = { userid: "li", roles: ["site_manager"], caps: caps({ can_create_kit: true }) };
const OPERATOR = { userid: "op", roles: ["operator"], caps: caps() };

const material = (overrides = {}) => ({
  material_id: 1, material_code: "M-1", name: "排泥钢管", spec: "Φ114", unit: "根", category: "顶进设备", kind: "turnover",
  planned: 120, shipped: 100, transferred_out: 0, returned: 15, lost: 5, on_site: 80, first_out_at: null, last_back_at: null, loss_amount: 0,
  ...overrides
});

const ledger = {
  project_id: 3,
  project_name: "一号工程",
  project_manager_userid: "zhang",
  settled: false,
  devices_on_site: 1,
  turnover_kinds_on_site: 1,
  materials: [
    material(),
    material({ material_id: 2, name: "注浆管", spec: "DN25", on_site: 0, shipped: 30, returned: 30, lost: 0 }),
    material({ material_id: 3, name: "膨润土", spec: "", unit: "袋", kind: "consumable", on_site: null, shipped: 50, returned: 0, lost: 0 })
  ],
  device_categories: [],
  devices: [{ id: 7, device_code: "DG-01", name: "顶管机", state: "on_project", state_label: "在项目" }],
  kits: [
    { id: 5, kit_no: "PT-1", title: "主清单", status: "confirmed", confirmed_at: "2026-11-12T03:00:00.000Z" },
    { id: 6, kit_no: "PT-2", title: "追加", status: "draft", confirmed_at: null }
  ]
};

const docs = [
  { id: 50, doc_no: "KF-3", doc_type: "transfer", occurred_at: "2026-11-12T01:05:00.000Z", project_name: "一号工程", to_project_name: "二号工程", line_count: 5, reverses_doc_id: null, reversed_by_doc_no: null },
  { id: 49, doc_no: "KF-2", doc_type: "back", occurred_at: "2026-11-11T01:05:00.000Z", project_name: "一号工程", to_project_name: null, line_count: 2, reverses_doc_id: null, reversed_by_doc_no: "KF-4" },
  { id: 51, doc_no: "KF-4", doc_type: "back", occurred_at: "2026-11-11T02:00:00.000Z", project_name: "一号工程", to_project_name: null, line_count: 2, reverses_doc_id: 49, reversed_by_doc_no: null },
  { id: 48, doc_no: "KF-1", doc_type: "out", occurred_at: "2026-11-10T01:05:00.000Z", project_name: "一号工程", to_project_name: null, line_count: 12, reverses_doc_id: null, reversed_by_doc_no: null }
];

let view = buildProjectView(ledger, docs, KEEPER);
assert.strictEqual(view.projectName, "一号工程");
assert.strictEqual(view.settled, false);
assert.strictEqual(view.settledText, "设备 1 台、周转件 1 种在场");
assert.deepStrictEqual(view.devices, [{ id: 7, code: "DG-01", name: "顶管机", stateLabel: "在项目" }]);
// 只列还在场的周转件；退完的、耗材不列
assert.deepStrictEqual(view.materials, [
  { materialId: 1, label: "排泥钢管 Φ114", unit: "根", onSiteText: "80", shippedText: "100", returnedText: "15", lostText: "5" }
]);
assert.deepStrictEqual(view.kits, [
  { id: 5, kitNo: "PT-1", title: "主清单", statusLabel: "已确认", statusTheme: "success" },
  { id: 6, kitNo: "PT-2", title: "追加", statusLabel: "草稿", statusTheme: "default" }
]);
assert.deepStrictEqual(view.docs, [
  { id: 50, docNo: "KF-3", typeLabel: "项目间转场", timeText: "11-12 09:05", summary: "一号工程 → 二号工程 · 5 行", reversed: false },
  { id: 49, docNo: "KF-2", typeLabel: "项目返库", timeText: "11-11 09:05", summary: "2 行 · 已冲销", reversed: true },
  { id: 51, docNo: "KF-4", typeLabel: "项目返库", timeText: "11-11 10:00", summary: "2 行 · 冲销单", reversed: true },
  { id: 48, docNo: "KF-1", typeLabel: "发往项目", timeText: "11-10 09:05", summary: "12 行", reversed: false }
]);

// 按钮
assert.deepStrictEqual(view.actions, { canShip: true, canReturn: true, canTransfer: true, canCreateKit: true });
assert.deepStrictEqual(buildProjectView(ledger, docs, MANAGER).actions, { canShip: false, canReturn: false, canTransfer: false, canCreateKit: true });
assert.deepStrictEqual(buildProjectView(ledger, docs, LEAD).actions, { canShip: false, canReturn: false, canTransfer: false, canCreateKit: true });
assert.deepStrictEqual(buildProjectView(ledger, docs, OTHER_LEAD).actions, { canShip: false, canReturn: false, canTransfer: false, canCreateKit: false });
assert.deepStrictEqual(buildProjectView(ledger, docs, OPERATOR).actions, { canShip: false, canReturn: false, canTransfer: false, canCreateKit: false });

// 已结清：没有返库和转场可做
const settled = buildProjectView({ ...ledger, settled: true, devices_on_site: 0, turnover_kinds_on_site: 0, devices: [], materials: [] }, [], KEEPER);
assert.strictEqual(settled.settledText, "已结清");
assert.deepStrictEqual(settled.actions, { canShip: true, canReturn: false, canTransfer: false, canCreateKit: true });
assert.deepStrictEqual(settled.devices, []);
assert.deepStrictEqual(settled.docs, []);

// 项目物资没取到：上面三段是空的，库房单照常；按钮只留不依赖它的
const noLedger = buildProjectView(null, docs, KEEPER);
assert.strictEqual(noLedger.projectName, "");
assert.strictEqual(noLedger.settledText, "");
assert.deepStrictEqual(noLedger.devices, []);
assert.strictEqual(noLedger.docs.length, 4);
assert.deepStrictEqual(noLedger.actions, { canShip: true, canReturn: false, canTransfer: false, canCreateKit: false });
// 库房单没取到
assert.deepStrictEqual(buildProjectView(ledger, null, KEEPER).docs, []);

// 库存行
assert.deepStrictEqual(toMaterialRow({ id: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", quantity: 3, min_stock: 5 }), {
  id: 1,
  label: "排泥钢管 Φ114",
  unit: "根",
  kindLabel: "周转",
  quantityText: "3",
  low: true,
  minStockText: "最低 5"
});
assert.strictEqual(toMaterialRow({ id: 2, name: "膨润土", spec: "", unit: "袋", kind: "consumable", quantity: 5, min_stock: 5 }).low, true);
assert.strictEqual(toMaterialRow({ id: 2, name: "膨润土", spec: "", unit: "袋", kind: "consumable", quantity: 5.5, min_stock: 5 }).low, false);
const noMin = toMaterialRow({ id: 3, name: "扳手", spec: "", unit: "把", kind: "turnover", quantity: 0, min_stock: null });
assert.strictEqual(noMin.low, false);
assert.strictEqual(noMin.minStockText, "");
assert.strictEqual(noMin.label, "扳手");

console.log("wh-project-view tests passed");
