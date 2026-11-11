import type { TaskQuery } from "@/api/wh/task";
import type { TaskRow } from "@/api/wh/types";

export type TaskFilter =
  | ""
  | "unassigned"
  | "assigned"
  | "submitted"
  | "done"
  | "cancelled";

export const TASK_FILTERS: { value: Exclude<TaskFilter, "">; label: string }[] =
  [
    { value: "unassigned", label: "待派工" },
    { value: "assigned", label: "待执行" },
    { value: "submitted", label: "待确认" },
    { value: "done", label: "已完成" },
    { value: "cancelled", label: "已取消" }
  ];

/** 页面筛选换成接口参数：待派工和待执行都是 todo，用有没有执行人区分。 */
export const taskFilterQuery = (
  filter: TaskFilter
): Pick<TaskQuery, "status" | "assigned"> => {
  if (filter === "unassigned") return { status: "todo", assigned: "no" };
  if (filter === "assigned") return { status: "todo", assigned: "yes" };
  return filter ? { status: filter } : {};
};

/** 地址栏 ?status= 的值（总览卡片跳过来时带），不认识的当作不筛选。 */
export const parseTaskFilter = (value: unknown): TaskFilter =>
  TASK_FILTERS.some(item => item.value === value) ? (value as TaskFilter) : "";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export const beijingToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);

/** 期限是日期（北京时间），当天还不算超期；结束的任务不算。 */
export const isOverdue = (
  task: Pick<TaskRow, "due_date" | "status">,
  today: string
): boolean =>
  Boolean(task.due_date) &&
  (task.status === "todo" || task.status === "submitted") &&
  (task.due_date as string) < today;

export interface TaskActions {
  /** 传照片、删自己的照片、提交 */
  canWork: boolean;
  /** 派工或改派 */
  canAssign: boolean;
  /** 确认完成、退回补充 */
  canReview: boolean;
  canCancel: boolean;
}

/**
 * 界面上谁能做什么。后端允许库管替执行人提交，界面上只给执行人本人
 * 提交区：库管要自己做就先派给自己，记录里执行人才对得上。
 */
export const taskActions = (
  task: Pick<TaskRow, "status" | "assignee_userid">,
  viewer: { userid: string; isKeeper: boolean }
): TaskActions => {
  const open = task.status === "todo" || task.status === "submitted";
  return {
    canWork:
      task.status === "todo" &&
      task.assignee_userid !== null &&
      task.assignee_userid === viewer.userid,
    canAssign: viewer.isKeeper && task.status === "todo",
    canReview: viewer.isKeeper && task.status === "submitted",
    canCancel: viewer.isKeeper && open
  };
};

export const photoProgress = (
  task: Pick<TaskRow, "photo_count" | "required_photo_count">
): string =>
  task.required_photo_count > 0
    ? `${task.photo_count}/${task.required_photo_count}`
    : `${task.photo_count}`;

export const isConflictError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const response = (error as { response?: { status?: unknown } }).response;
  return response?.status === 409;
};
