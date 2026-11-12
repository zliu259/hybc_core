/** 库房首页的视图模型。运行：node utils/wh-home-view.test.js */
const assert = require("assert");

const { buildHomeView } = require("./wh-home-view");

const base = {
  caps: { is_keeper: false, can_create_kit: false },
  my_tasks: { todo: 0, items: [] },
  my_projects: [],
  keeper: null
};

// 普通员工：没有库管的数字和动作，没有项目
let view = buildHomeView(base, "2026-11-12");
assert.deepStrictEqual(view.tiles, []);
assert.deepStrictEqual(view.actions, []);
assert.strictEqual(view.showProjects, false);
assert.deepStrictEqual(view.myTasks, { count: 0, items: [] });

// 我的任务：超期标记和设备文字
view = buildHomeView(
  {
    ...base,
    my_tasks: {
      todo: 5,
      items: [
        { id: 1, title: "返库检查", device_code: "DG-01", device_name: "顶管机", due_date: "2026-11-10" },
        { id: 2, title: "整理库房", device_code: null, device_name: null, due_date: null },
        { id: 3, title: "换油", device_code: "DG-02", device_name: null, due_date: "2026-11-12" }
      ]
    }
  },
  "2026-11-12"
);
assert.strictEqual(view.myTasks.count, 5);
assert.deepStrictEqual(view.myTasks.items[0], {
  id: 1,
  title: "返库检查",
  deviceText: "DG-01 顶管机",
  dueText: "11-10 到期",
  overdue: true
});
assert.deepStrictEqual(view.myTasks.items[1], {
  id: 2,
  title: "整理库房",
  deviceText: "",
  dueText: "",
  overdue: false
});
assert.deepStrictEqual(view.myTasks.items[2], {
  id: 3,
  title: "换油",
  deviceText: "DG-02",
  dueText: "11-12 到期",
  overdue: false
});

// 库管：五个数字、七个动作，数字是 0 也在
view = buildHomeView(
  {
    ...base,
    caps: { is_keeper: true, can_create_kit: true },
    keeper: {
      kits_to_confirm: 2,
      tasks_to_confirm: 0,
      tasks_unassigned: 1,
      tasks_overdue: 0,
      low_stock_count: 3,
      devices_pending_inspection: 0,
      devices_repairing: 0,
      devices_on_project: 0
    }
  },
  "2026-11-12"
);
assert.deepStrictEqual(
  view.tiles.map((tile) => [tile.label, tile.count, tile.url]),
  [
    ["待确认清单", 2, "/packageWarehouse/kit-list/index?status=submitted"],
    ["待确认任务", 0, "/packageWarehouse/task-list/index?tab=confirm"],
    ["待派工", 1, "/packageWarehouse/task-list/index?tab=unassigned"],
    ["超期任务", 0, "/packageWarehouse/task-list/index?tab=all"],
    ["低库存", 3, "/packageWarehouse/material/index?low=1"]
  ]
);
assert.deepStrictEqual(
  view.actions.map((action) => [action.label, action.url]),
  [
    ["按清单发货", "/packageWarehouse/kit-list/index?status=confirmed"],
    ["直接发货", "/packageWarehouse/ship/index?type=out"],
    ["项目返库", "/packageWarehouse/ship/index?type=back"],
    ["转场", "/packageWarehouse/ship/index?type=transfer"],
    ["入库", "/packageWarehouse/ship/index?type=in"],
    ["查库存", "/packageWarehouse/material/index"],
    ["全部任务", "/packageWarehouse/task-list/index?tab=all"]
  ]
);
assert.strictEqual(view.showProjects, false);
assert.ok(view.tiles.every((tile) => typeof tile.key === "string" && tile.key));

// 库管身份但数字没取到（keeper 为 null）：数字按 0
view = buildHomeView({ ...base, caps: { is_keeper: true, can_create_kit: true } }, "2026-11-12");
assert.deepStrictEqual(
  view.tiles.map((tile) => tile.count),
  [0, 0, 0, 0, 0]
);

// 现场负责人：项目摘要
view = buildHomeView(
  {
    ...base,
    caps: { is_keeper: false, can_create_kit: true },
    my_projects: [
      { project_id: 3, project_name: "一号工程", devices_on_site: 2, materials_on_site: 5, kits_open: 1, kits_confirmed: 1 },
      { project_id: 4, project_name: "二号工程", devices_on_site: 0, materials_on_site: 0, kits_open: 0, kits_confirmed: 0 },
      { project_id: 5, project_name: "三号工程", devices_on_site: 0, materials_on_site: 0, kits_open: 2, kits_confirmed: 0 }
    ]
  },
  "2026-11-12"
);
assert.strictEqual(view.showProjects, true);
assert.deepStrictEqual(view.projects[0], {
  projectId: 3,
  name: "一号工程",
  summary: "设备 2 台 · 周转件 5 种 · 清单 1 份未确认"
});
assert.strictEqual(view.projects[1].summary, "现在没有东西在场");
assert.strictEqual(view.projects[2].summary, "清单 2 份未确认");

// 能建清单但没有自己负责的项目（经理）：也显示项目这一段，方便进清单列表
view = buildHomeView({ ...base, caps: { is_keeper: false, can_create_kit: true } }, "2026-11-12");
assert.strictEqual(view.showProjects, true);
assert.deepStrictEqual(view.projects, []);

// 接口没返回、字段缺失时不报错
view = buildHomeView(null, "2026-11-12");
assert.deepStrictEqual(view, { myTasks: { count: 0, items: [] }, projects: [], showProjects: false, tiles: [], actions: [] });

console.log("wh-home-view tests passed");
