import type { Env } from "../types/env";

export type ProjectPublicLogLink = {
  id: number | null;
  project_id: number;
  token: string;
  allowed_log_types_json: string;
  expires_at: string | null;
  status: string;
};

const nowIso = () => new Date().toISOString();

const hashToken = async (token: string): Promise<string> => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const createPublicToken = (): string => {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replace(/-/g, "");
};

const isMissingPublicLogLinkMigrationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("project_public_log_link");
};

export const ensureActiveProjectPublicLogLink = async (
  env: Env,
  projectId: number,
  createdByUserid = "system"
): Promise<ProjectPublicLogLink | null> => {
  try {
    const existing = await env.DB.prepare(
      `SELECT id, project_id, token, allowed_log_types_json, expires_at, status
         FROM project_public_log_link
        WHERE project_id = ?
          AND status = 'active'
          AND token IS NOT NULL
        ORDER BY id DESC
        LIMIT 1`
    )
      .bind(projectId)
      .first<ProjectPublicLogLink>();
    if (existing?.token) return existing;

    const project = await env.DB.prepare("SELECT id, status FROM project WHERE id = ?")
      .bind(projectId)
      .first<{ id: number; status: string }>();
    if (!project || project.status === "archived") return null;

    const token = createPublicToken();
    const tokenHash = await hashToken(token);
    const now = nowIso();
    const allowedLogTypesJson = JSON.stringify(["operator_log", "project_log"]);

    await env.DB.prepare(
      "UPDATE project_public_log_link SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE project_id = ? AND status = 'active'"
    )
      .bind(now, now, projectId)
      .run();

    const result = await env.DB.prepare(
      `INSERT INTO project_public_log_link
        (project_id, token, token_hash, allowed_log_types_json, expires_at, status, created_by_userid, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'active', ?, ?, ?)`
    )
      .bind(projectId, token, tokenHash, allowedLogTypesJson, createdByUserid, now, now)
      .run();

    return {
      id: Number(result.meta.last_row_id ?? 0) || null,
      project_id: projectId,
      token,
      allowed_log_types_json: allowedLogTypesJson,
      expires_at: null,
      status: "active"
    };
  } catch (error) {
    if (isMissingPublicLogLinkMigrationError(error)) return null;
    throw error;
  }
};
