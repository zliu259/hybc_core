/** 个人工作台的视图模型：待办合并排序、角色能用的入口。不碰接口和路由实例。 */
import type { RouteLocationRaw } from "vue-router";
import type { ApprovalInstance, PendingApprovalItem } from "@/api/approval";
import type { ReimbursementEnvelope } from "@/api/reimbursement";
import { toBizTypeLabel } from "@/views/approval/labels";
import { formatMoney } from "@/views/finance/shared/format";

type TagType = "primary" | "success" | "warning" | "danger" | "info";

export type QueueKind = "returned" | "approval" | "fuel";
export type WaitTone = "normal" | "warn" | "late";

export type QueueItem = {
  key: string;
  kind: QueueKind;
  kindLabel: string;
  title: string;
  metaText: string;
  amountText: string;
  waitDays: number;
  waitText: string;
  waitTone: WaitTone;
  actionText: string;
  to: RouteLocationRaw;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WAIT_WARN_DAYS = 3;
const WAIT_LATE_DAYS = 7;

const toWaitDays = (value: string | null | undefined, now: Date): number => {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
};

const toWaitText = (value: string | null | undefined, days: number): string => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return days === 0 ? "今天" : `等了 ${days} 天`;
};

const toWaitTone = (days: number): WaitTone => {
  if (days >= WAIT_LATE_DAYS) return "late";
  return days >= WAIT_WARN_DAYS ? "warn" : "normal";
};

/** 摘要多是「单号 | 内容」。一行放不下，先看内容，单号进详情再看。 */
const stripSerial = (summary: string | null | undefined): string => {
  const text = (summary ?? "").trim();
  return text.replace(/^[A-Za-z]+-[\d-]+\s*\|\s*/, "") || text;
};

const toAmountText = (amount: number | null | undefined): string =>
  amount === null || amount === undefined ? "" : `¥${formatMoney(amount)}`;

export const buildApprovalItem = (
  item: PendingApprovalItem,
  { toName, now }: { toName: (userid: string) => string; now: Date }
): QueueItem => {
  const typeLabel = toBizTypeLabel(item.biz_type);
  const days = toWaitDays(item.submitted_at, now);
  return {
    key: `approval-${item.task_id}`,
    kind: "approval",
    kindLabel: "审批",
    title: stripSerial(item.biz_summary) || typeLabel,
    metaText: [
      typeLabel,
      item.project_name,
      item.initiator_userid ? toName(item.initiator_userid) : "",
      item.current_node_name
    ]
      .filter(Boolean)
      .join("  "),
    amountText: toAmountText(item.biz_amount),
    waitDays: days,
    waitText: toWaitText(item.submitted_at, days),
    waitTone: toWaitTone(days),
    actionText: "审批",
    to: `/approval/detail/${item.id}`
  };
};

export const buildReturnedItem = (
  item: ApprovalInstance,
  {
    now,
    resolveEditRoute
  }: {
    now: Date;
    resolveEditRoute: (item: ApprovalInstance) => RouteLocationRaw | null;
  }
): QueueItem => {
  const typeLabel = toBizTypeLabel(item.biz_type);
  const returnedAt = item.last_updated_at || item.updated_at;
  const days = toWaitDays(returnedAt, now);
  const editRoute = resolveEditRoute(item);
  return {
    key: `returned-${item.id}`,
    kind: "returned",
    kindLabel: "退回",
    title: stripSerial(item.biz_summary) || typeLabel,
    metaText: typeLabel,
    amountText: "",
    waitDays: days,
    waitText: toWaitText(returnedAt, days),
    waitTone: toWaitTone(days),
    actionText: editRoute ? "去修改" : "查看",
    to: editRoute ?? `/approval/detail/${item.id}`
  };
};

export const buildFuelItem = (count: number, path: string): QueueItem => ({
  key: "fuel",
  kind: "fuel",
  kindLabel: "油卡",
  title: "油卡额度申请待处理",
  metaText: "",
  amountText: "",
  waitDays: 0,
  waitText: `${count} 条`,
  waitTone: "normal",
  actionText: "去处理",
  to: path
});

const longestWaitFirst = (a: QueueItem, b: QueueItem) =>
  b.waitDays - a.waitDays;

/** 退回的要我动手，排最前；同类里等得最久的在前。 */
export const mergeQueue = (
  approvals: readonly QueueItem[],
  returned: readonly QueueItem[],
  fuel: QueueItem | null = null
): QueueItem[] => [
  ...[...returned].sort(longestWaitFirst),
  ...(fuel ? [fuel] : []),
  ...[...approvals].sort(longestWaitFirst)
];

/**
 * 还有没显示出来的才给「查看全部」。油卡待办不管几条只占一行，所以按行数算，
 * 否则 3 条审批加 4 条油卡，明明全显示了还会提示查看全部 7 条。
 */
export const queueMoreLink = (
  filter: QueueKind | "all",
  counts: Readonly<Record<QueueKind, number>>,
  visibleCount: number
): { text: string; path: string } | null => {
  const fuelRows = counts.fuel > 0 ? 1 : 0;
  const rowTotal: Record<QueueKind | "all", number> = {
    all: counts.approval + counts.returned + fuelRows,
    approval: counts.approval,
    returned: counts.returned,
    fuel: fuelRows
  };
  if (rowTotal[filter] <= visibleCount) return null;
  const countText =
    filter === "all"
      ? counts.approval + counts.returned + counts.fuel
      : counts[filter];
  return {
    text: `查看全部 ${countText} 条`,
    path:
      filter === "returned" ? "/workspace/my-applications" : "/approval/index"
  };
};

export const buildHeadline = ({
  total,
  oldestDays,
  failed
}: {
  total: number;
  oldestDays: number;
  failed: boolean;
}): string => {
  if (total === 0) {
    return failed ? "待办没有取到，请刷新重试" : "现在没有要你处理的事";
  }
  const count = failed ? `至少 ${total} 件事` : `${total} 件事`;
  return oldestDays > 0
    ? `${count}等你处理，最久的等了 ${oldestDays} 天`
    : `${count}等你处理`;
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const greetingOf = (hour: number): string => {
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};

export const buildGreeting = (
  now: Date
): { text: string; dateText: string } => {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    text: greetingOf(beijing.getUTCHours()),
    dateText: `${beijing.getUTCMonth() + 1}月${beijing.getUTCDate()}日 ${WEEKDAYS[beijing.getUTCDay()]}`
  };
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "超级管理员",
  finance: "财务人员",
  manager: "项目经理",
  site_manager: "现场经理",
  operator: "操作员"
};

export const toRoleLabel = (roles: readonly string[]): string =>
  roles
    .map(role => ROLE_LABELS[role])
    .filter(Boolean)
    .join("、");

export type EntryTone = "blue" | "green" | "orange" | "slate";

export type WorkbenchEntry = {
  key: string;
  label: string;
  tone: EntryTone;
  path: string;
};

type EntryDefinition = WorkbenchEntry & { roles?: readonly string[] };

const OFFICE = ["super_admin", "manager", "finance"];
const MANAGE = ["super_admin", "manager", "site_manager"];
const FIELD = ["super_admin", "manager", "site_manager", "operator"];

/** 角色和 router/modules 里页面的 roles 保持一致，只放进得去的。 */
const ENTRIES: readonly EntryDefinition[] = [
  {
    key: "projects",
    label: "项目大厅",
    tone: "blue",
    path: "/field/projects",
    roles: MANAGE
  },
  {
    key: "contract",
    label: "合同管理",
    tone: "blue",
    path: "/finance/contract",
    roles: OFFICE
  },
  {
    key: "payment",
    label: "付款管理",
    tone: "orange",
    path: "/finance/payment",
    roles: OFFICE
  },
  {
    key: "receipt",
    label: "收款工作台",
    tone: "orange",
    path: "/finance/receipt/workbench",
    roles: OFFICE
  },
  {
    key: "reimbursementDesk",
    label: "报销工作台",
    tone: "orange",
    path: "/finance/reimbursement",
    roles: OFFICE
  },
  {
    key: "snapshot",
    label: "财务报表",
    tone: "slate",
    path: "/finance/snapshot",
    roles: OFFICE
  },
  {
    key: "approvalMonitor",
    label: "审批监控",
    tone: "slate",
    path: "/approval/admin-monitor",
    roles: ["super_admin", "manager"]
  },
  {
    key: "progress",
    label: "进度预警",
    tone: "blue",
    path: "/construction/progress-alert",
    roles: FIELD
  },
  {
    key: "managerLog",
    label: "管理员日志",
    tone: "green",
    path: "/construction/manager-log",
    roles: MANAGE
  },
  {
    key: "operatorLog",
    label: "填施工日志",
    tone: "green",
    path: "/construction/operator-log/form",
    roles: FIELD
  },
  {
    key: "survey",
    label: "现场勘查",
    tone: "green",
    path: "/construction/site-survey",
    roles: FIELD
  },
  {
    key: "breakthrough",
    label: "贯通报告",
    tone: "green",
    path: "/construction/breakthrough-report",
    roles: FIELD
  },
  {
    key: "logBoard",
    label: "日志公示",
    tone: "blue",
    path: "/construction/dashboard",
    roles: FIELD
  },
  {
    key: "ledger",
    label: "设备台账",
    tone: "green",
    path: "/warehouse-assets/ledger",
    roles: MANAGE
  },
  {
    key: "warehouseTasks",
    label: "任务调度",
    tone: "green",
    path: "/warehouse-assets/tasks",
    roles: MANAGE
  },
  {
    key: "fuelProcess",
    label: "油卡处理",
    tone: "orange",
    path: "/finance/fleet/processing",
    roles: ["super_admin", "finance"]
  },
  {
    key: "maintenance",
    label: "车辆保养",
    tone: "orange",
    path: "/finance/fleet/maintenance"
  },
  {
    key: "myApplications",
    label: "我的申请",
    tone: "slate",
    path: "/workspace/my-applications"
  },
  {
    key: "myReimbursement",
    label: "我的报销",
    tone: "slate",
    path: "/workspace/my-reimbursement"
  }
];

const COMMON_BY_ROLE: readonly { role: string; keys: readonly string[] }[] = [
  {
    role: "super_admin",
    keys: [
      "projects",
      "contract",
      "payment",
      "approvalMonitor",
      "receipt",
      "reimbursementDesk",
      "snapshot",
      "progress"
    ]
  },
  {
    role: "manager",
    keys: [
      "projects",
      "contract",
      "payment",
      "approvalMonitor",
      "receipt",
      "reimbursementDesk",
      "snapshot",
      "progress"
    ]
  },
  {
    role: "site_manager",
    keys: [
      "managerLog",
      "operatorLog",
      "projects",
      "progress",
      "survey",
      "ledger",
      "warehouseTasks",
      "maintenance"
    ]
  },
  {
    role: "finance",
    keys: [
      "payment",
      "contract",
      "reimbursementDesk",
      "receipt",
      "snapshot",
      "fuelProcess",
      "maintenance",
      "myApplications"
    ]
  },
  {
    role: "operator",
    keys: [
      "operatorLog",
      "survey",
      "progress",
      "breakthrough",
      "logBoard",
      "maintenance",
      "myApplications",
      "myReimbursement"
    ]
  }
];

const canUse = (entry: EntryDefinition, roles: readonly string[]) =>
  !entry.roles || entry.roles.some(role => roles.includes(role));

export const buildCommonEntries = (
  roles: readonly string[]
): WorkbenchEntry[] => {
  const matched =
    COMMON_BY_ROLE.find(item => roles.includes(item.role)) ??
    COMMON_BY_ROLE[COMMON_BY_ROLE.length - 1];
  return matched.keys
    .map(key => ENTRIES.find(entry => entry.key === key))
    .filter(
      (entry): entry is EntryDefinition =>
        entry !== undefined && canUse(entry, roles)
    )
    .map(({ key, label, tone, path }) => ({ key, label, tone, path }));
};

export type StartAction = { key: string; label: string; path: string };

export const buildStartActions = (): StartAction[] => [
  {
    key: "reimbursement",
    label: "发起报销",
    path: "/workspace/my-reimbursement/detail/create"
  },
  { key: "payment", label: "发起对外付款", path: "/workspace/payment/wizard" },
  { key: "fuel", label: "油卡额度申请", path: "/workspace/fuel-application" }
];

/** 油卡待办点过去要进得去：处理台只给超管和财务，经理看全量记录；其他角色不显示。 */
export const fuelDeskPath = (roles: readonly string[]): string | null => {
  if (roles.includes("super_admin") || roles.includes("finance")) {
    return "/finance/fleet/processing";
  }
  return roles.includes("manager") ? "/finance/fleet/applications-all" : null;
};

/** 还没走完的报销。已打款、已驳回、已取消的不算进度。 */
export const ACTIVE_REIMBURSEMENT_STATUSES = [
  "unregistered",
  "draft",
  "submitted",
  "received",
  "batched",
  "pending_approval"
] as const;

const WAITING_ON_ME_STATUSES = ["unregistered", "draft"];

export type ReimbursementRow = {
  id: number;
  projectText: string;
  amountText: string;
  dateText: string;
  statusText: string;
  statusType: TagType;
};

export const buildReimbursementRow = (
  item: ReimbursementEnvelope
): ReimbursementRow => {
  const waitingOnMe = WAITING_ON_ME_STATUSES.includes(item.status);
  return {
    id: item.id,
    projectText: item.project_name || `项目#${item.project_id}`,
    amountText: `¥${formatMoney(item.amount)}`,
    dateText: (item.expense_date || item.created_at || "").slice(0, 10),
    statusText: waitingOnMe ? "待提交" : "审核中",
    statusType: waitingOnMe ? "warning" : "primary"
  };
};
