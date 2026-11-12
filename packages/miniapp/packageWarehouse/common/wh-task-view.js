/** 库房任务列表和任务详情的视图模型。纯函数。 */
const { deviceLocationText, isOverdue } = require("./wh-format");
const {
  TASK_KIND_LABELS,
  TASK_STATUS_THEME,
  TASK_SYSTEM_LABELS,
  taskStatusLabel
} = require("./wh-labels");

const TASK_TABS = [
  { key: "mine", label: "我的", query: { scope: "mine", status: "todo" } },
  { key: "confirm", label: "待确认", query: { status: "submitted" }, keeperOnly: true },
  { key: "unassigned", label: "待派工", query: { status: "todo", assigned: "no" }, keeperOnly: true },
  { key: "all", label: "全部", query: {}, keeperOnly: true }
];

const SYSTEM_OPTIONS = Object.keys(TASK_SYSTEM_LABELS).map((key) => ({
  key,
  label: TASK_SYSTEM_LABELS[key]
}));

const OPEN_STATUSES = ["todo", "submitted"];

/** 这个人能看到哪些页签；非库管只有"我的"。 */
const tabsFor = (caps) =>
  TASK_TABS.filter((tab) => !tab.keeperOnly || Boolean(caps && caps.is_keeper));

const deviceTextOf = (task) => [task.device_code, task.device_name].filter(Boolean).join(" ");
const dueTextOf = (task) => (task.due_date ? `${task.due_date.slice(5)} 到期` : "");
const overdueOf = (task, today) =>
  OPEN_STATUSES.includes(task.status) && isOverdue(task.due_date, today);
const assigneeNameOf = (task, toUserName) =>
  task.assignee_userid ? toUserName(task.assignee_userid) : "未派工";
const photoCountOf = (task) =>
  Number(
    task.photo_count === undefined || task.photo_count === null
      ? (task.photos || []).length
      : task.photo_count
  );

/** 列表行。 */
const toTaskRow = (task, today, toUserName) => {
  const required = Number(task.required_photo_count || 0);
  const count = photoCountOf(task);
  return {
    id: task.id,
    title: task.title,
    kindLabel: TASK_KIND_LABELS[task.kind] || "任务",
    statusLabel: taskStatusLabel(task),
    statusTheme: TASK_STATUS_THEME[task.status] || "default",
    deviceText: deviceTextOf(task),
    assigneeName: assigneeNameOf(task, toUserName),
    dueText: dueTextOf(task),
    overdue: overdueOf(task, today),
    photoText: required > 0 ? `照片 ${count}/${required}` : count > 0 ? `照片 ${count} 张` : ""
  };
};

const photoSummary = (task) => {
  const required = Number(task.required_photo_count || 0);
  const count = photoCountOf(task);
  const missing = Math.max(0, required - count);
  const text =
    missing > 0
      ? `已传 ${count} 张，还差 ${missing} 张`
      : count > 0
        ? `已传 ${count} 张`
        : "不要求照片";
  return { count, required, missing, text };
};

const systemsTextOf = (systemsJson) => {
  if (!systemsJson) return "";
  try {
    const list = JSON.parse(systemsJson);
    return Array.isArray(list)
      ? list.map((item) => TASK_SYSTEM_LABELS[item] || "").filter(Boolean).join("、")
      : "";
  } catch (error) {
    return "";
  }
};

const resultOf = (task) => {
  const label =
    task.kind === "inspection" && task.result ? (task.result === "pass" ? "合格" : "不合格") : "";
  const note = task.result_note || "";
  const systemsText = systemsTextOf(task.systems_json);
  return label || note || systemsText ? { label, note, systemsText } : null;
};

/**
 * 详情页。
 * @param {object} task GET /warehouse/task/:id 的 data
 * @param {{ userid: string, caps: { is_keeper?: boolean } }} viewer
 * @param {string} today
 * @param {(userid: string) => string} toUserName
 */
const buildTaskDetail = (task, viewer, today, toUserName) => {
  const keeper = Boolean(viewer && viewer.caps && viewer.caps.is_keeper);
  const mine = Boolean(task.assignee_userid) && task.assignee_userid === (viewer && viewer.userid);
  const todo = task.status === "todo";
  const submitted = task.status === "submitted";
  return {
    header: {
      taskNo: task.task_no,
      title: task.title,
      kindLabel: TASK_KIND_LABELS[task.kind] || "任务",
      statusLabel: taskStatusLabel(task),
      statusTheme: TASK_STATUS_THEME[task.status] || "default",
      blocking: Number(task.blocking) === 1
    },
    device: task.device_id
      ? {
          id: task.device_id,
          code: task.device_code || "",
          name: task.device_name || "",
          locationText: deviceLocationText({
            location: task.device_location,
            project_name: task.device_project_name,
            storage_note: task.device_storage_note
          })
        }
      : null,
    description: task.description || "",
    reviewNote: task.review_note || "",
    supplementRound: Number(task.supplement_round || 0),
    assigneeName: assigneeNameOf(task, toUserName),
    dueText: dueTextOf(task),
    overdue: overdueOf(task, today),
    photo: photoSummary(task),
    result: resultOf(task),
    cancelReason: task.cancel_reason || "",
    needsResult: task.kind === "inspection",
    needsSystems: task.kind === "maintenance",
    actions: {
      canWork: todo && (keeper || mine),
      canAssign: keeper && todo,
      canConfirm: keeper && submitted,
      canSendBack: keeper && submitted,
      canCancel: keeper && (todo || submitted)
    }
  };
};

/**
 * 提交前检查，返回第一条问题的中文，没有问题返回 ""。
 * @param {object} task
 * @param {number} photoCount
 * @param {{ result: string, systems: string[], resultNote: string }} form
 */
const submitProblem = (task, photoCount, form) => {
  const missing = Number(task.required_photo_count || 0) - Number(photoCount || 0);
  if (missing > 0) return `还差 ${missing} 张照片`;
  if (task.kind === "inspection" && form.result !== "pass" && form.result !== "fail") {
    return "请选择合格或不合格";
  }
  if (task.kind === "maintenance" && (!Array.isArray(form.systems) || form.systems.length === 0)) {
    return "请选择维修涉及的系统";
  }
  if (!String(form.resultNote || "").trim()) return "请填写简报";
  return "";
};

/** 提交的请求体。 */
const toSubmitPayload = (task, form) => ({
  version: task.version,
  ...(task.kind === "inspection" ? { result: form.result } : {}),
  ...(task.kind === "maintenance" ? { systems: [...form.systems] } : {}),
  result_note: String(form.resultNote || "").trim()
});

module.exports = {
  TASK_TABS,
  SYSTEM_OPTIONS,
  tabsFor,
  toTaskRow,
  buildTaskDetail,
  submitProblem,
  toSubmitPayload
};
