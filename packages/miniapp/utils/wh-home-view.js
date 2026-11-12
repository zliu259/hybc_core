/**
 * 库房 tab 页的视图模型：按身份决定显示什么。纯函数。
 * 这一页在主包，不能引分包里的 wh-format.js，所以日期的小处理自己带。
 */

const SUB = "/packageWarehouse";

const KEEPER_TILES = [
  { key: "kits_to_confirm", label: "待确认清单", url: `${SUB}/kit-list/index?status=submitted` },
  { key: "tasks_to_confirm", label: "待确认任务", url: `${SUB}/task-list/index?tab=confirm` },
  { key: "tasks_unassigned", label: "待派工", url: `${SUB}/task-list/index?tab=unassigned` },
  { key: "tasks_overdue", label: "超期任务", url: `${SUB}/task-list/index?tab=all` },
  { key: "low_stock_count", label: "低库存", url: `${SUB}/material/index?low=1` }
];

const KEEPER_ACTIONS = [
  { key: "shipByKit", label: "按清单发货", url: `${SUB}/kit-list/index?status=confirmed` },
  { key: "ship", label: "直接发货", url: `${SUB}/ship/index?type=out` },
  { key: "back", label: "项目返库", url: `${SUB}/ship/index?type=back` },
  { key: "transfer", label: "转场", url: `${SUB}/ship/index?type=transfer` },
  { key: "inbound", label: "入库", url: `${SUB}/ship/index?type=in` },
  { key: "material", label: "查库存", url: `${SUB}/material/index` },
  { key: "tasks", label: "全部任务", url: `${SUB}/task-list/index?tab=all` }
];

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const toTaskItem = (task, today) => {
  const dueDate = task.due_date || "";
  return {
    id: task.id,
    title: task.title,
    deviceText: [task.device_code, task.device_name].filter(Boolean).join(" "),
    dueText: dueDate ? `${dueDate.slice(5)} 到期` : "",
    overdue: Boolean(dueDate) && dueDate < today
  };
};

const projectSummary = (project) => {
  const parts = [
    count(project.devices_on_site) ? `设备 ${count(project.devices_on_site)} 台` : "",
    count(project.materials_on_site) ? `周转件 ${count(project.materials_on_site)} 种` : "",
    count(project.kits_open) ? `清单 ${count(project.kits_open)} 份未确认` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "现在没有东西在场";
};

/**
 * @param {object | null} home GET /api/v1/warehouse/home 的 data
 * @param {string} today 北京时间的今天 "YYYY-MM-DD"
 * @returns {{
 *   myTasks: { count: number, items: { id: number, title: string, deviceText: string, dueText: string, overdue: boolean }[] },
 *   projects: { projectId: number, name: string, summary: string }[],
 *   showProjects: boolean,
 *   tiles: { key: string, label: string, count: number, url: string }[],
 *   actions: { key: string, label: string, url: string }[]
 * }}
 */
const buildHomeView = (home, today) => {
  const caps = (home && home.caps) || {};
  const myTasks = (home && home.my_tasks) || {};
  const projects = (home && Array.isArray(home.my_projects) ? home.my_projects : []).map(
    (project) => ({
      projectId: project.project_id,
      name: project.project_name,
      summary: projectSummary(project)
    })
  );
  const keeper = Boolean(caps.is_keeper);
  const numbers = (home && home.keeper) || {};
  return {
    myTasks: {
      count: count(myTasks.todo),
      items: (Array.isArray(myTasks.items) ? myTasks.items : []).map((task) =>
        toTaskItem(task, today)
      )
    },
    projects,
    // 有自己负责的项目；或者能建清单（经理）但不是库管，给个进清单列表的地方
    showProjects: projects.length > 0 || (Boolean(caps.can_create_kit) && !keeper),
    tiles: keeper ? KEEPER_TILES.map((tile) => ({ ...tile, count: count(numbers[tile.key]) })) : [],
    actions: keeper ? KEEPER_ACTIONS.map((action) => ({ ...action })) : []
  };
};

module.exports = { buildHomeView };
