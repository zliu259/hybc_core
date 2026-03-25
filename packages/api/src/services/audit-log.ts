const nowIso = () => new Date().toISOString();

export type AuditLogInput = {
  actorUserId?: string | null;
  actorRoles?: string[];
  action: string;
  targetType: string;
  targetId: string | number;
  status?: "success" | "blocked" | "error";
  detail?: Record<string, unknown> | null;
};

export const writeAuditLog = async (db: D1Database, input: AuditLogInput) => {
  await db.prepare(
    `INSERT INTO api_audit_log
      (actor_userid, actor_roles_json, action, target_type, target_id, status, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.actorUserId ?? null,
      input.actorRoles?.length ? JSON.stringify(input.actorRoles) : null,
      input.action,
      input.targetType,
      String(input.targetId),
      input.status ?? "success",
      input.detail ? JSON.stringify(input.detail) : null,
      nowIso()
    )
    .run();
};
