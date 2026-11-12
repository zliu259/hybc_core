/** 配套清单页面的视图模型。规则和 Web 的 views/wh/kit/kit-view.ts 一样，用例也是照它搬的。运行：node packageWarehouse/common/wh-kit-view.test.js */
const assert = require("assert");

const {
  kitActions,
  kitLineProblems,
  rowProblems,
  saveProblems,
  toEditableLines,
  toKitLines,
  groupBySection,
  withFulfilment,
  newKitProblem,
  toKitListRow,
  buildKitHeader,
  KIT_STATUS_TABS,
  SOURCE_OPTIONS
} = require("./wh-kit-view");

const caps = (patch = {}) => ({ is_keeper: false, can_create_kit: false, ...patch });
const keeper = { userid: "kp", roles: ["operator"], caps: caps({ is_keeper: true, can_create_kit: true }) };
const manager = { userid: "mg", roles: ["manager"], caps: caps({ can_create_kit: true }) };
const lead = { userid: "lead", roles: ["site_manager"], caps: caps({ can_create_kit: true }) };
const operator = { userid: "op", roles: ["operator"], caps: caps() };
const kit = (status, managerUserid = "lead") => ({ status, project_manager_userid: managerUserid });
const none = (actions) => Object.values(actions).some(Boolean) === false;

// ---- 清单按钮（和 Web 同样的用例）
const draftActions = { canEdit: true, canSubmit: true, canConfirm: false, canDiscard: true, canClose: false, canShip: false };
assert.deepStrictEqual(kitActions(kit("draft"), keeper), draftActions);
assert.deepStrictEqual(kitActions(kit("draft"), manager), draftActions);
assert.deepStrictEqual(kitActions(kit("draft"), lead), draftActions);
assert.strictEqual(kitActions(kit("draft", "someone-else"), lead).canEdit, false);
assert.strictEqual(kitActions(kit("draft", null), lead).canEdit, false);
assert.ok(none(kitActions(kit("draft"), operator)));
assert.ok(none(kitActions(kit("draft"), { userid: "x", roles: [], caps: null })));

const submittedForKeeper = kitActions(kit("submitted"), keeper);
assert.deepStrictEqual(
  [submittedForKeeper.canEdit, submittedForKeeper.canSubmit, submittedForKeeper.canConfirm, submittedForKeeper.canDiscard],
  [true, false, true, true]
);
assert.strictEqual(kitActions(kit("submitted"), manager).canConfirm, false);
assert.strictEqual(kitActions(kit("submitted"), manager).canEdit, true);

assert.deepStrictEqual(kitActions(kit("confirmed"), keeper), {
  canEdit: false,
  canSubmit: false,
  canConfirm: false,
  canDiscard: false,
  canClose: true,
  canShip: true
});
assert.ok(none(kitActions(kit("confirmed"), manager)));
assert.ok(none(kitActions(kit("closed"), keeper)));

// ---- 提交前的行检查（和 Web 同样的用例）
const check = (patch = {}) => ({
  line_kind: "material",
  material_id: 3,
  name_text: "排泥钢管",
  planned_qty: 120,
  ...patch
});
assert.deepStrictEqual(
  kitLineProblems([
    check(),
    check({ material_id: null }),
    check({ material_id: null, planned_qty: 0 }),
    check({ line_kind: "device", material_id: null, planned_qty: 1.5 }),
    check({ name_text: " " }),
    check({ planned_qty: -1 }),
    check({ planned_qty: Number.NaN })
  ]),
  [
    { index: 1, message: "排泥钢管 还没选规格" },
    { index: 3, message: "设备数量必须是整数" },
    { index: 4, message: "品名不能为空" },
    { index: 5, message: "数量不对" },
    { index: 6, message: "数量不对" }
  ]
);

// ---- 接口的行 ↔ 页面上可编辑的行
const apiLines = [
  {
    id: 1, kit_id: 5, section: "顶进设备", sort_order: 0, line_kind: "device", device_category_id: 9, material_id: null,
    name_text: "顶管机", spec_text: "DN1200", unit: "台", planned_qty: 1, source: "warehouse", note: null,
    material_name: null, material_spec: null, material_unit: null, material_kind: null, category_name: "顶管机", spec_choices: []
  },
  {
    id: 2, kit_id: 5, section: "顶进设备", sort_order: 1, line_kind: "material", device_category_id: null, material_id: 3,
    name_text: "排泥钢管", spec_text: null, unit: "根", planned_qty: 120.5, source: "warehouse", note: "带法兰",
    material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", category_name: null,
    spec_choices: [{ id: 3, spec: "Φ114" }, { id: 4, spec: "Φ80" }]
  },
  {
    id: 3, kit_id: 5, section: "注浆设备", sort_order: 2, line_kind: "material", device_category_id: null, material_id: null,
    name_text: "注浆管", spec_text: null, unit: null, planned_qty: 30, source: "site_purchase", note: null,
    material_name: null, material_spec: null, material_unit: null, material_kind: null, category_name: null,
    spec_choices: [{ id: 7, spec: "DN25" }, { id: 8, spec: "DN32" }]
  },
  {
    id: 4, kit_id: 5, section: "注浆设备", sort_order: 3, line_kind: "text", device_category_id: null, material_id: null,
    name_text: "记得带图纸", spec_text: null, unit: null, planned_qty: 0, source: "warehouse", note: null,
    material_name: null, material_spec: null, material_unit: null, material_kind: null, category_name: null, spec_choices: []
  }
];
const rows = toEditableLines(apiLines);
assert.deepStrictEqual(rows[0], {
  key: "line-1",
  id: 1,
  section: "顶进设备",
  lineKind: "device",
  deviceCategoryId: 9,
  materialId: null,
  nameText: "顶管机",
  specText: "DN1200",
  unit: "台",
  unitText: "台",
  qty: "1",
  source: "warehouse",
  note: "",
  specChoices: [],
  specLabels: [],
  kindLabel: "设备",
  sourceLabel: "库房发",
  sourceIndex: 0,
  detailText: "顶管机 · DN1200",
  needsSpec: false
});
assert.strictEqual(rows[1].qty, "120.5");
assert.strictEqual(rows[1].detailText, "Φ114");
assert.strictEqual(rows[1].needsSpec, false);
assert.deepStrictEqual(rows[1].specLabels, ["Φ114", "Φ80"]);
assert.strictEqual(rows[2].needsSpec, true);
assert.strictEqual(rows[2].detailText, "");
assert.strictEqual(rows[2].sourceLabel, "现场采购");
assert.strictEqual(rows[2].sourceIndex, 1);
assert.strictEqual(rows[3].kindLabel, "备忘");
assert.strictEqual(rows[3].needsSpec, false);

// 往返：改都没改，PUT 的内容和接口给的一样
const strip = (line) => ({
  section: line.section,
  line_kind: line.line_kind,
  device_category_id: line.device_category_id,
  material_id: line.material_id,
  name_text: line.name_text,
  spec_text: line.spec_text,
  unit: line.unit,
  planned_qty: line.planned_qty,
  source: line.source,
  note: line.note
});
assert.deepStrictEqual(toKitLines(rows), apiLines.map(strip));
// 清单行没写单位时显示物资档案的单位，但不写回去
const borrowed = toEditableLines([{ ...apiLines[1], unit: null }])[0];
assert.strictEqual(borrowed.unitText, "根");
assert.strictEqual(toKitLines([borrowed])[0].unit, null);
// 数量清空按 0；设备行不带物资、物资行不带类别
assert.strictEqual(toKitLines([{ ...rows[1], qty: "" }])[0].planned_qty, 0);
assert.strictEqual(toKitLines([{ ...rows[0], materialId: 99 }])[0].material_id, null);
assert.strictEqual(toKitLines([{ ...rows[1], deviceCategoryId: 9 }])[0].device_category_id, null);

// 页面上的行直接查问题
assert.deepStrictEqual(rowProblems(rows), [{ index: 2, message: "注浆管 还没选规格" }]);
assert.deepStrictEqual(rowProblems([{ ...rows[2], qty: "0" }]), []);
assert.deepStrictEqual(rowProblems([{ ...rows[1], qty: "abc" }]), [{ index: 0, message: "数量不对" }]);
assert.deepStrictEqual(rowProblems([{ ...rows[0], qty: "1.5" }]), [{ index: 0, message: "设备数量必须是整数" }]);

// 保存前只拦数量填错的行；没选规格的草稿可以先存
assert.deepStrictEqual(saveProblems(rows), []);
assert.deepStrictEqual(
  saveProblems([{ ...rows[1], qty: "5." }, rows[2], { ...rows[0], qty: "1.5" }, { ...rows[1], qty: "1.2345" }]),
  [
    { index: 0, message: "数量不对" },
    { index: 2, message: "设备数量必须是整数" },
    { index: 3, message: "数量不对" }
  ]
);
// 数量填错的行不会被悄悄当成 0 发给后端
assert.ok(Number.isNaN(toKitLines([{ ...rows[1], qty: "5." }])[0].planned_qty));

// ---- 按分节分组
const groups = groupBySection(rows, rowProblems(rows));
assert.deepStrictEqual(
  groups.map((group) => [group.section, group.count, group.problemCount, group.rows.map((row) => row.index)]),
  [
    ["顶进设备", 2, 0, [0, 1]],
    ["注浆设备", 2, 1, [2, 3]]
  ]
);
assert.strictEqual(groups[1].rows[0].problem, "注浆管 还没选规格");
assert.strictEqual(groups[0].rows[0].problem, "");
// 分节交错出现时并到第一次出现的那组，行号还是原来的
const mixed = groupBySection([rows[0], rows[2], rows[1]], []);
assert.deepStrictEqual(mixed.map((group) => group.rows.map((row) => row.index)), [[0, 2], [1]]);
// 没写分节的归到"未分节"
assert.strictEqual(groupBySection([{ ...rows[0], section: "" }], [])[0].section, "未分节");

// ---- 执行情况
const fulfilled = withFulfilment(rows, [
  { id: 1, shipped: 1, pending: 0, in_stock: 2 },
  { id: 2, shipped: 40, pending: 80.5, in_stock: 100 },
  { id: 3, shipped: 0, pending: 0, in_stock: null },
  { id: 4, shipped: 0, pending: 0, in_stock: null }
]);
assert.deepStrictEqual(
  fulfilled.map((row) => [row.shippedText, row.pendingText, row.done]),
  [
    ["1", "0", true],
    ["40", "80.5", false],
    ["0", "0", false],
    ["", "", false]
  ]
);
// 执行情况里没有这一行（不该发生）时留空
assert.deepStrictEqual(
  withFulfilment([rows[0]], []).map((row) => [row.shippedText, row.pendingText, row.done]),
  [["", "", false]]
);

// ---- 新建清单
assert.strictEqual(newKitProblem({ projectId: null, title: "主清单" }), "请选择项目");
assert.strictEqual(newKitProblem({ projectId: 3, title: "  " }), "请填写清单标题");
assert.strictEqual(newKitProblem({ projectId: 3, title: "主清单" }), "");

// ---- 列表行和详情头部
const header = {
  id: 5, kit_no: "PT-20261112-001", title: "主清单", status: "submitted", project_id: 3, project_name: "一号工程",
  project_manager_userid: "lead", template_name: "泥水平衡", copied_from_kit_id: null, line_count: 180, remark: null,
  created_by_userid: "lead", submitted_by_userid: "lead", submitted_at: "2026-11-12T01:05:00.000Z",
  confirmed_by_userid: null, confirmed_at: null, close_reason: null, version: 3
};
assert.deepStrictEqual(toKitListRow(header), {
  id: 5,
  projectName: "一号工程",
  title: "PT-20261112-001 主清单",
  statusLabel: "待确认",
  statusTheme: "warning",
  lineText: "180 行"
});
assert.strictEqual(toKitListRow({ ...header, status: "closed", close_reason: "建错了", confirmed_at: null }).statusLabel, "已作废");
assert.strictEqual(toKitListRow({ ...header, status: "closed", confirmed_at: "2026-11-12T02:00:00.000Z" }).statusLabel, "已关闭");

const nameOf = (userid) => ({ lead: "张工", kp: "李震" })[userid] || userid;
assert.deepStrictEqual(buildKitHeader(header, nameOf), {
  kitNo: "PT-20261112-001",
  title: "主清单",
  statusLabel: "待确认",
  statusTheme: "warning",
  projectName: "一号工程",
  sourceText: "模板：泥水平衡",
  submittedText: "张工 · 11-12 09:05",
  confirmedText: "",
  remark: "",
  closeReason: ""
});
assert.strictEqual(buildKitHeader({ ...header, template_name: null, copied_from_kit_id: 2 }, nameOf).sourceText, "复制的清单");
assert.strictEqual(buildKitHeader({ ...header, template_name: null }, nameOf).sourceText, "空白清单");
assert.strictEqual(
  buildKitHeader({ ...header, status: "confirmed", confirmed_by_userid: "kp", confirmed_at: "2026-11-12T03:00:00.000Z" }, nameOf).confirmedText,
  "李震 · 11-12 11:00"
);

assert.deepStrictEqual(KIT_STATUS_TABS.map((tab) => [tab.key, tab.label]), [
  ["", "全部"],
  ["draft", "草稿"],
  ["submitted", "待确认"],
  ["confirmed", "已确认"],
  ["closed", "已关闭"]
]);
assert.deepStrictEqual(SOURCE_OPTIONS.map((option) => option.label), ["库房发", "现场采购", "租赁", "现场已有"]);

console.log("wh-kit-view tests passed");
