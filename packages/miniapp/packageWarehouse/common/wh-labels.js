/** 库房分包的中文文案，和 Web 的 views/wh/shared/labels.ts、kit/kit-view.ts 保持一致。 */

const DEVICE_STATE_LABELS = {
  scrapped: "已报废",
  on_project: "在项目",
  repairing: "维修中",
  pending_inspection: "待检",
  blocked: "暂不可用",
  available: "可用"
};

/** 设备状态 → hy-status-chip 的 theme */
const DEVICE_STATE_THEME = {
  available: "success",
  pending_inspection: "warning",
  blocked: "warning",
  repairing: "danger",
  on_project: "primary",
  scrapped: "default"
};

const DOC_TYPE_LABELS = {
  opening: "期初",
  inbound: "入库",
  out: "发往项目",
  back: "项目返库",
  transfer: "项目间转场",
  adjust: "盘点调整",
  scrap: "报废",
  unscrap: "撤销报废"
};

const TASK_KIND_LABELS = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  other: "其他"
};

const TASK_STATUS_LABELS = {
  todo: "待执行",
  submitted: "待确认",
  done: "已完成",
  cancelled: "已取消"
};

/** 待执行的任务没有执行人时叫"待派工"。 */
const taskStatusLabel = (task) =>
  task && task.status === "todo" && !task.assignee_userid
    ? "待派工"
    : (task && TASK_STATUS_LABELS[task.status]) || "";

const TASK_STATUS_THEME = {
  todo: "primary",
  submitted: "warning",
  done: "success",
  cancelled: "default"
};

const TASK_SYSTEM_LABELS = {
  hydraulic: "液压",
  electric: "电气",
  drive: "传动",
  other: "其他"
};

const MATERIAL_KIND_LABELS = {
  turnover: "周转",
  consumable: "消耗"
};

const KIT_STATUS_LABELS = {
  draft: "草稿",
  submitted: "待确认",
  confirmed: "已确认",
  closed: "已关闭"
};

const KIT_STATUS_THEME = {
  draft: "default",
  submitted: "warning",
  confirmed: "success",
  closed: "default"
};

const KIT_SOURCE_LABELS = {
  warehouse: "库房发",
  site_purchase: "现场采购",
  rental: "租赁",
  on_site: "现场已有"
};

const KIT_LINE_KIND_LABELS = {
  device: "设备",
  material: "物资",
  text: "备忘"
};

module.exports = {
  DEVICE_STATE_LABELS,
  DEVICE_STATE_THEME,
  DOC_TYPE_LABELS,
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_THEME,
  taskStatusLabel,
  TASK_SYSTEM_LABELS,
  MATERIAL_KIND_LABELS,
  KIT_STATUS_LABELS,
  KIT_STATUS_THEME,
  KIT_SOURCE_LABELS,
  KIT_LINE_KIND_LABELS
};
