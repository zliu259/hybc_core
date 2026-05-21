import type { Env } from "../types/env";
import type { ProjectWeComBotBinding } from "../types/wecom-tools";

export type ProjectLogPushEventType =
  | "MANAGER_LOG_CREATED"
  | "MANAGER_LOG_UPDATED"
  | "EXTERNAL_LOG_ADOPTED";

type WeComPushEventType = ProjectLogPushEventType | "TEST_SEND";

export interface ProjectLogPushPayload {
  event_type: ProjectLogPushEventType;
  project_id: number;
  manager_log_id: number;
}

type ProjectBrief = {
  id: number;
  project_code: string;
  project_name: string;
};

type ManagerLogBrief = {
  id: number;
  project_id: number;
  log_date: string;
  title: string | null;
  detail_html: string | null;
  risk_note: string | null;
  status: string;
  updated_at: string;
};

type PushOptions = {
  fetcher?: typeof fetch;
  projectId?: number;
};

type PushDeliveryResult = {
  status: "sent" | "failed";
  error_message?: string | null;
};

const nowIso = () => new Date().toISOString();

const stripHtml = (html: string | null): string => {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const eventLabel = (eventType: ProjectLogPushEventType): string => {
  if (eventType === "MANAGER_LOG_CREATED") return "项目日志新增";
  if (eventType === "MANAGER_LOG_UPDATED") return "项目日志更新";
  return "外部日志采纳";
};

const isMissingWeComMigrationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("project_wecom_bot_binding") || message.includes("project_wecom_push_event")
  );
};

const buildMarkdown = (
  eventType: ProjectLogPushEventType,
  project: ProjectBrief,
  log: ManagerLogBrief
): string => {
  const lines = [
    `## ${eventLabel(eventType)}`,
    `> 项目：${project.project_name}（${project.project_code}）`,
    `> 日期：${log.log_date}`,
    log.title ? `> 标题：${log.title}` : null,
    stripHtml(log.detail_html) ? `> 内容：${stripHtml(log.detail_html)}` : null,
    log.risk_note ? `> 风险：${log.risk_note}` : null
  ];
  return lines.filter((item): item is string => typeof item === "string").join("\n");
};

const buildTestMarkdown = (project: ProjectBrief, binding: ProjectWeComBotBinding): string => {
  return [
    "## 测试推送",
    `> 项目：${project.project_name}（${project.project_code}）`,
    `> 绑定：${binding.binding_name}`,
    `> 时间：${nowIso()}`
  ].join("\n");
};

const recordPushEvent = async (
  env: Env,
  input: {
    binding: ProjectWeComBotBinding;
    project_id: number;
    source_event_type: WeComPushEventType;
    source_biz_type: string;
    source_biz_id: number;
    message_summary: string;
    status: "sent" | "failed" | "skipped";
    error_message?: string | null;
  }
) => {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO project_wecom_push_event
      (binding_id, project_id, source_event_type, source_biz_type, source_biz_id,
       message_type, message_summary, status, error_message, webhook_secret_ref,
       retry_count, pushed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, 0, ?, ?, ?)`
  )
    .bind(
      input.binding.id,
      input.project_id,
      input.source_event_type,
      input.source_biz_type,
      input.source_biz_id,
      input.message_summary,
      input.status,
      input.error_message ?? null,
      input.binding.push_webhook_secret_ref,
      input.status === "sent" ? now : null,
      now,
      now
    )
    .run();
};

const sendMarkdownToBinding = async (
  env: Env,
  binding: ProjectWeComBotBinding,
  markdown: string,
  event: {
    project_id: number;
    source_event_type: WeComPushEventType;
    source_biz_type: string;
    source_biz_id: number;
  },
  fetcher: typeof fetch
): Promise<PushDeliveryResult> => {
  const secretRef = binding.push_webhook_secret_ref?.trim();
  if (!secretRef) {
    await recordPushEvent(env, {
      binding,
      ...event,
      message_summary: markdown,
      status: "failed",
      error_message: "Webhook secret ref is empty"
    });
    return { status: "failed", error_message: "Webhook secret ref is empty" };
  }

  const webhookUrl = await env.KV.get(`wecom:group-webhook:${secretRef}`);
  if (!webhookUrl) {
    await recordPushEvent(env, {
      binding,
      ...event,
      message_summary: markdown,
      status: "failed",
      error_message: "Webhook secret not found"
    });
    return { status: "failed", error_message: "Webhook secret not found" };
  }

  try {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: markdown }
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook response ${response.status}`);
    }
    const data = (await response.json().catch(() => ({}))) as {
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode !== undefined && data.errcode !== 0) {
      throw new Error(data.errmsg || `Webhook errcode ${data.errcode}`);
    }

    await recordPushEvent(env, {
      binding,
      ...event,
      message_summary: markdown,
      status: "sent"
    });
    return { status: "sent" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Webhook push failed";
    await recordPushEvent(env, {
      binding,
      ...event,
      message_summary: markdown,
      status: "failed",
      error_message: errorMessage
    });
    return { status: "failed", error_message: errorMessage };
  }
};

export const pushProjectLogEventToWeComGroups = async (
  env: Env,
  payload: ProjectLogPushPayload,
  options: PushOptions = {}
): Promise<void> => {
  let bindings: D1Result<ProjectWeComBotBinding>;
  let project: ProjectBrief | null;
  let managerLog: ManagerLogBrief | null;
  try {
    bindings = await env.DB.prepare(
      `SELECT * FROM project_wecom_bot_binding
        WHERE project_id = ? AND status = 'active' AND push_enabled = 1
        ORDER BY id ASC`
    )
      .bind(payload.project_id)
      .all<ProjectWeComBotBinding>();

    project = await env.DB.prepare(
      "SELECT id, project_code, project_name FROM project WHERE id = ?"
    )
      .bind(payload.project_id)
      .first<ProjectBrief>();
    managerLog = await env.DB.prepare("SELECT * FROM manager_log WHERE id = ?")
      .bind(payload.manager_log_id)
      .first<ManagerLogBrief>();
  } catch (error) {
    if (isMissingWeComMigrationError(error)) return;
    throw error;
  }

  if (!project || !managerLog) return;

  const markdown = buildMarkdown(payload.event_type, project, managerLog);
  const fetcher = options.fetcher ?? fetch;

  for (const binding of bindings.results ?? []) {
    await sendMarkdownToBinding(
      env,
      binding,
      markdown,
      {
        project_id: payload.project_id,
        source_event_type: payload.event_type,
        source_biz_type: "manager_log",
        source_biz_id: payload.manager_log_id
      },
      fetcher
    );
  }
};

export const sendProjectWeComBindingTestMessage = async (
  env: Env,
  bindingId: number,
  options: PushOptions = {}
): Promise<void> => {
  const binding = await env.DB.prepare("SELECT * FROM project_wecom_bot_binding WHERE id = ?")
    .bind(bindingId)
    .first<ProjectWeComBotBinding>();
  if (!binding || binding.status !== "active" || binding.push_enabled !== 1) {
    throw new Error("Active push-enabled WeCom binding not found");
  }
  if (options.projectId !== undefined && binding.project_id !== options.projectId) {
    throw new Error("WeCom binding not found in project");
  }

  const project = await env.DB.prepare(
    "SELECT id, project_code, project_name FROM project WHERE id = ?"
  )
    .bind(binding.project_id)
    .first<ProjectBrief>();
  if (!project) {
    throw new Error("Project not found");
  }

  const result = await sendMarkdownToBinding(
    env,
    binding,
    buildTestMarkdown(project, binding),
    {
      project_id: binding.project_id,
      source_event_type: "TEST_SEND",
      source_biz_type: "test_send",
      source_biz_id: binding.id
    },
    options.fetcher ?? fetch
  );
  if (result.status !== "sent") {
    throw new Error(result.error_message ?? "Webhook test push failed");
  }
};
