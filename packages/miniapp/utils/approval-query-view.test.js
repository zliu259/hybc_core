/** 流程查询的视图模型。运行：node utils/approval-query-view.test.js */
const assert = require("assert");
const {
  BIZ_TYPE_OPTIONS,
  STATUS_CHIPS,
  buildApprovalRow,
  canQueryApprovals,
  toInitiatorOptions
} = require("./approval-query-view");

const names = { zhang: "张三", li: "李四", wang: "王五", zhao: "赵六", LiuPeng: "刘鹏" };
const toName = (id) => names[id] || "未知人员";

// 只给超级管理员
assert.strictEqual(canQueryApprovals({ roles: ["super_admin"] }), true);
assert.strictEqual(canQueryApprovals({ roles: ["manager", "finance"] }), false);
assert.strictEqual(canQueryApprovals({}), false);
assert.strictEqual(canQueryApprovals(null), false);

// 筛选项
assert.deepStrictEqual(STATUS_CHIPS[0], { label: "全部", value: "" });
assert.ok(STATUS_CHIPS.some((item) => item.value === "in_progress" && item.label === "进行中"));
assert.deepStrictEqual(BIZ_TYPE_OPTIONS[0], { label: "全部类型", value: "" });
assert.ok(BIZ_TYPE_OPTIONS.some((item) => item.value === "payment_request" && item.label === "付款审批"));

const base = {
  id: 7,
  instance_no: "SP-20261014-0010",
  biz_type: "payment_request",
  biz_summary: "PM-1 | 2026.9 工资",
  initiator_userid: "LiuPeng",
  status: "in_progress",
  current_round: 1,
  submitted_at: "2026-11-05T06:20:00.000Z",
  current_node_name: "财务审核",
  pending_assignees: "zhang,li"
};

const row = buildApprovalRow(base, toName);
assert.strictEqual(row.id, 7);
assert.strictEqual(row.title, "PM-1 | 2026.9 工资");
assert.strictEqual(row.statusText, "进行中");
assert.strictEqual(row.statusTheme, "primary");
assert.strictEqual(row.instanceNo, "SP-20261014-0010");
assert.strictEqual(row.metaText, "付款审批  刘鹏  11-05 14:20");
assert.strictEqual(row.waitText, "财务审核：等 张三、李四");

// 多人时不把一行撑爆
assert.strictEqual(
  buildApprovalRow({ ...base, pending_assignees: "zhang,li,wang,zhao" }, toName).waitText,
  "财务审核：等 张三、李四、王五 等 4 人"
);

// AI 关卡不能显示成「未知人员」
assert.strictEqual(
  buildApprovalRow({ ...base, current_node_name: "AI 审查", pending_assignees: "AI_GATE" }, toName).waitText,
  "AI 审查：等 AI 审查"
);

// 节点上没有待办时如实说，能看出来是卡住了
assert.strictEqual(
  buildApprovalRow({ ...base, pending_assignees: null }, toName).waitText,
  "财务审核：没有待处理人"
);
assert.strictEqual(
  buildApprovalRow({ ...base, current_node_name: null, pending_assignees: null }, toName).waitText,
  "没有待处理人"
);

// 旧接口没有这个字段时什么都不说，不能误报成没人处理
const { pending_assignees: _dropped, ...oldApiRow } = base;
assert.strictEqual(buildApprovalRow(oldApiRow, toName).waitText, "");

// 第二轮要看得出来
assert.strictEqual(
  buildApprovalRow({ ...base, current_round: 2 }, toName).waitText,
  "第 2 轮 财务审核：等 张三、李四"
);

// 结束的单子不说等谁，状态用对应颜色
const finished = buildApprovalRow({ ...base, status: "approved" }, toName);
assert.strictEqual(finished.waitText, "");
assert.strictEqual(finished.statusText, "已通过");
assert.strictEqual(finished.statusTheme, "success");
assert.strictEqual(buildApprovalRow({ ...base, status: "cancelled" }, toName).statusText, "已取消");
assert.strictEqual(buildApprovalRow({ ...base, status: "rejected" }, toName).statusTheme, "danger");
assert.strictEqual(buildApprovalRow({ ...base, status: "returned" }, toName).statusText, "已退回");
assert.strictEqual(buildApprovalRow({ ...base, status: "whatever" }, toName).statusText, "未知");

// 缺字段不报错
const sparse = buildApprovalRow({ id: 1, biz_type: "outbound_contract", status: "approved" }, toName);
assert.strictEqual(sparse.title, "对外合同审批");
assert.strictEqual(sparse.metaText, "对外合同审批");
assert.strictEqual(sparse.instanceNo, "");

// 发起人下拉：第一项是全部，按名字排序，名字为空的用账号
const options = toInitiatorOptions([
  { userid: "b", name: "李四" },
  { userid: "a", name: "" },
  { userid: "c", name: "张三" }
]);
assert.strictEqual(options[0].userid, "");
assert.strictEqual(options[0].label, "全部发起人");
assert.deepStrictEqual(options.map((item) => item.userid).sort(), ["", "a", "b", "c"]);
assert.ok(options.some((item) => item.userid === "a" && item.label === "a"));

console.log("approval-query-view: ok");
