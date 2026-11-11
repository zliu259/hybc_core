import type { TaskRow, TaskSystem } from "@/api/wh/types";
import { TASK_SYSTEM_LABELS } from "../shared/labels";

export interface RepairGroup {
  system: TaskSystem;
  label: string;
  entries: { done_at: string; task_no: string; note: string }[];
}

const ORDER: TaskSystem[] = ["hydraulic", "electric", "drive", "other"];

const parseSystems = (json: string | null): TaskSystem[] => {
  try {
    const value: unknown = JSON.parse(json ?? "[]");
    const systems = Array.isArray(value)
      ? value.filter((item): item is TaskSystem =>
          ORDER.includes(item as TaskSystem)
        )
      : [];
    return systems.length > 0 ? systems : ["other"];
  } catch {
    return ["other"];
  }
};

/**
 * "维修使用记录表"的维修部分：已完成的维修任务按液压、电气、传动、其他分组。
 * 一个任务涉及多个系统时在每个系统下都出现；空组不返回。
 */
export const buildRepairGroups = (tasks: TaskRow[]): RepairGroup[] => {
  const groups = new Map<TaskSystem, RepairGroup["entries"]>();
  for (const task of tasks) {
    if (task.kind !== "maintenance" || task.status !== "done") continue;
    for (const system of new Set(parseSystems(task.systems_json))) {
      const entries = groups.get(system) ?? [];
      entries.push({
        done_at: task.done_at ?? "",
        task_no: task.task_no,
        note: task.result_note ?? ""
      });
      groups.set(system, entries);
    }
  }
  return ORDER.filter(system => groups.has(system)).map(system => ({
    system,
    label: TASK_SYSTEM_LABELS[system],
    entries: [...(groups.get(system) ?? [])].sort((a, b) =>
      b.done_at.localeCompare(a.done_at)
    )
  }));
};
