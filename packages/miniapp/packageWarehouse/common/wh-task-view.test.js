/** 库房任务页面的视图模型。运行：node packageWarehouse/common/wh-task-view.test.js */
const assert = require("assert");

const {
  TASK_TABS,
  tabsFor,
  toTaskRow,
  buildTaskDetail,
  submitProblem,
  toSubmitPayload,
  SYSTEM_OPTIONS,
  NEW_TASK_KINDS,
  newTaskForm,
  newTaskProblem,
  toNewTaskPayload,
  assigneeOptions
} = require("./wh-task-view");

const nameOf = (userid) => ({ wang: "王师傅", lz: "李震" })[userid] || userid;
const TODAY = "2026-11-12";
const KEEPER = { userid: "lz", caps: { is_keeper: true } };
const WANG = { userid: "wang", caps: { is_keeper: false } };
const OTHER = { userid: "zhao", caps: { is_keeper: false } };

const task = {
  id: 9,
  task_no: "KFR-20261112-001",
  kind: "inspection",
  status: "todo",
  title: "返库检查",
  blocking: 1,
  required_photo_count: 3,
  photo_count: 1,
  assignee_userid: "wang",
  due_date: "2026-11-14",
  version: 2,
  device_id: 7,
  device_code: "DG-01",
  device_name: "顶管机",
  device_location: "warehouse",
  device_storage_note: null,
  device_project_name: null,
  description: null,
  review_note: null,
  supplement_round: 0,
  result: null,
  result_note: null,
  systems_json: null,
  cancel_reason: null,
  photos: []
};

// 页签
assert.deepStrictEqual(
  TASK_TABS.map((tab) => [tab.key, tab.label, tab.query]),
  [
    ["mine", "我的", { scope: "mine", status: "todo" }],
    ["confirm", "待确认", { status: "submitted" }],
    ["unassigned", "待派工", { status: "todo", assigned: "no" }],
    ["all", "全部", {}]
  ]
);
assert.deepStrictEqual(tabsFor({ is_keeper: true }).map((tab) => tab.key), ["mine", "confirm", "unassigned", "all"]);
assert.deepStrictEqual(tabsFor({ is_keeper: false }).map((tab) => tab.key), ["mine"]);
assert.deepStrictEqual(tabsFor(null).map((tab) => tab.key), ["mine"]);

// 列表行
assert.deepStrictEqual(toTaskRow(task, TODAY, nameOf), {
  id: 9,
  title: "返库检查",
  kindLabel: "检查",
  statusLabel: "待执行",
  statusTheme: "primary",
  deviceText: "DG-01 顶管机",
  assigneeName: "王师傅",
  dueText: "11-14 到期",
  overdue: false,
  photoText: "照片 1/3"
});
let row = toTaskRow({ ...task, due_date: "2026-11-10", device_id: null, device_code: null, device_name: null, assignee_userid: null, required_photo_count: 0, photo_count: 0 }, TODAY, nameOf);
assert.strictEqual(row.overdue, true);
assert.strictEqual(row.deviceText, "");
assert.strictEqual(row.assigneeName, "未派工");
assert.strictEqual(row.statusLabel, "待派工");
assert.strictEqual(row.photoText, "");
// 已完成的任务过了期限也不算超期
row = toTaskRow({ ...task, status: "done", due_date: "2026-11-01", required_photo_count: 0, photo_count: 2 }, TODAY, nameOf);
assert.strictEqual(row.overdue, false);
assert.strictEqual(row.statusLabel, "已完成");
assert.strictEqual(row.photoText, "照片 2 张");

// 详情：执行人是我，待执行
const mine = buildTaskDetail(task, WANG, TODAY, nameOf);
assert.deepStrictEqual(mine.header, {
  taskNo: "KFR-20261112-001",
  title: "返库检查",
  kindLabel: "检查",
  statusLabel: "待执行",
  statusTheme: "primary",
  blocking: true
});
assert.deepStrictEqual(mine.actions, { canWork: true, canAssign: false, canConfirm: false, canSendBack: false, canCancel: false });
assert.deepStrictEqual(mine.photo, { count: 1, required: 3, missing: 2, text: "已传 1 张，还差 2 张" });
assert.deepStrictEqual(mine.device, { id: 7, code: "DG-01", name: "顶管机", locationText: "在库" });
assert.strictEqual(mine.assigneeName, "王师傅");
assert.strictEqual(mine.dueText, "11-14 到期");
assert.strictEqual(mine.overdue, false);
assert.strictEqual(mine.needsResult, true);
assert.strictEqual(mine.needsSystems, false);
assert.strictEqual(mine.result, null);
assert.strictEqual(mine.description, "");
assert.strictEqual(mine.reviewNote, "");
assert.strictEqual(mine.supplementRound, 0);

// 详情：库管看待确认的任务
const submitted = { ...task, status: "submitted", result: "fail", result_note: "主轴漏油", photo_count: 3, version: 3 };
const forKeeper = buildTaskDetail(submitted, KEEPER, TODAY, nameOf);
assert.deepStrictEqual(forKeeper.actions, { canWork: false, canAssign: false, canConfirm: true, canSendBack: true, canCancel: true });
assert.deepStrictEqual(forKeeper.result, { label: "不合格", note: "主轴漏油", systemsText: "" });
assert.strictEqual(forKeeper.photo.text, "已传 3 张");

// 详情：库管看待执行的任务（能派工、能替做、能取消）
assert.deepStrictEqual(buildTaskDetail(task, KEEPER, TODAY, nameOf).actions, {
  canWork: true,
  canAssign: true,
  canConfirm: false,
  canSendBack: false,
  canCancel: true
});

// 详情：旁观者
assert.deepStrictEqual(buildTaskDetail(task, OTHER, TODAY, nameOf).actions, {
  canWork: false,
  canAssign: false,
  canConfirm: false,
  canSendBack: false,
  canCancel: false
});

// 详情：已完成、已取消都没有动作
const done = { ...task, kind: "maintenance", status: "done", result_note: "换了油封", systems_json: '["hydraulic","drive"]' };
const doneView = buildTaskDetail(done, KEEPER, TODAY, nameOf);
assert.deepStrictEqual(doneView.actions, { canWork: false, canAssign: false, canConfirm: false, canSendBack: false, canCancel: false });
assert.deepStrictEqual(doneView.result, { label: "", note: "换了油封", systemsText: "液压、传动" });
assert.strictEqual(doneView.needsSystems, true);
const cancelled = buildTaskDetail({ ...task, status: "cancelled", cancel_reason: "设备已报废" }, KEEPER, TODAY, nameOf);
assert.strictEqual(cancelled.cancelReason, "设备已报废");
assert.strictEqual(cancelled.actions.canCancel, false);

// 详情：退回补充过、没有设备、没有执行人、systems_json 坏了
const sentBack = buildTaskDetail(
  { ...task, review_note: "补一张铭牌照片", supplement_round: 2, device_id: null, device_code: null, device_name: null, assignee_userid: null, description: "按清单查", due_date: "2026-11-01", systems_json: "{oops" },
  KEEPER,
  TODAY,
  nameOf
);
assert.strictEqual(sentBack.reviewNote, "补一张铭牌照片");
assert.strictEqual(sentBack.supplementRound, 2);
assert.strictEqual(sentBack.device, null);
assert.strictEqual(sentBack.assigneeName, "未派工");
assert.strictEqual(sentBack.header.statusLabel, "待派工");
assert.strictEqual(sentBack.description, "按清单查");
assert.strictEqual(sentBack.overdue, true);

// 照片文字
assert.strictEqual(buildTaskDetail({ ...task, required_photo_count: 0, photo_count: 0 }, WANG, TODAY, nameOf).photo.text, "不要求照片");
assert.strictEqual(buildTaskDetail({ ...task, required_photo_count: 0, photo_count: 2 }, WANG, TODAY, nameOf).photo.text, "已传 2 张");
assert.strictEqual(buildTaskDetail({ ...task, photo_count: 3 }, WANG, TODAY, nameOf).photo.text, "已传 3 张");
assert.strictEqual(buildTaskDetail({ ...task, photo_count: 5 }, WANG, TODAY, nameOf).photo.missing, 0);

// 设备在项目上
assert.strictEqual(
  buildTaskDetail({ ...task, device_location: "project", device_project_name: "一号工程" }, WANG, TODAY, nameOf).device.locationText,
  "在项目：一号工程"
);

// 提交前检查
assert.strictEqual(submitProblem(task, 1, { result: "pass", systems: [], resultNote: "正常" }), "还差 2 张照片");
assert.strictEqual(submitProblem(task, 3, { result: "", systems: [], resultNote: "正常" }), "请选择合格或不合格");
assert.strictEqual(submitProblem(task, 3, { result: "pass", systems: [], resultNote: "  " }), "请填写简报");
assert.strictEqual(submitProblem(task, 3, { result: "pass", systems: [], resultNote: "正常" }), "");
const repair = { ...task, kind: "maintenance", required_photo_count: 0, version: 5 };
assert.strictEqual(submitProblem(repair, 0, { result: "", systems: [], resultNote: "换了油封" }), "请选择维修涉及的系统");
assert.strictEqual(submitProblem(repair, 0, { result: "", systems: ["hydraulic"], resultNote: "换了油封" }), "");
const other = { ...task, kind: "other", required_photo_count: 0, version: 1 };
assert.strictEqual(submitProblem(other, 0, { result: "", systems: [], resultNote: "做完了" }), "");

// 请求体
assert.deepStrictEqual(toSubmitPayload(task, { result: "fail", systems: [], resultNote: " 漏油 " }), {
  version: 2,
  result: "fail",
  result_note: "漏油"
});
assert.deepStrictEqual(toSubmitPayload(repair, { result: "", systems: ["hydraulic", "drive"], resultNote: "换了油封" }), {
  version: 5,
  systems: ["hydraulic", "drive"],
  result_note: "换了油封"
});
assert.deepStrictEqual(toSubmitPayload(other, { result: "pass", systems: ["drive"], resultNote: "做完了" }), {
  version: 1,
  result_note: "做完了"
});

assert.deepStrictEqual(SYSTEM_OPTIONS, [
  { key: "hydraulic", label: "液压" },
  { key: "electric", label: "电气" },
  { key: "drive", label: "传动" },
  { key: "other", label: "其他" }
]);

// 新建任务：表单
assert.deepStrictEqual(NEW_TASK_KINDS, [
  { key: "maintenance", label: "维修" },
  { key: "servicing", label: "保养" },
  { key: "other", label: "其他" },
  { key: "inspection", label: "检查" }
]);
assert.deepStrictEqual(newTaskForm(null), {
  kind: "maintenance",
  title: "",
  description: "",
  deviceId: null,
  deviceText: "",
  assigneeUserid: "",
  dueDate: "",
  requiredPhotoCount: "0"
});
const withDevice = newTaskForm({ id: 7, device_code: "DG-01", name: "顶管机" });
assert.strictEqual(withDevice.deviceId, 7);
assert.strictEqual(withDevice.deviceText, "DG-01 顶管机");

// 新建任务：检查
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "  " }), "请填写任务标题");
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "换油", requiredPhotoCount: "10" }), "照片要求填 0 到 9");
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "换油", requiredPhotoCount: "1.5" }), "照片要求填 0 到 9");
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "换油", requiredPhotoCount: "abc" }), "照片要求填 0 到 9");
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "换油", requiredPhotoCount: "" }), "");
assert.strictEqual(newTaskProblem({ ...newTaskForm(null), title: "换油", requiredPhotoCount: "3" }), "");

// 新建任务：请求体，空的选填项传 null
assert.deepStrictEqual(toNewTaskPayload({ ...newTaskForm(null), title: " 换油 " }), {
  kind: "maintenance",
  title: "换油",
  description: null,
  device_id: null,
  assignee_userid: null,
  due_date: null,
  required_photo_count: 0
});
assert.deepStrictEqual(
  toNewTaskPayload({
    ...withDevice,
    kind: "servicing",
    title: "保养",
    description: " 换液压油 ",
    assigneeUserid: "wang",
    dueDate: "2026-11-20",
    requiredPhotoCount: "2"
  }),
  {
    kind: "servicing",
    title: "保养",
    description: "换液压油",
    device_id: 7,
    assignee_userid: "wang",
    due_date: "2026-11-20",
    required_photo_count: 2
  }
);

// 执行人选项：第 0 项是不指定；同名的带上 userid 区分
assert.deepStrictEqual(assigneeOptions({ wang: "王师傅", lz: "李震" }), {
  range: ["不指定", "李震", "王师傅"],
  userids: ["", "lz", "wang"]
});
assert.deepStrictEqual(assigneeOptions({ a1: "张伟", a2: "张伟" }), {
  range: ["不指定", "张伟 (a1)", "张伟 (a2)"],
  userids: ["", "a1", "a2"]
});
assert.deepStrictEqual(assigneeOptions(null), { range: ["不指定"], userids: [""] });

console.log("wh-task-view tests passed");
