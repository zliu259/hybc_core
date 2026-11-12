/** 设备卡片页的视图模型。运行：node packageWarehouse/common/wh-device-view.test.js */
const assert = require("assert");

const { buildDeviceView, buildSingleReturn } = require("./wh-device-view");

const nameOf = (userid) => ({ lz: "李震" })[userid] || userid;

const detail = {
  id: 7,
  device_code: "DG-01",
  name: "顶管机",
  alias: "老一号",
  state: "on_project",
  state_label: "在项目",
  location: "project",
  project_name: "一号工程",
  current_project_id: 3,
  storage_note: null,
  category_name: "顶管机",
  spec: "DN1200",
  model: "NPD-1200",
  open_tasks: [],
  events: [],
  usage_records: [],
  usage_meters_total: 0
};

const KEEPER = { is_keeper: true };
const STAFF = { is_keeper: false };

// 头部
let view = buildDeviceView(detail, KEEPER, nameOf);
assert.deepStrictEqual(view.header, {
  code: "DG-01",
  name: "顶管机",
  alias: "老一号",
  stateLabel: "在项目",
  stateTheme: "primary",
  locationText: "在项目：一号工程",
  categoryName: "顶管机",
  specText: "DN1200 · NPD-1200"
});

// 按钮：在项目
assert.deepStrictEqual(view.actions, { canReturn: true, canShip: false, canNote: true, canNewTask: true });
assert.deepStrictEqual(buildDeviceView(detail, STAFF, nameOf).actions, {
  canReturn: false,
  canShip: false,
  canNote: false,
  canNewTask: false
});

// 按钮：可用
const available = { ...detail, state: "available", state_label: "可用", location: "warehouse", project_name: null, current_project_id: null, storage_note: "A 区" };
view = buildDeviceView(available, KEEPER, nameOf);
assert.deepStrictEqual(view.actions, { canReturn: false, canShip: true, canNote: true, canNewTask: true });
assert.strictEqual(view.header.locationText, "在库 · A 区");
assert.strictEqual(view.header.stateTheme, "success");

// 按钮：待检（不能发，也不用返）
view = buildDeviceView({ ...available, state: "pending_inspection", state_label: "待检" }, KEEPER, nameOf);
assert.deepStrictEqual(view.actions, { canReturn: false, canShip: false, canNote: true, canNewTask: true });

// 按钮：已报废，什么都不能做
view = buildDeviceView({ ...available, state: "scrapped", state_label: "已报废", location: "scrapped" }, KEEPER, nameOf);
assert.deepStrictEqual(view.actions, { canReturn: false, canShip: false, canNote: false, canNewTask: false });
assert.strictEqual(view.header.locationText, "已报废");

// 没填规格型号
assert.strictEqual(buildDeviceView({ ...detail, spec: null, model: "" }, KEEPER, nameOf).header.specText, "");

// 未完成的任务
view = buildDeviceView(
  {
    ...detail,
    open_tasks: [
      { id: 11, task_no: "KFR-1", kind: "inspection", status: "todo", title: "返库检查", blocking: 1 },
      { id: 12, task_no: "KFR-2", kind: "other", status: "submitted", title: "擦洗", blocking: 0 }
    ]
  },
  KEEPER,
  nameOf
);
assert.deepStrictEqual(view.openTasks, [
  { id: 11, title: "返库检查", kindLabel: "检查", statusLabel: "待执行", blocking: true },
  { id: 12, title: "擦洗", kindLabel: "其他", statusLabel: "待确认", blocking: false }
]);

// 时间线：操作人显示名字
view = buildDeviceView(
  {
    ...detail,
    events: [
      { id: 5, summary: "发往 一号工程", operator_userid: "lz", occurred_at: "2026-11-12T01:05:00.000Z" },
      { id: 4, summary: "修改档案", operator_userid: "unknown", occurred_at: "2026-11-10T00:00:00.000Z" }
    ]
  },
  KEEPER,
  nameOf
);
assert.deepStrictEqual(view.timeline, [
  { id: 5, summary: "发往 一号工程", timeText: "11-12 09:05", operatorName: "李震" },
  { id: 4, summary: "修改档案", timeText: "11-10 08:00", operatorName: "unknown" }
]);

// 维修使用记录
assert.deepStrictEqual(buildDeviceView(detail, KEEPER, nameOf).usage, { rows: [], totalText: "" });
view = buildDeviceView(
  {
    ...detail,
    usage_records: [
      { doc_no: "KF-1", project_name: "一号工程", returned_at: "2026-10-01T02:00:00.000Z", usage_meters: 120.5, soil_type: "粉质黏土" },
      { doc_no: "KF-2", project_name: "二号工程", returned_at: "2026-11-01T02:00:00.000Z", usage_meters: null, soil_type: null }
    ],
    usage_meters_total: 235.5
  },
  KEEPER,
  nameOf
);
assert.deepStrictEqual(view.usage, {
  rows: [
    { projectName: "一号工程", timeText: "10-01 10:00", metersText: "120.5 米", soilType: "粉质黏土" },
    { projectName: "二号工程", timeText: "11-01 10:00", metersText: "-", soilType: "" }
  ],
  totalText: "累计 235.5 米"
});

// 单台返库的请求体
assert.deepStrictEqual(buildSingleReturn(detail, { usageMeters: "", soilType: "" }, "req-12345678"), {
  payload: {
    doc_type: "back",
    client_request_id: "req-12345678",
    project_id: 3,
    device_lines: [{ device_id: 7, usage_meters: null, soil_type: null }],
    material_lines: []
  }
});
assert.deepStrictEqual(
  buildSingleReturn(detail, { usageMeters: "120.5", soilType: " 粉质黏土 " }, "req-12345678"),
  {
    payload: {
      doc_type: "back",
      client_request_id: "req-12345678",
      project_id: 3,
      device_lines: [{ device_id: 7, usage_meters: 120.5, soil_type: "粉质黏土" }],
      material_lines: []
    }
  }
);
assert.deepStrictEqual(buildSingleReturn(detail, { usageMeters: "abc", soilType: "" }, "req-12345678"), {
  error: "顶进距离只填数字（米）"
});
assert.deepStrictEqual(buildSingleReturn(detail, { usageMeters: "-5", soilType: "" }, "req-12345678"), {
  error: "顶进距离只填数字（米）"
});
assert.deepStrictEqual(buildSingleReturn(available, { usageMeters: "", soilType: "" }, "req-12345678"), {
  error: "这台设备不在项目上"
});

console.log("wh-device-view tests passed");
