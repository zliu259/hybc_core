import { defaultPermissionsByRole } from "./auth";
import { generateAgentToken, hashAgentToken, tokenPrefixForDisplay } from "./agent-token";
import type { UserRole } from "../types/auth";
import type {
  AgentGrantRow,
  AgentIdentity,
  PublicGrantView,
  AdminGrantView
} from "../types/agent";

export const GRANT_TTL_DAYS = 180;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface CreateGrantInput {
  wecomUserid: string;
  role: UserRole;
  deviceName?: string;
  clientInfo?: string;
  agentType?: string;
}

export interface CreatedGrant {
  grant: AgentGrantRow;
  token: string;
}

export const createAgentGrant = async (
  db: D1Database,
  input: CreateGrantInput
): Promise<CreatedGrant> => {
  const id = crypto.randomUUID();
  const token = generateAgentToken();
  const tokenHash = await hashAgentToken(token);
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const prefix = tokenPrefixForDisplay(token);

  await db
    .prepare(
      `INSERT INTO agent_grant
        (id, wecom_userid, device_name, client_info, agent_type, token_hash, token_prefix, role_snapshot, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(
      id,
      input.wecomUserid,
      input.deviceName ?? null,
      input.clientInfo ?? null,
      input.agentType ?? null,
      tokenHash,
      prefix,
      input.role,
      createdAt,
      expiresAt
    )
    .run();

  return {
    token,
    grant: {
      id,
      wecom_userid: input.wecomUserid,
      device_name: input.deviceName ?? null,
      client_info: input.clientInfo ?? null,
      agent_type: input.agentType ?? null,
      token_hash: tokenHash,
      token_prefix: prefix,
      role_snapshot: input.role,
      status: "active",
      created_at: createdAt,
      expires_at: expiresAt,
      last_used_at: null,
      revoked_at: null,
      revoked_by: null
    }
  };
};

export const resolveAgentByToken = async (
  db: D1Database,
  token: string
): Promise<AgentIdentity | null> => {
  const tokenHash = await hashAgentToken(token);
  const row = await db
    .prepare(`SELECT * FROM agent_grant WHERE token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first<AgentGrantRow>();
  if (!row || row.status !== "active") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db
      .prepare(`UPDATE agent_grant SET status = 'expired' WHERE id = ? AND status = 'active'`)
      .bind(row.id)
      .run();
    return null;
  }
  const role = row.role_snapshot;
  return {
    wecomUserid: row.wecom_userid,
    grantId: row.id,
    roles: [role],
    permissions: defaultPermissionsByRole[role] ?? []
  };
};

export const touchGrantLastUsed = async (db: D1Database, grantId: string): Promise<void> => {
  const now = Date.now();
  const threshold = new Date(now - LAST_USED_THROTTLE_MS).toISOString();
  await db
    .prepare(
      `UPDATE agent_grant SET last_used_at = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`
    )
    .bind(new Date(now).toISOString(), grantId, threshold)
    .run();
};

const toPublicView = (row: AgentGrantRow): PublicGrantView => ({
  id: row.id,
  device_name: row.device_name,
  agent_type: row.agent_type,
  token_prefix: row.token_prefix,
  status: row.status,
  created_at: row.created_at,
  expires_at: row.expires_at,
  last_used_at: row.last_used_at
});

const toAdminView = (row: AgentGrantRow): AdminGrantView => ({
  ...toPublicView(row),
  wecom_userid: row.wecom_userid,
  role_snapshot: row.role_snapshot
});

export const listGrantsForUser = async (
  db: D1Database,
  wecomUserid: string
): Promise<PublicGrantView[]> => {
  const res = await db
    .prepare(
      `SELECT * FROM agent_grant WHERE wecom_userid = ? ORDER BY created_at DESC`
    )
    .bind(wecomUserid)
    .all<AgentGrantRow>();
  return (res.results ?? []).map(toPublicView);
};

export const listAllGrants = async (db: D1Database): Promise<AdminGrantView[]> => {
  const res = await db
    .prepare(`SELECT * FROM agent_grant ORDER BY created_at DESC`)
    .all<AgentGrantRow>();
  return (res.results ?? []).map(toAdminView);
};

export const getGrantById = async (
  db: D1Database,
  id: string
): Promise<AgentGrantRow | null> =>
  db.prepare(`SELECT * FROM agent_grant WHERE id = ? LIMIT 1`).bind(id).first<AgentGrantRow>();

export const revokeGrant = async (
  db: D1Database,
  grantId: string,
  revokedBy: string
): Promise<void> => {
  await db
    .prepare(
      `UPDATE agent_grant SET status = 'revoked', revoked_at = ?, revoked_by = ?
        WHERE id = ? AND status = 'active'`
    )
    .bind(new Date().toISOString(), revokedBy, grantId)
    .run();
};
