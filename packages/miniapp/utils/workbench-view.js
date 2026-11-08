/**
 * 工作台的视图模型：角色能用哪些入口、待办数字、待审批预览。不碰接口和 wx。
 * 入口的角色和后端 requireRoles 保持一致，只放点得进去的。
 */
const { formatAmount } = require("./amount-cn");
const { bizTypeLabel, humanizeBizSummary } = require("./enum-labels");

const FIELD_ROLES = ["super_admin", "manager", "site_manager", "operator"];
const MANAGE_ROLES = ["super_admin", "manager", "site_manager"];
const OFFICE_ROLES = ["super_admin", "manager", "finance"];

const COMMON_SIZE = 8;
const TODO_MAX = 4;
const PENDING_PREVIEW_SIZE = 3;
/** 用满这么多次才往前排：误点一两次不该让位置变 */
const USAGE_THRESHOLD = 3;

/**
 * tone 表示功能类别：现场 green、财务 orange、项目和管理 blue、查询和记录 slate。
 * 图标在 assets/workbench/<key>.png，新增入口要同时加图标，见那里的 README。
 */
const ENTRIES = [
  { key: "dashboard", label: "驾驶舱", tone: "blue", path: "/pages/manager-dashboard/index", roles: ["super_admin", "manager"] },
  { key: "projects", label: "项目", tone: "blue", path: "/pages/project-list/index" },
  { key: "managerLog", label: "项目日志", tone: "green", path: "/pages/manager-log/index", roles: MANAGE_ROLES },
  { key: "operatorLog", label: "施工日志", tone: "green", path: "/pages/operator-log/index", roles: FIELD_ROLES },
  { key: "progress", label: "进度看板", tone: "blue", path: "/pages/progress/index", roles: FIELD_ROLES },
  { key: "asset", label: "设备查验", tone: "green", path: "/pages/asset/index", roles: FIELD_ROLES },
  { key: "survey", label: "安全勘查", tone: "green", path: "/pages/survey/index", roles: FIELD_ROLES },
  { key: "paymentApply", label: "付款发单", tone: "orange", path: "/packageFinance/payment-apply/index", roles: ["super_admin", "manager", "site_manager", "finance", "operator"] },
  { key: "reimbursement", label: "报销", tone: "orange", path: "/packageFinance/reimbursement-list/index" },
  { key: "fuel", label: "油卡申请", tone: "orange", path: "/packageFinance/fuel-apply/index" },
  { key: "maintenance", label: "车辆保养", tone: "orange", path: "/packageFinance/vehicle-maintenance/index" },
  { key: "vehicleRecords", label: "车辆记录", tone: "slate", path: "/packageFinance/vehicle-records/index" },
  { key: "archive", label: "信封核查", tone: "orange", path: "/packageFinance/reimbursement-archive/index" },
  { key: "query", label: "综合查询", tone: "slate", path: "/pages/query/index", roles: OFFICE_ROLES },
  { key: "contractPrecheck", label: "合同预审", tone: "slate", path: "/packageTools/contract-precheck-list/index", roles: OFFICE_ROLES },
  { key: "initiated", label: "我的申请", tone: "slate", path: "/pages/approval-initiated/index" },
  { key: "approvalRecords", label: "审批记录", tone: "slate", path: "/pages/approval/index" },
  { key: "projectCreate", label: "新建项目", tone: "blue", path: "/pages/project-create/index", roles: MANAGE_ROLES }
];

/** 各角色默认的常用入口，排在前面的离手指最近的一排 */
const COMMON_BY_ROLE = [
  { role: "super_admin", keys: ["dashboard", "projects", "query", "paymentApply", "reimbursement", "managerLog", "progress", "initiated"] },
  { role: "manager", keys: ["dashboard", "projects", "query", "paymentApply", "reimbursement", "managerLog", "progress", "initiated"] },
  { role: "site_manager", keys: ["managerLog", "operatorLog", "projects", "reimbursement", "paymentApply", "asset", "survey", "initiated"] },
  { role: "finance", keys: ["query", "paymentApply", "reimbursement", "initiated", "archive", "contractPrecheck", "projects", "fuel"] },
  { role: "operator", keys: ["operatorLog", "reimbursement", "asset", "survey", "fuel", "maintenance", "initiated", "projects"] }
];

const canUse = (entry, roles) =>
  !entry.roles || entry.roles.some((role) => roles.includes(role));

const usageScore = (usage, key) => {
  const count = Number(usage[key] || 0);
  return count >= USAGE_THRESHOLD ? count : 0;
};

/** 用得多的排前面，其余保持原来的顺序。 */
const rankEntries = (entries, usage) =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        usageScore(usage, b.entry.key) - usageScore(usage, a.entry.key) ||
        a.index - b.index
    )
    .map((item) => item.entry);

const toEntryView = ({ key, label, tone, path }) => ({
  key,
  label,
  tone,
  path,
  icon: `/assets/workbench/${key}.png`
});

const buildEntrySections = (roles, usage) => {
  const allowed = ENTRIES.filter((entry) => canUse(entry, roles));
  const defaults = (COMMON_BY_ROLE.find((item) => roles.includes(item.role)) ||
    COMMON_BY_ROLE[COMMON_BY_ROLE.length - 1]).keys;
  const defaultRank = (entry) => {
    const index = defaults.indexOf(entry.key);
    return index < 0 ? defaults.length : index;
  };
  const ordered = allowed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => defaultRank(a.entry) - defaultRank(b.entry) || a.index - b.index)
    .map((item) => item.entry);
  const ranked = rankEntries(ordered, usage);
  return {
    common: ranked.slice(0, COMMON_SIZE).map(toEntryView),
    more: ranked.slice(COMMON_SIZE).map(toEntryView)
  };
};

const TODO_TILES = [
  { key: "pending", label: "待审批", path: "/pages/approval/index" },
  { key: "returned", label: "被退回", path: "/pages/approval-initiated/index" },
  { key: "review", label: "待复核", path: "/pages/external-log-review/index", roles: MANAGE_ROLES },
  { key: "warning", label: "进度预警", path: "/pages/progress/index", roles: FIELD_ROLES },
  { key: "tasks", label: "库房任务", path: "/pages/warehouse-task/index", roles: FIELD_ROLES }
];

/** 这个角色要取哪些待办数字；取不了的接口不必发请求。 */
const todoKeysFor = (roles) =>
  TODO_TILES.filter((tile) => canUse(tile, roles)).map((tile) => tile.key);

const isIdle = (tile) => tile.key !== "pending" && tile.key !== "returned" && tile.count === 0;

/**
 * 放不下时先去掉没有事的（从后往前），待审批和被退回一直在。有事的不会被挤掉。
 * 没取到的数字是 null，显示「-」，不能显示成 0 让人以为没有待办。
 */
const buildTodoTiles = (roles, counts) => {
  const tiles = TODO_TILES.filter((tile) => canUse(tile, roles)).map((tile) => {
    const count = counts[tile.key];
    const known = typeof count === "number";
    return {
      key: tile.key,
      label: tile.label,
      path: tile.path,
      count,
      countText: known ? String(count) : "-",
      alert: known && count > 0
    };
  });
  const removable = tiles.filter(isIdle).reverse();
  const dropCount = Math.max(0, tiles.length - TODO_MAX);
  const dropped = removable.slice(0, dropCount).map((tile) => tile.key);
  return tiles.filter((tile) => !dropped.includes(tile.key));
};

const pad = (value) => String(value).padStart(2, "0");

const toBeijing = (date) => new Date(date.getTime() + 8 * 60 * 60 * 1000);

const toShortTime = (value) => {
  const date = new Date(value || "");
  if (!value || Number.isNaN(date.getTime())) return "";
  const bj = toBeijing(date);
  return `${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
};

/** 摘要多是「单号 | 内容」。一行放不下，先看内容，单号进详情再看。 */
const stripSerial = (summary) =>
  summary.replace(/^[A-Za-z]+-[\d-]+\s*\|\s*/, "") || summary;

const buildPendingPreview = (rows, toName) =>
  (rows || []).slice(0, PENDING_PREVIEW_SIZE).map((row) => {
    const typeText = bizTypeLabel(row.biz_type);
    const amount = formatAmount(row.biz_amount);
    return {
      id: row.id,
      title: stripSerial(humanizeBizSummary(row.biz_summary)) || typeText,
      amountText: row.biz_amount === null || row.biz_amount === undefined || amount === "-" ? "" : `¥${amount}`,
      metaText: [
        typeText,
        row.initiator_userid ? toName(row.initiator_userid) : "",
        toShortTime(row.submitted_at)
      ]
        .filter(Boolean)
        .join("  ")
    };
  });

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const greetingOf = (hour) => {
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};

const buildGreeting = (now, name) => {
  const bj = toBeijing(now);
  const greeting = greetingOf(bj.getUTCHours());
  return {
    text: name ? `${greeting}，${name}` : greeting,
    dateText: `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 ${WEEKDAYS[bj.getUTCDay()]}`
  };
};

module.exports = {
  buildEntrySections,
  buildGreeting,
  buildPendingPreview,
  buildTodoTiles,
  rankEntries,
  todoKeysFor
};
