/** 流程查询（仅超级管理员）的视图模型。不碰接口和 wx。 */
const { bizTypeLabel, humanizeBizSummary } = require("./enum-labels");

const STATUS_VIEWS = {
  in_progress: ["进行中", "primary"],
  returned: ["已退回", "warning"],
  approved: ["已通过", "success"],
  rejected: ["已驳回", "danger"],
  withdrawn: ["已撤回", "default"],
  cancelled: ["已取消", "default"],
  pending: ["待处理", "warning"],
  completed: ["已完成", "success"]
};

const STATUS_CHIPS = [
  { label: "全部", value: "" },
  ...["in_progress", "returned", "approved", "rejected", "withdrawn", "cancelled"].map(
    (value) => ({ label: STATUS_VIEWS[value][0], value })
  )
];

const BIZ_TYPE_OPTIONS = [
  { label: "全部类型", value: "" },
  ...[
    "payment_request",
    "outbound_contract",
    "inbound_contract",
    "contract_amount_change",
    "reimbursement_batch",
    "invoice_request",
    "receipt_refund",
    "stock_order",
    "warehouse_asset_work_order",
    "fuel_application",
    "vehicle_maintenance"
  ].map((value) => ({ label: bizTypeLabel(value), value }))
];

const AI_GATE_ASSIGNEE = "AI_GATE";
const WAITING_NAME_LIMIT = 3;

const canQueryApprovals = (profile) =>
  Array.isArray(profile && profile.roles) && profile.roles.includes("super_admin");

const pad = (value) => String(value).padStart(2, "0");

const toShortTime = (value) => {
  const date = new Date(value || "");
  if (!value || Number.isNaN(date.getTime())) return "";
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
};

const toWaitingText = (raw, toName) => {
  const assignees = String(raw || "").split(",").filter(Boolean);
  if (assignees.length === 0) return "没有待处理人";
  const shown = assignees
    .slice(0, WAITING_NAME_LIMIT)
    .map((id) => (id === AI_GATE_ASSIGNEE ? "AI 审查" : toName(id)))
    .join("、");
  return assignees.length > WAITING_NAME_LIMIT
    ? `等 ${shown} 等 ${assignees.length} 人`
    : `等 ${shown}`;
};

/** 进行中的单子说清楚卡在哪、等谁；结束的不用说。 */
const toWaitText = (row, toName) => {
  // 接口还没带这个字段（小程序和接口上线有先后）时不说，不能说成「没有待处理人」
  if (row.status !== "in_progress" || row.pending_assignees === undefined) return "";
  const roundPrefix = Number(row.current_round) > 1 ? `第 ${row.current_round} 轮 ` : "";
  const waiting = toWaitingText(row.pending_assignees, toName);
  return row.current_node_name
    ? `${roundPrefix}${row.current_node_name}：${waiting}`
    : `${roundPrefix}${waiting}`;
};

const buildApprovalRow = (row, toName) => {
  const [statusText, statusTheme] = STATUS_VIEWS[row.status] || ["未知", "default"];
  const typeText = bizTypeLabel(row.biz_type);
  return {
    id: row.id,
    title: humanizeBizSummary(row.biz_summary) || typeText,
    statusText,
    statusTheme,
    instanceNo: row.instance_no || "",
    metaText: [
      typeText,
      row.initiator_userid ? toName(row.initiator_userid) : "",
      toShortTime(row.submitted_at)
    ]
      .filter(Boolean)
      .join("  "),
    waitText: toWaitText(row, toName)
  };
};

const toInitiatorOptions = (users) => [
  { userid: "", label: "全部发起人" },
  ...(users || [])
    .map((user) => ({ userid: user.userid, label: user.name || user.userid }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"))
];

module.exports = {
  BIZ_TYPE_OPTIONS,
  STATUS_CHIPS,
  buildApprovalRow,
  canQueryApprovals,
  toInitiatorOptions
};
