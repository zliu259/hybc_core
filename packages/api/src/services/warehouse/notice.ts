/**
 * 库房通知：写操作成功后发一个事件进队列，由队列消费者去查库、定收件人、发企微卡片。
 * 发布绝不影响业务写入；队列里取出来的内容当外部数据校验。
 */
import type { Env } from "../../types/env";
import { publishEvent } from "../event-bus";

export type WarehouseNotice =
  | { kind: "kit_submitted" | "kit_confirmed"; kit_id: number }
  | { kind: "tasks_assigned"; task_ids: number[] }
  | { kind: "task_sent_back" | "task_submitted" | "repair_created"; task_id: number }
  | { kind: "doc_posted"; doc_id: number }
  /** 每日摘要：date 是北京日期，内容在投递时现算 */
  | { kind: "daily_digest"; date: string };

export type QueuedWarehouseNotice = WarehouseNotice & { actor_userid: string };

const MAX_TASK_IDS = 200;

/** 发进事件队列。永不抛出：失败只记日志，业务写入已经成功了。 */
export const publishWarehouseNotice = async (
  env: Env,
  notice: WarehouseNotice,
  actorUserid: string
): Promise<void> => {
  try {
    await publishEvent(env, "WAREHOUSE_NOTICE", "warehouse", {
      ...notice,
      actor_userid: actorUserid
    });
  } catch (error) {
    console.error("[warehouse] 通知事件发布失败", { kind: notice.kind, error });
  }
};

const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/** 队列里取出来的 payload → 通知；不认识的返回 null。 */
export const parseWarehouseNotice = (payload: unknown): QueuedWarehouseNotice | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const actor = typeof raw.actor_userid === "string" ? raw.actor_userid.trim() : "";
  if (!actor) return null;
  switch (raw.kind) {
    case "kit_submitted":
    case "kit_confirmed":
      return isId(raw.kit_id) ? { kind: raw.kind, kit_id: raw.kit_id, actor_userid: actor } : null;
    case "tasks_assigned": {
      const ids = Array.isArray(raw.task_ids) ? raw.task_ids : [];
      if (ids.length === 0 || ids.length > MAX_TASK_IDS || !ids.every(isId)) return null;
      return { kind: "tasks_assigned", task_ids: [...new Set(ids)], actor_userid: actor };
    }
    case "task_sent_back":
    case "task_submitted":
    case "repair_created":
      return isId(raw.task_id)
        ? { kind: raw.kind, task_id: raw.task_id, actor_userid: actor }
        : null;
    case "doc_posted":
      return isId(raw.doc_id)
        ? { kind: "doc_posted", doc_id: raw.doc_id, actor_userid: actor }
        : null;
    case "daily_digest":
      return typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
        ? { kind: "daily_digest", date: raw.date, actor_userid: actor }
        : null;
    default:
      return null;
  }
};
