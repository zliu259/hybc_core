/**
 * 库房通知的投递（队列消费者里跑）：查业务行、定收件人、建卡片、发企微。
 * "不用发"的情况都正常返回，消息会被确认；只有真的发送失败才抛出，让队列重试。
 */
import type { Env } from "../../types/env";
import type { WhTaskKind } from "../../types/wh";
import { resolveWeComLinkTargets, sendWeComTemplateCard } from "../wecom-approval-push";
import { getWeComContactBook } from "../wecom-contact-book";
import { getProjectKitHeader } from "./kit-query";
import { parseWarehouseNotice, type QueuedWarehouseNotice } from "./notice";
import {
  buildNoticeCard,
  NOTICE_PAGES,
  recipientsExcept,
  type NoticeCardInput,
  type NoticeLinks
} from "./notice-cards";
import { docDrafts } from "./notice-doc";
import { queryIn } from "./query-in";
import { getWarehouseSettings } from "./settings";
import { SELECT_TASK, type TaskRow } from "./task-query";

export type NoticeSender = typeof sendWeComTemplateCard;

export interface NoticeDeps {
  send?: NoticeSender;
  loadNames?: () => Promise<Map<string, string>>;
  /** 默认是 resolveWeComLinkTargets */
  resolveLinks?: (env: Env) => Promise<NoticeLinks>;
}

export interface NoticeOutcome {
  sent: number;
  skipped: "disabled" | "invalid" | "no_recipient" | "no_link" | "gone" | null;
}

/** 一张待发的卡片：发给谁、写什么。 */
export interface NoticeDraft {
  touser: string[];
  input: NoticeCardInput;
}

export type NameOf = (userid: string | null) => string;

const TASK_KIND_LABELS: Record<WhTaskKind, string> = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  other: "其他"
};
const TASK_WEB_PATH = "/wh/task";
const nowIso = () => new Date().toISOString();

const loadKeepers = async (env: Env): Promise<string[]> => {
  const rows = await env.DB.prepare(
    "SELECT userid FROM warehouse_member WHERE role = 'keeper' ORDER BY userid ASC"
  ).all<{ userid: string }>();
  return (rows.results ?? []).map((row) => row.userid);
};

const loadTasks = (env: Env, ids: readonly number[]): Promise<TaskRow[]> =>
  queryIn<TaskRow>(
    env.DB,
    (inList) => `${SELECT_TASK} WHERE t.id IN (${inList}) ORDER BY t.id ASC`,
    ids
  );

const deviceText = (task: TaskRow): string =>
  task.device_code ? `${task.device_code} ${task.device_name ?? ""}`.trim() : "无设备";

const kitDrafts = async (
  env: Env,
  notice: Extract<QueuedWarehouseNotice, { kit_id: number }>,
  nameOf: NameOf
): Promise<NoticeDraft[] | null> => {
  const kit = await getProjectKitHeader(env, notice.kit_id);
  if (!kit) return null;
  const submitted = notice.kind === "kit_submitted";
  const candidates = submitted ? await loadKeepers(env) : [kit.submitted_by_userid];
  return [
    {
      touser: recipientsExcept(candidates, notice.actor_userid),
      input: {
        title: submitted ? "配套清单待确认" : "配套清单已确认",
        desc: kit.project_name,
        lines: [
          { keyname: "清单", value: `${kit.kit_no} ${kit.title}` },
          submitted
            ? { keyname: "提交人", value: nameOf(kit.submitted_by_userid ?? notice.actor_userid) }
            : { keyname: "确认人", value: nameOf(kit.confirmed_by_userid ?? notice.actor_userid) },
          ...(submitted ? [{ keyname: "行数", value: `${kit.line_count} 行` }] : [])
        ],
        pagePath: NOTICE_PAGES.kit(kit.id),
        webPath: `/wh/kit/${kit.id}`
      }
    }
  ];
};

const singleTaskInput = (task: TaskRow): NoticeCardInput => ({
  title: `库房任务：${task.title}`,
  desc: deviceText(task),
  lines: [
    { keyname: "类型", value: TASK_KIND_LABELS[task.kind] ?? "任务" },
    { keyname: "期限", value: task.due_date ?? "无" },
    {
      keyname: "照片",
      value: task.required_photo_count > 0 ? `至少 ${task.required_photo_count} 张` : ""
    }
  ],
  pagePath: NOTICE_PAGES.task(task.id),
  webPath: TASK_WEB_PATH
});

const manyTasksInput = (tasks: readonly TaskRow[]): NoticeCardInput => {
  const codes = tasks.flatMap((task) => (task.device_code ? [task.device_code] : []));
  const dueDates = tasks.flatMap((task) => (task.due_date ? [task.due_date] : [])).sort();
  return {
    title: `库房任务：${tasks.length} 个待办`,
    desc: codes.length ? codes.slice(0, 3).join("、") : "无设备",
    lines: [{ keyname: "最早期限", value: dueDates[0] ?? "无" }],
    pagePath: NOTICE_PAGES.myTasks,
    webPath: TASK_WEB_PATH
  };
};

/** 只算现在还待执行、有执行人的任务；同一个执行人合成一张。 */
const assignedDrafts = async (
  env: Env,
  notice: Extract<QueuedWarehouseNotice, { kind: "tasks_assigned" }>
): Promise<NoticeDraft[] | null> => {
  const tasks = await loadTasks(env, notice.task_ids);
  if (tasks.length === 0) return null;
  const byAssignee = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    if (task.status !== "todo" || !task.assignee_userid) continue;
    byAssignee.set(task.assignee_userid, [...(byAssignee.get(task.assignee_userid) ?? []), task]);
  }
  return [...byAssignee].map(([assignee, list]) => ({
    touser: recipientsExcept([assignee], notice.actor_userid),
    input: list.length === 1 ? singleTaskInput(list[0]) : manyTasksInput(list)
  }));
};

const taskDrafts = async (
  env: Env,
  notice: Extract<QueuedWarehouseNotice, { task_id: number }>,
  nameOf: NameOf
): Promise<NoticeDraft[] | null> => {
  const [task] = await loadTasks(env, [notice.task_id]);
  if (!task) return null;
  const device = task.device_code ? deviceText(task) : "";
  const link = { pagePath: NOTICE_PAGES.task(task.id), webPath: TASK_WEB_PATH };
  if (notice.kind === "task_sent_back") {
    return [
      {
        touser: recipientsExcept([task.assignee_userid], notice.actor_userid),
        input: {
          title: "任务被退回，请补充",
          desc: task.title,
          lines: [
            { keyname: "要求", value: task.review_note ?? "" },
            { keyname: "设备", value: device }
          ],
          ...link
        }
      }
    ];
  }
  const keepers = recipientsExcept(await loadKeepers(env), notice.actor_userid);
  if (notice.kind === "task_submitted") {
    const result =
      task.kind === "inspection" && task.result ? (task.result === "pass" ? "合格" : "不合格") : "";
    return [
      {
        touser: keepers,
        input: {
          title: "库房任务待确认",
          desc: task.title,
          lines: [
            { keyname: "执行人", value: nameOf(task.assignee_userid ?? notice.actor_userid) },
            { keyname: "结果", value: result },
            { keyname: "设备", value: device }
          ],
          ...link
        }
      }
    ];
  }
  return [
    {
      touser: keepers,
      input: {
        title: "检查不合格，已生成维修任务",
        desc: deviceText(task),
        lines: [
          { keyname: "任务", value: task.task_no },
          { keyname: "说明", value: task.description ?? "" }
        ],
        ...link
      }
    }
  ];
};

/** 返回 null 表示业务行已经不在了。 */
const buildDrafts = (
  env: Env,
  notice: QueuedWarehouseNotice,
  nameOf: NameOf
): Promise<NoticeDraft[] | null> => {
  switch (notice.kind) {
    case "kit_submitted":
    case "kit_confirmed":
      return kitDrafts(env, notice, nameOf);
    case "tasks_assigned":
      return assignedDrafts(env, notice);
    case "doc_posted":
      return docDrafts(env, notice.doc_id, notice.actor_userid, nameOf);
    default:
      return taskDrafts(env, notice, nameOf);
  }
};

/** 通讯录取不到不挡通知，卡片上显示 userid。 */
const loadNameOf = async (env: Env, deps: NoticeDeps): Promise<NameOf> => {
  const load =
    deps.loadNames ??
    (async () =>
      new Map((await getWeComContactBook(env)).users.map((user) => [user.userid, user.name])));
  let names = new Map<string, string>();
  try {
    names = await load();
  } catch (error) {
    console.warn("[warehouse] 通知取不到通讯录，卡片上显示 userid", error);
  }
  return (userid) => (userid ? (names.get(userid) ?? userid) : "");
};

const logFailure = async (
  env: Env,
  notice: QueuedWarehouseNotice,
  error: unknown
): Promise<void> => {
  try {
    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "warehouse_notice_failed",
        "warehouse-notice",
        JSON.stringify({
          ...notice,
          error: error instanceof Error ? error.message : "unknown error"
        }),
        nowIso()
      )
      .run();
  } catch (logError) {
    console.error("[warehouse] 通知失败记录写不进 event_log", logError);
  }
};

export const deliverWarehouseNotice = async (
  env: Env,
  payload: unknown,
  deps: NoticeDeps = {}
): Promise<NoticeOutcome> => {
  const notice = parseWarehouseNotice(payload);
  if (!notice) return { sent: 0, skipped: "invalid" };
  if (!(await getWarehouseSettings(env)).notify_enabled) return { sent: 0, skipped: "disabled" };

  const drafts = await buildDrafts(env, notice, await loadNameOf(env, deps));
  if (drafts === null) return { sent: 0, skipped: "gone" };
  const targeted = drafts.filter((draft) => draft.touser.length > 0);
  if (targeted.length === 0) return { sent: 0, skipped: "no_recipient" };

  const links = await (deps.resolveLinks ?? resolveWeComLinkTargets)(env);
  const messages = targeted.map((draft) => ({
    touser: draft.touser.join("|"),
    card: buildNoticeCard(draft.input, links)
  }));
  if (messages.some((message) => message.card === null)) {
    console.warn("[warehouse] 通知没有可跳转的目标（小程序和 Web 地址都没配）");
    return { sent: 0, skipped: "no_link" };
  }

  const send = deps.send ?? sendWeComTemplateCard;
  try {
    for (const message of messages) {
      await send(env, {
        touser: message.touser,
        template_card: message.card as Record<string, unknown>,
        fallback_error_message: "库房通知发送失败"
      });
    }
  } catch (error) {
    await logFailure(env, notice, error);
    throw error;
  }
  return { sent: messages.length, skipped: null };
};
