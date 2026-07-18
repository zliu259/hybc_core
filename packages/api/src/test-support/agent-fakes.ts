import type { AgentGrantRow } from "../types/agent";

export interface FakeD1 {
  db: D1Database;
  grants: Map<string, AgentGrantRow>;
  pendings: Map<string, Record<string, unknown>>;
}

/**
 * 面向 agent_grant / agent_pending_action 的最小 D1 假实现：按 SQL 子串分派，
 * 与仓库现有测试（idempotency.test.ts）的风格一致。
 *
 * run() 返回 meta.changes（受影响行数），使乐观锁（条件 UPDATE + 行数判定）可测：
 * 守卫不满足时必须返回 0，只有真正写入的一方返回 1。
 */
export const createFakeD1 = (): FakeD1 => {
  const grants = new Map<string, AgentGrantRow>();
  const pendings = new Map<string, Record<string, unknown>>();

  const runInsert = (args: unknown[]) => {
    const [
      id,
      wecom_userid,
      device_name,
      client_info,
      agent_type,
      token_hash,
      token_prefix,
      role_snapshot,
      created_at,
      expires_at
    ] = args as (string | null)[];
    if ([...grants.values()].some((g) => g.token_hash === token_hash)) {
      throw new Error("D1_ERROR: UNIQUE constraint failed: agent_grant.token_hash");
    }
    grants.set(id as string, {
      id: id as string,
      wecom_userid: wecom_userid as string,
      device_name: device_name ?? null,
      client_info: client_info ?? null,
      agent_type: agent_type ?? null,
      token_hash: token_hash as string,
      token_prefix: token_prefix ?? null,
      role_snapshot: role_snapshot as AgentGrantRow["role_snapshot"],
      status: "active",
      created_at: created_at as string,
      expires_at: expires_at as string,
      last_used_at: null,
      revoked_at: null,
      revoked_by: null
    });
  };

  const insertPending = (args: unknown[]) => {
    const [
      id,
      grant_id,
      wecom_userid,
      action_kind,
      request_snapshot,
      risk_reason,
      summary,
      status,
      confirm_token_hash,
      created_at,
      expires_at
    ] = args as (string | null)[];
    if (pendings.has(id as string)) {
      throw new Error("D1_ERROR: UNIQUE constraint failed: agent_pending_action.id");
    }
    pendings.set(id as string, {
      id,
      grant_id,
      wecom_userid,
      action_kind,
      request_snapshot,
      risk_reason: risk_reason ?? null,
      summary,
      status: status ?? "pending",
      result_snapshot: null,
      confirm_token_hash,
      created_at,
      expires_at,
      confirmed_at: null,
      executed_at: null
    });
  };

  /**
   * 逐条应用 SELECT 里主键/哈希之外的 WHERE 合取项（`status = '<字面量>'`、`expires_at > ?`）。
   * 真实 D1 会因这些条件返回空行，假实现若忽略它们就会把已拒绝/已执行的行读成"仍然有效"。
   * 约定：`expires_at > ?` 的绑定值排在第一个（id / confirm_token_hash / wecom_userid）之后。
   */
  const pendingMatchesConjuncts = (
    p: Record<string, unknown>,
    sql: string,
    args: unknown[]
  ): boolean => {
    const statusLiteral = /status = '([a-z_]+)'/.exec(sql);
    if (statusLiteral && p.status !== statusLiteral[1]) return false;
    if (sql.includes("expires_at > ?") && !((p.expires_at as string) > (args[1] as string))) {
      return false;
    }
    return true;
  };

  /** 手工模拟各条件 UPDATE 的 WHERE 语义，返回受影响行数（0 或 1）。 */
  const updatePending = (sql: string, args: unknown[]): number => {
    if (sql.includes("SET status = 'confirmed'")) {
      const [confirmedAt, id, now] = args as string[];
      const p = pendings.get(id);
      if (p && p.status === "pending" && (p.expires_at as string) > now) {
        pendings.set(id, { ...p, status: "confirmed", confirmed_at: confirmedAt });
        return 1;
      }
      return 0;
    }
    if (sql.includes("SET status = 'rejected'")) {
      const [id] = args as string[];
      const p = pendings.get(id);
      if (p && p.status === "pending") {
        pendings.set(id, { ...p, status: "rejected", request_snapshot: "" });
        return 1;
      }
      return 0;
    }
    if (sql.includes("SET status = 'executing'")) {
      const [id] = args as string[];
      const p = pendings.get(id);
      if (p && p.status === "confirmed") {
        pendings.set(id, { ...p, status: "executing" });
        return 1;
      }
      return 0;
    }
    if (sql.includes("SET status = ?")) {
      const [status, resultSnapshot, executedAt, id] = args as string[];
      const p = pendings.get(id);
      if (p && p.status === "executing") {
        pendings.set(id, {
          ...p,
          status,
          result_snapshot: resultSnapshot,
          request_snapshot: "",
          executed_at: executedAt
        });
        return 1;
      }
      return 0;
    }
    // 分派是逐字匹配的：写法漂移（如 `SET status='confirmed'`）或新增的状态流转
    // 若静默返回 0，会与"乐观锁竞争失败"完全无法区分。宁可炸在这里。
    throw new Error(`fake D1: unhandled agent_pending_action UPDATE: ${sql}`);
  };

  const db = {
    prepare(sql: string) {
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound.push(...args);
          return api;
        },
        async run() {
          let changes = 0;
          if (sql.includes("INSERT INTO agent_pending_action")) {
            insertPending(bound);
            changes = 1;
          } else if (sql.includes("UPDATE agent_pending_action")) {
            changes = updatePending(sql, bound);
          } else if (sql.includes("INSERT INTO agent_grant")) {
            runInsert(bound);
            changes = 1;
          } else if (sql.includes("SET status = 'expired'")) {
            const [id] = bound as string[];
            const g = grants.get(id);
            if (g && g.status === "active") {
              grants.set(id, { ...g, status: "expired" });
              changes = 1;
            }
          } else if (sql.includes("SET last_used_at")) {
            const [ts, id, threshold] = bound as string[];
            const g = grants.get(id);
            if (g && (!g.last_used_at || g.last_used_at < threshold)) {
              grants.set(id, { ...g, last_used_at: ts });
              changes = 1;
            }
          } else if (sql.includes("SET status = 'revoked'")) {
            const [revokedAt, revokedBy, id] = bound as string[];
            const g = grants.get(id);
            if (g && g.status === "active") {
              grants.set(id, {
                ...g,
                status: "revoked",
                revoked_at: revokedAt,
                revoked_by: revokedBy
              });
              changes = 1;
            }
          }
          return { success: true, meta: { changes } };
        },
        async first<T>() {
          if (sql.includes("FROM agent_pending_action")) {
            let row: Record<string, unknown> | undefined;
            if (sql.includes("WHERE confirm_token_hash = ?")) {
              const [hash] = bound as string[];
              row = [...pendings.values()].find((p) => p.confirm_token_hash === hash);
            } else if (sql.includes("WHERE id = ?")) {
              const [id] = bound as string[];
              row = pendings.get(id);
            }
            if (!row || !pendingMatchesConjuncts(row, sql, bound)) return null;
            return row as T;
          }
          if (sql.includes("WHERE token_hash = ?")) {
            const [hash] = bound as string[];
            return ([...grants.values()].find((g) => g.token_hash === hash) ?? null) as T | null;
          }
          if (sql.includes("WHERE id = ?")) {
            const [id] = bound as string[];
            return (grants.get(id) ?? null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes("FROM agent_pending_action")) {
            const rows = [...pendings.values()]
              .filter((p) => !sql.includes("wecom_userid = ?") || p.wecom_userid === bound[0])
              .filter((p) => pendingMatchesConjuncts(p, sql, bound))
              .sort((a, b) => ((a.created_at as string) < (b.created_at as string) ? 1 : -1));
            return { results: rows as T[], success: true, meta: {} };
          }
          if (sql.includes("WHERE wecom_userid = ?")) {
            const [userid] = bound as string[];
            const rows = [...grants.values()]
              .filter((g) => g.wecom_userid === userid)
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            return { results: rows as T[], success: true, meta: {} };
          }
          const rows = [...grants.values()].sort((a, b) =>
            a.created_at < b.created_at ? 1 : -1
          );
          return { results: rows as T[], success: true, meta: {} };
        }
      };
      return api;
    }
  } as unknown as D1Database;

  return { db, grants, pendings };
};

export interface FakeKV {
  kv: KVNamespace;
  store: Map<string, { value: string; expiresAt: number | null }>;
}

export const createFakeKV = (): FakeKV => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const kv = {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, {
        value,
        expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null
      });
    },
    async delete(key: string) {
      store.delete(key);
    }
  } as unknown as KVNamespace;
  return { kv, store };
};
