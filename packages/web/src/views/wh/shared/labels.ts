import type {
  DeviceState,
  MaterialKind,
  TaskKind,
  TaskStatus,
  TaskSystem,
  WhDocType
} from "@/api/wh/types";

export const DEVICE_STATE_LABELS: Record<DeviceState, string> = {
  scrapped: "已报废",
  on_project: "在项目",
  repairing: "维修中",
  pending_inspection: "待检",
  blocked: "暂不可用",
  available: "可用"
};

export const DEVICE_STATE_TAG: Record<
  DeviceState,
  "success" | "warning" | "danger" | "info"
> = {
  available: "success",
  pending_inspection: "warning",
  blocked: "warning",
  repairing: "danger",
  on_project: "info",
  scrapped: "info"
};

export const DOC_TYPE_LABELS: Record<WhDocType, string> = {
  opening: "期初",
  inbound: "入库",
  out: "发往项目",
  back: "项目返库",
  transfer: "项目间转场",
  adjust: "盘点调整",
  scrap: "报废",
  unscrap: "撤销报废"
};

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  other: "其他"
};

export const TASK_SYSTEM_LABELS: Record<TaskSystem, string> = {
  hydraulic: "液压",
  electric: "电气",
  drive: "传动",
  other: "其他"
};

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  turnover: "周转",
  consumable: "消耗"
};

export const MATERIAL_CATEGORIES = [
  "顶进设备",
  "辅助设备",
  "注浆设备",
  "控制照明系统",
  "测量工具",
  "工具",
  "手动工具",
  "劳动保护",
  "施工消耗材料",
  "生活设施",
  "设备维修配件"
] as const;

export const taskStatusLabel = (task: {
  status: TaskStatus;
  assignee_userid: string | null;
  photo_count: number;
}): string => {
  if (task.status === "submitted") return "待确认";
  if (task.status === "done") return "已完成";
  if (task.status === "cancelled") return "已取消";
  if (!task.assignee_userid) return "待派工";
  return task.photo_count > 0 ? "进行中" : "待执行";
};
