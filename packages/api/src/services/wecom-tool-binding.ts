import type { Env } from "../types/env";
import {
  defaultAllowedWeComToolNames,
  isWeComReadOnlyToolName,
  type ProjectWeComBotBinding,
  type ProjectWeComPushEvent,
  type WeComToolCallAudit,
  type WeComReadOnlyToolName
} from "../types/wecom-tools";

const nowIso = () => new Date().toISOString();

export interface ProjectWeComBindingInput {
  project_id: number;
  binding_name: string;
  group_chat_id?: string | null;
  bot_id?: string | null;
  allowed_tools?: unknown[];
  data_scope?: string;
  push_webhook_secret_ref?: string | null;
  push_enabled?: boolean;
  qa_enabled?: boolean;
}

export interface ResolveWeComToolBindingInput {
  tool: string;
  context?: {
    group_chat_id?: string;
    bot_id?: string;
    caller_userid?: string;
  };
}

const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isMissingWeComMigrationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("project_wecom_bot_binding") ||
    message.includes("wecom_tool_call_audit") ||
    message.includes("project_wecom_push_event")
  );
};

export const sanitizeAllowedWeComTools = (
  allowedTools: unknown[] | undefined
): WeComReadOnlyToolName[] => {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return [...defaultAllowedWeComToolNames];
  }

  const result: WeComReadOnlyToolName[] = [];
  const seen = new Set<string>();
  for (const item of allowedTools) {
    if (!isWeComReadOnlyToolName(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }

  return result.length > 0 ? result : [...defaultAllowedWeComToolNames];
};

const parseAllowedTools = (binding: ProjectWeComBotBinding): string[] => {
  try {
    const parsed = JSON.parse(binding.allowed_tools_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const validateBindingInput = (input: ProjectWeComBindingInput): void => {
  if (!Number.isFinite(input.project_id) || input.project_id <= 0) {
    throw new Error("project_id is required");
  }
  if (!cleanText(input.binding_name)) {
    throw new Error("binding_name is required");
  }

  const pushEnabled = input.push_enabled !== false;
  const qaEnabled = input.qa_enabled !== false;
  const webhookSecretRef = cleanText(input.push_webhook_secret_ref);
  const groupChatId = cleanText(input.group_chat_id);
  const botId = cleanText(input.bot_id);

  if (pushEnabled && !webhookSecretRef) {
    throw new Error("push_webhook_secret_ref is required when push is enabled");
  }
  if (qaEnabled && !groupChatId && !botId) {
    throw new Error("group_chat_id or bot_id is required when qa is enabled");
  }
};

export const createProjectWeComBinding = async (
  env: Env,
  input: ProjectWeComBindingInput,
  actorUserid: string | null = null
): Promise<ProjectWeComBotBinding> => {
  validateBindingInput(input);

  const now = nowIso();
  const allowedTools = sanitizeAllowedWeComTools(input.allowed_tools);
  const result = await env.DB.prepare(
    `INSERT INTO project_wecom_bot_binding
      (project_id, binding_name, group_chat_id, bot_id, allowed_tools_json, data_scope,
       push_webhook_secret_ref, push_enabled, qa_enabled, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  )
    .bind(
      input.project_id,
      cleanText(input.binding_name),
      cleanText(input.group_chat_id),
      cleanText(input.bot_id),
      JSON.stringify(allowedTools),
      cleanText(input.data_scope) ?? "project",
      cleanText(input.push_webhook_secret_ref),
      input.push_enabled === false ? 0 : 1,
      input.qa_enabled === false ? 0 : 1,
      cleanText(actorUserid),
      now,
      now
    )
    .run();

  const binding = await env.DB.prepare("SELECT * FROM project_wecom_bot_binding WHERE id = ?")
    .bind(Number(result.meta.last_row_id))
    .first<ProjectWeComBotBinding>();

  if (!binding) {
    throw new Error("Failed to create WeCom binding");
  }
  return binding;
};

export const listProjectWeComBindings = async (
  env: Env,
  projectId: number
): Promise<ProjectWeComBotBinding[]> => {
  try {
    const rows = await env.DB.prepare(
      "SELECT * FROM project_wecom_bot_binding WHERE project_id = ? AND status != 'deleted' ORDER BY id DESC"
    )
      .bind(projectId)
      .all<ProjectWeComBotBinding>();
    return rows.results ?? [];
  } catch (error) {
    if (isMissingWeComMigrationError(error)) return [];
    throw error;
  }
};

export const disableProjectWeComBinding = async (env: Env, bindingId: number): Promise<void> => {
  const result = await env.DB.prepare(
    "UPDATE project_wecom_bot_binding SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), bindingId)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    throw new Error("WeCom binding not found");
  }
};

export const updateProjectWeComBinding = async (
  env: Env,
  bindingId: number,
  input: ProjectWeComBindingInput
): Promise<ProjectWeComBotBinding> => {
  validateBindingInput(input);

  const now = nowIso();
  const allowedTools = sanitizeAllowedWeComTools(input.allowed_tools);
  const result = await env.DB.prepare(
    `UPDATE project_wecom_bot_binding SET
       binding_name = ?,
       group_chat_id = ?,
       bot_id = ?,
       allowed_tools_json = ?,
       data_scope = ?,
       push_webhook_secret_ref = ?,
       push_enabled = ?,
       qa_enabled = ?,
       updated_at = ?
     WHERE id = ? AND project_id = ?`
  )
    .bind(
      cleanText(input.binding_name),
      cleanText(input.group_chat_id),
      cleanText(input.bot_id),
      JSON.stringify(allowedTools),
      cleanText(input.data_scope) ?? "project",
      cleanText(input.push_webhook_secret_ref),
      input.push_enabled === false ? 0 : 1,
      input.qa_enabled === false ? 0 : 1,
      now,
      bindingId,
      input.project_id
    )
    .run();

  if (!result.meta.changes || result.meta.changes === 0) {
    throw new Error("WeCom binding not found");
  }

  const binding = await env.DB.prepare("SELECT * FROM project_wecom_bot_binding WHERE id = ?")
    .bind(bindingId)
    .first<ProjectWeComBotBinding>();
  if (!binding) {
    throw new Error("WeCom binding not found");
  }
  return binding;
};

export const listWeComToolCallAudits = async (
  env: Env,
  projectId: number,
  limit = 20
): Promise<WeComToolCallAudit[]> => {
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM wecom_tool_call_audit
        WHERE project_id = ?
        ORDER BY id DESC
        LIMIT ?`
    )
      .bind(projectId, Math.min(Math.max(limit, 1), 100))
      .all<WeComToolCallAudit>();
    return rows.results ?? [];
  } catch (error) {
    if (isMissingWeComMigrationError(error)) return [];
    throw error;
  }
};

export const listProjectWeComPushEvents = async (
  env: Env,
  projectId: number,
  limit = 20
): Promise<ProjectWeComPushEvent[]> => {
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM project_wecom_push_event
        WHERE project_id = ?
        ORDER BY id DESC
        LIMIT ?`
    )
      .bind(projectId, Math.min(Math.max(limit, 1), 100))
      .all<ProjectWeComPushEvent>();
    return rows.results ?? [];
  } catch (error) {
    if (isMissingWeComMigrationError(error)) return [];
    throw error;
  }
};

export const resolveBindingForToolCall = async (
  env: Env,
  input: ResolveWeComToolBindingInput
): Promise<ProjectWeComBotBinding> => {
  const groupChatId = cleanText(input.context?.group_chat_id);
  const botId = cleanText(input.context?.bot_id);

  let binding: ProjectWeComBotBinding | null = null;
  if (groupChatId) {
    binding = await env.DB.prepare(
      `SELECT * FROM project_wecom_bot_binding
       WHERE group_chat_id = ? AND status = 'active' AND qa_enabled = 1
       ORDER BY id DESC LIMIT 1`
    )
      .bind(groupChatId)
      .first<ProjectWeComBotBinding>();
  }

  if (!binding && botId) {
    binding = await env.DB.prepare(
      `SELECT * FROM project_wecom_bot_binding
       WHERE bot_id = ? AND status = 'active' AND qa_enabled = 1
       ORDER BY id DESC LIMIT 1`
    )
      .bind(botId)
      .first<ProjectWeComBotBinding>();
  }

  if (!binding) {
    throw new Error("Active WeCom binding not found");
  }

  if (!parseAllowedTools(binding).includes(input.tool)) {
    throw new Error("Tool is not allowed for this WeCom binding");
  }

  return binding;
};
