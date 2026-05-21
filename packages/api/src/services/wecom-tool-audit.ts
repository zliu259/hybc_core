import type { Env } from "../types/env";
import type { ProjectWeComBotBinding, WeComToolCallContext } from "../types/wecom-tools";
import { summarizeWeComToolResponse } from "./wecom-project-tools";

const nowIso = () => new Date().toISOString();

export interface WriteWeComToolAuditInput {
  binding?: ProjectWeComBotBinding | null;
  project_id?: number | null;
  tool_name: string;
  context?: WeComToolCallContext;
  request: unknown;
  response?: unknown;
  status: "success" | "failed" | "forbidden";
  error_message?: string | null;
  latency_ms: number;
}

export const writeWeComToolAudit = async (
  env: Env,
  input: WriteWeComToolAuditInput
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO wecom_tool_call_audit
      (binding_id, project_id, tool_name, caller_userid, group_chat_id, request_json,
       response_summary, status, error_message, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.binding?.id ?? null,
      input.binding?.project_id ?? input.project_id ?? null,
      input.tool_name,
      input.context?.caller_userid ?? null,
      input.context?.group_chat_id ?? input.binding?.group_chat_id ?? null,
      JSON.stringify(input.request),
      input.response === undefined ? null : summarizeWeComToolResponse(input.response),
      input.status,
      input.error_message ?? null,
      input.latency_ms,
      nowIso()
    )
    .run();
};
