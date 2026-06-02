import type { Env } from "../types/env";
import type { ProjectWeComBotBinding } from "../types/wecom-tools";
import { ensureActiveProjectPublicLogLink, type ProjectPublicLogLink } from "./public-log-link";

export type ProjectLogPushEventType =
  | "MANAGER_LOG_CREATED"
  | "MANAGER_LOG_UPDATED"
  | "OPERATOR_LOG_CREATED"
  | "OPERATOR_LOG_UPDATED"
  | "EXTERNAL_LOG_ADOPTED";

type WeComPushEventType = ProjectLogPushEventType | "TEST_SEND";

export interface ProjectLogPushPayload {
  event_type: ProjectLogPushEventType;
  project_id: number;
  manager_log_id?: number | null;
  operator_log_id?: number | null;
  external_submission_id?: number | null;
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
  manager_userid: string | null;
  source_type: string | null;
  external_submission_id: number | null;
  external_submitter_name: string | null;
  external_submitter_company: string | null;
  status: string;
  updated_at: string;
};

type OperatorLogBrief = {
  id: number;
  project_id: number;
  section_id: number | null;
  log_date: string;
  shift: string;
  weather: string | null;
  completed_pipe_count: number | null;
  cumulative_pipe_count: number | null;
  footage_m: number | null;
  cumulative_footage_m: number | null;
  main_thrust_text: string | null;
  chamber_pressure_mpa: number | null;
  cutter_current_text: string | null;
  cutter_frequency_hz: number | null;
  soil_type: string | null;
  horizontal_deviation_direction: string | null;
  horizontal_deviation_mm: number | null;
  vertical_deviation_direction: string | null;
  vertical_deviation_mm: number | null;
  issue_summary: string | null;
  remark: string | null;
  operator_userid: string | null;
  source_type: string | null;
  external_submission_id: number | null;
  external_submitter_name: string | null;
  external_submitter_company: string | null;
  section_code: string | null;
  section_name: string | null;
};

type LogPhoto = {
  file_key: string;
  caption: string | null;
};

type ExternalSubmissionPhotoRow = {
  photo_keys_json: string | null;
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

const normalizeBaseUrl = (value: string | null | undefined): string | null => {
  if (!value?.trim()) return null;
  return value.trim().replace(/\/+$/, "");
};

const originFromUrl = (value: string | null | undefined): string | null => {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
};

const getWebBaseUrl = (env: Env): string =>
  normalizeBaseUrl(env.WECOM_TOOL_WEB_BASE_URL) ??
  originFromUrl(env.WECHAT_REDIRECT_URI) ??
  "https://web.hybcdg.com";

const getApiBaseUrl = (env: Env): string =>
  normalizeBaseUrl(env.WECOM_PUSH_API_BASE_URL) ?? "https://api.hybcdg.com";

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

const shiftLabel = (shift: string | null | undefined): string => {
  if (shift === "day") return "白班";
  if (shift === "night") return "夜班";
  return shift || "-";
};

const deviationDirectionLabel = (value: string | null | undefined): string => {
  if (value === "left") return "左偏";
  if (value === "right") return "右偏";
  if (value === "high") return "高";
  if (value === "low") return "低";
  return value || "";
};

const safeParseStringArray = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
};

const uniquePhotos = (photos: LogPhoto[]): LogPhoto[] => {
  const seen = new Set<string>();
  const result: LogPhoto[] = [];
  for (const photo of photos) {
    const key = photo.file_key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...photo, file_key: key });
  }
  return result;
};

const managerEventLabel = (eventType: ProjectLogPushEventType): string => {
  if (eventType === "MANAGER_LOG_CREATED") return "项目日志新增";
  if (eventType === "MANAGER_LOG_UPDATED") return "项目日志更新";
  return "外部项目日志采纳";
};

const operatorEventLabel = (eventType: ProjectLogPushEventType): string => {
  if (eventType === "OPERATOR_LOG_UPDATED") return "施工日志更新";
  if (eventType === "EXTERNAL_LOG_ADOPTED") return "外部施工日志采纳";
  return "施工日志新增";
};

const isMissingWeComMigrationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("project_wecom_bot_binding") || message.includes("project_wecom_push_event")
  );
};

const buildPhotoLinks = (env: Env, photos: LogPhoto[]): string | null => {
  const deduped = uniquePhotos(photos);
  if (deduped.length === 0) return null;
  const apiBaseUrl = getApiBaseUrl(env);
  const links = deduped
    .slice(0, 12)
    .map((photo, index) => {
      const label = photo.caption?.trim() || `照片${index + 1}`;
      return `[${label}](${apiBaseUrl}/api/v1/upload/object/${encodeURIComponent(photo.file_key)})`;
    })
    .join(" ");
  return `> 照片：${links}`;
};

const buildSourceLine = (
  sourceType: string | null,
  userid: string | null,
  submitterName: string | null,
  submitterCompany: string | null
): string | null => {
  if (sourceType === "external") {
    const name = submitterName || "外包人员";
    return `> 来源：外包提交（${[name, submitterCompany].filter(Boolean).join(" / ")}）`;
  }
  return userid ? `> 来源：员工填写（${userid}）` : "> 来源：员工填写";
};

const buildPublicViewUrl = (
  env: Env,
  link: ProjectPublicLogLink | null,
  mode: "view_project" | "view_operator",
  sectionId?: number | null
): string | null => {
  if (!link?.token) return null;
  const params = new URLSearchParams({ mode });
  if (mode === "view_operator" && sectionId) {
    params.set("section_id", String(sectionId));
  }
  return `${getWebBaseUrl(env)}/#/public/project-log/${link.token}?${params.toString()}`;
};

const buildManagerMarkdown = (
  env: Env,
  eventType: ProjectLogPushEventType,
  project: ProjectBrief,
  log: ManagerLogBrief,
  photos: LogPhoto[],
  publicLink: ProjectPublicLogLink | null
): string => {
  const viewUrl = buildPublicViewUrl(env, publicLink, "view_project");
  const lines = [
    `## ${managerEventLabel(eventType)}`,
    `> 项目：${project.project_name}（${project.project_code}）`,
    `> 日期：${log.log_date}`,
    buildSourceLine(
      log.source_type,
      log.manager_userid,
      log.external_submitter_name,
      log.external_submitter_company
    ),
    log.title ? `> 标题：${log.title}` : null,
    stripHtml(log.detail_html) ? `> 内容：${stripHtml(log.detail_html)}` : null,
    log.risk_note ? `> 风险：${log.risk_note}` : null,
    buildPhotoLinks(env, photos),
    viewUrl ? `> 原始链接：[查看项目日志](${viewUrl})` : null
  ];
  return lines.filter((item): item is string => typeof item === "string").join("\n");
};

const buildOperatorMarkdown = (
  env: Env,
  eventType: ProjectLogPushEventType,
  project: ProjectBrief,
  log: OperatorLogBrief,
  photos: LogPhoto[],
  publicLink: ProjectPublicLogLink | null
): string => {
  const viewUrl = buildPublicViewUrl(env, publicLink, "view_operator", log.section_id);
  const sectionText = [log.section_code, log.section_name].filter(Boolean).join(" ") || "-";
  const horizontalDeviation =
    log.horizontal_deviation_direction && log.horizontal_deviation_mm !== null
      ? `${deviationDirectionLabel(log.horizontal_deviation_direction)}${log.horizontal_deviation_mm}mm`
      : "";
  const verticalDeviation =
    log.vertical_deviation_direction && log.vertical_deviation_mm !== null
      ? `${deviationDirectionLabel(log.vertical_deviation_direction)}${log.vertical_deviation_mm}mm`
      : "";
  const deviationText = [horizontalDeviation, verticalDeviation].filter(Boolean).join("，");

  const lines = [
    `## ${operatorEventLabel(eventType)}`,
    `> 项目：${project.project_name}（${project.project_code}）`,
    `> 工作段：${sectionText}`,
    `> 日期：${log.log_date} ${shiftLabel(log.shift)}`,
    buildSourceLine(
      log.source_type,
      log.operator_userid,
      log.external_submitter_name,
      log.external_submitter_company
    ),
    log.weather ? `> 天气：${log.weather}` : null,
    log.completed_pipe_count !== null ? `> 本班下管：${log.completed_pipe_count}节` : null,
    log.cumulative_pipe_count !== null ? `> 累计下管：${log.cumulative_pipe_count}节` : null,
    log.footage_m !== null ? `> 本班顶进：${log.footage_m}m` : null,
    log.cumulative_footage_m !== null ? `> 累计顶进：${log.cumulative_footage_m}m` : null,
    log.cutter_current_text ? `> 刀盘电流：${log.cutter_current_text}` : null,
    log.cutter_frequency_hz !== null ? `> 刀盘频率：${log.cutter_frequency_hz}Hz` : null,
    log.chamber_pressure_mpa !== null ? `> 泥仓压力：${log.chamber_pressure_mpa}MPa` : null,
    log.main_thrust_text ? `> 顶力：${log.main_thrust_text}` : null,
    deviationText ? `> 偏差：${deviationText}` : null,
    log.soil_type ? `> 土质/方式：${log.soil_type}` : null,
    log.issue_summary ? `> 问题：${log.issue_summary}` : null,
    log.remark ? `> 备注：${log.remark}` : null,
    buildPhotoLinks(env, photos),
    viewUrl ? `> 原始链接：[查看工作段日志](${viewUrl})` : null
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

const loadManagerLogPhotos = async (env: Env, managerLogId: number): Promise<LogPhoto[]> => {
  const rows = await env.DB.prepare(
    `SELECT file_key, caption
       FROM manager_log_photo
      WHERE manager_log_id = ?
        AND status = 'active'
      ORDER BY sort_order ASC, id ASC`
  )
    .bind(managerLogId)
    .all<LogPhoto>();
  return rows.results ?? [];
};

const loadExternalSubmissionPhotos = async (
  env: Env,
  submissionId: number | null | undefined
): Promise<LogPhoto[]> => {
  if (!submissionId) return [];
  const row = await env.DB.prepare(
    "SELECT photo_keys_json FROM external_log_submission WHERE id = ?"
  )
    .bind(submissionId)
    .first<ExternalSubmissionPhotoRow>();
  return safeParseStringArray(row?.photo_keys_json ?? null).map((fileKey) => ({
    file_key: fileKey,
    caption: "外包日志照片"
  }));
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
  let publicLink: ProjectPublicLogLink | null;
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
    publicLink = await ensureActiveProjectPublicLogLink(env, payload.project_id);
  } catch (error) {
    if (isMissingWeComMigrationError(error)) return;
    throw error;
  }

  if (!project) return;

  const fetcher = options.fetcher ?? fetch;
  const messages: Array<{
    markdown: string;
    source_biz_type: "manager_log" | "operator_log";
    source_biz_id: number;
  }> = [];

  const managerLogId = Number(payload.manager_log_id ?? 0);
  if (managerLogId > 0) {
    const managerLog = await env.DB.prepare("SELECT * FROM manager_log WHERE id = ?")
      .bind(managerLogId)
      .first<ManagerLogBrief>();
    if (managerLog) {
      const photos = uniquePhotos([
        ...(await loadManagerLogPhotos(env, managerLogId)),
        ...(await loadExternalSubmissionPhotos(
          env,
          payload.external_submission_id ?? managerLog.external_submission_id
        ))
      ]);
      messages.push({
        markdown: buildManagerMarkdown(
          env,
          payload.event_type,
          project,
          managerLog,
          photos,
          publicLink
        ),
        source_biz_type: "manager_log",
        source_biz_id: managerLogId
      });
    }
  }

  const operatorLogId = Number(payload.operator_log_id ?? 0);
  if (operatorLogId > 0) {
    const operatorLog = await env.DB.prepare(
      `SELECT l.*, s.section_code, s.section_name
         FROM operator_log l
         LEFT JOIN project_section s ON s.id = l.section_id
        WHERE l.id = ?`
    )
      .bind(operatorLogId)
      .first<OperatorLogBrief>();
    if (operatorLog) {
      const photos = await loadExternalSubmissionPhotos(
        env,
        payload.external_submission_id ?? operatorLog.external_submission_id
      );
      messages.push({
        markdown: buildOperatorMarkdown(
          env,
          payload.event_type,
          project,
          operatorLog,
          photos,
          publicLink
        ),
        source_biz_type: "operator_log",
        source_biz_id: operatorLogId
      });
    }
  }

  if (messages.length === 0) return;

  for (const binding of bindings.results ?? []) {
    for (const item of messages) {
      await sendMarkdownToBinding(
        env,
        binding,
        item.markdown,
        {
          project_id: payload.project_id,
          source_event_type: payload.event_type,
          source_biz_type: item.source_biz_type,
          source_biz_id: item.source_biz_id
        },
        fetcher
      );
    }
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
