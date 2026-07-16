# MCP 智能体接入 — P1a：API 后端 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/api` 建立"以员工身份运行的 AI 智能体"这一鉴权主体：设备授权码流程签发 6 个月长期令牌、agent-token 运行时鉴权（复用现有 RBAC 与全部 `/api/v1` 路由）、授权列表/吊销、全量审计。

**Architecture:** 新增不透明长期令牌 `hybc_agent_*`（仅存 SHA-256）。现有 `authMiddleware` 增加"agent-token 分支"：命中 `hybc_agent_` 前缀 → 查 `agent_grant`（每请求一行索引查询，保证秒级吊销）→ 用授权时快照的角色构造与现有一致的 `auth` 上下文（`auth_method:"mcp_agent"`）→ 下游 `rbac` 与所有路由零改动生效。设备流状态存 KV；授权与 bootstrap 端点用现有 JWT 会话作为身份来源。

**Tech Stack:** Hono 4 + Cloudflare Workers、D1、KV、vitest 3、TypeScript 5。Web/一致的响应信封 `{ success, data|error }`。

> **本计划范围**：仅 API 后端。MCP 包与分发脚本见 P1b、Web 页面见 P1c。
> **P1 简化（与 spec §7 的偏差，已知并接受）**：运行时身份用**授权时快照的角色**（`role_snapshot`）+ 当前 `defaultPermissionsByRole` 映射；角色降级通过**吊销**处理。活体 WeCom 标签重解析放到 P2。

---

## 文件结构

**新建**
- `packages/api/migrations/0058_mcp_agent_grant.sql` — `agent_grant` 表 + 索引
- `packages/api/src/types/agent.ts` — agent 相关类型
- `packages/api/src/services/agent-token.ts` — 令牌生成/哈希/前缀（纯函数）
- `packages/api/src/services/agent-token.test.ts`
- `packages/api/src/services/agent-grant.ts` — 授权 CRUD + 令牌解析
- `packages/api/src/services/agent-grant.test.ts`
- `packages/api/src/services/agent-device.ts` — 设备流 + bootstrap 的 KV 状态机
- `packages/api/src/services/agent-device.test.ts`
- `packages/api/src/test-support/agent-fakes.ts` — 测试用 D1/KV 内存假实现
- `packages/api/src/routes/agent.ts` — `/api/v1/agent/*` 端点
- `packages/api/src/routes/agent.test.ts`

**修改**
- `packages/api/src/types/auth.ts` — `AuthTokenPayload.auth_method` 增加 `"mcp_agent"`；增加可选 `via`、`grant_id`
- `packages/api/src/types/env.ts` — 增加 `AGENT_WEB_BASE_URL`、`AGENT_API_BASE_URL`
- `packages/api/src/middleware/auth.ts` — agent-token 分支 + 审计
- `packages/api/src/index.ts` — 挂载 `agentRoutes`
- `packages/api/src/routes/admin.ts` — super_admin 吊销任意授权
- `packages/api/wrangler.toml` — 新增两个 `[vars]`

---

## Task 1: 数据库迁移 `agent_grant`

**Files:**
- Create: `packages/api/migrations/0058_mcp_agent_grant.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- 0058_mcp_agent_grant.sql
-- MCP 智能体长期授权（6 个月），令牌仅存 SHA-256。
CREATE TABLE IF NOT EXISTS agent_grant (
  id TEXT PRIMARY KEY,
  wecom_userid TEXT NOT NULL,
  device_name TEXT,
  client_info TEXT,
  agent_type TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT,
  role_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_grant_wecom_userid ON agent_grant(wecom_userid);
CREATE INDEX IF NOT EXISTS idx_agent_grant_token_hash ON agent_grant(token_hash);
CREATE INDEX IF NOT EXISTS idx_agent_grant_status ON agent_grant(status);
```

- [ ] **Step 2: 本地应用迁移**

Run: `cd packages/api && npm run db:migrate:local`
Expected: 输出包含 `0058_mcp_agent_grant.sql` 应用成功，无报错。

- [ ] **Step 3: Commit**

```bash
git add packages/api/migrations/0058_mcp_agent_grant.sql
git commit -m "feat(api): add agent_grant table for MCP agent access"
```

---

## Task 2: 类型扩展（auth + env + agent）

**Files:**
- Modify: `packages/api/src/types/auth.ts`
- Modify: `packages/api/src/types/env.ts`
- Create: `packages/api/src/types/agent.ts`

- [ ] **Step 1: 扩展 `AuthTokenPayload`（`types/auth.ts`）**

把 `auth_method` 联合类型增加 `"mcp_agent"`，并加两个可选字段。将现有接口中这两处替换：

```typescript
export interface AuthTokenPayload {
  [key: string]: unknown;
  sub: string;
  username: string;
  nickname: string;
  avatar: string;
  roles: UserRole[];
  permissions: string[];
  tokenId: string;
  type: "access" | "refresh";
  auth_method: "wecom_oauth" | "passkey" | "mcp_agent";
  wecom_verified_at: string;
  via?: "mcp";
  grant_id?: string;
  exp: number;
  iat: number;
}
```

- [ ] **Step 2: 扩展 `Env`（`types/env.ts`）**

在 `Env` 接口末尾（`REIMBURSEMENT_REQUIRE_PAYEE?` 之后）新增：

```typescript
  AGENT_WEB_BASE_URL?: string;
  AGENT_API_BASE_URL?: string;
```

- [ ] **Step 3: 新建 `types/agent.ts`**

```typescript
import type { UserRole } from "./auth";

export interface AgentGrantRow {
  id: string;
  wecom_userid: string;
  device_name: string | null;
  client_info: string | null;
  agent_type: string | null;
  token_hash: string;
  token_prefix: string | null;
  role_snapshot: UserRole;
  status: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface AgentIdentity {
  wecomUserid: string;
  grantId: string;
  roles: UserRole[];
  permissions: string[];
}

export type DeviceStatus = "pending" | "approved" | "denied";

export interface DeviceCodeRecord {
  userCode: string;
  status: DeviceStatus;
  agentType?: string;
  deviceName?: string;
  clientInfo?: string;
  wecomUserid?: string;
  role?: UserRole;
  agentToken?: string;
  expiresAt: string;
  createdAt: string;
}

export interface PublicGrantView {
  id: string;
  device_name: string | null;
  agent_type: string | null;
  token_prefix: string | null;
  status: AgentGrantRow["status"];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}
```

- [ ] **Step 4: 校验类型**

Run: `cd packages/api && npm run typecheck`
Expected: PASS（无类型错误）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/types/auth.ts packages/api/src/types/env.ts packages/api/src/types/agent.ts
git commit -m "feat(api): extend auth/env types for MCP agent tokens"
```

---

## Task 3: 令牌工具（纯函数，TDD）

**Files:**
- Create: `packages/api/src/services/agent-token.ts`
- Test: `packages/api/src/services/agent-token.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// agent-token.test.ts
import { describe, expect, it } from "vitest";

import {
  AGENT_TOKEN_PREFIX,
  generateAgentToken,
  hashAgentToken,
  isAgentToken,
  tokenPrefixForDisplay
} from "./agent-token";

describe("agent-token", () => {
  it("generates opaque tokens with the agent prefix", () => {
    const token = generateAgentToken();
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(AGENT_TOKEN_PREFIX.length + 20);
    expect(generateAgentToken()).not.toBe(token);
  });

  it("recognizes agent tokens by prefix", () => {
    expect(isAgentToken(generateAgentToken())).toBe(true);
    expect(isAgentToken("eyJhbGciOi.jwt.token")).toBe(false);
  });

  it("hashes deterministically to 64-char hex", async () => {
    const token = generateAgentToken();
    const h1 = await hashAgentToken(token);
    const h2 = await hashAgentToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAgentToken(generateAgentToken())).not.toBe(h1);
  });

  it("exposes only a short display prefix", () => {
    const token = generateAgentToken();
    const prefix = tokenPrefixForDisplay(token);
    expect(token.startsWith(prefix.replace(/…$/, ""))).toBe(true);
    expect(prefix.length).toBeLessThan(token.length);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-token.test.ts`
Expected: FAIL（`Cannot find module './agent-token'`）。

- [ ] **Step 3: 实现**

```typescript
// agent-token.ts
export const AGENT_TOKEN_PREFIX = "hybc_agent_";

export const isAgentToken = (token: string): boolean =>
  token.startsWith(AGENT_TOKEN_PREFIX);

export const generateAgentToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const body = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${AGENT_TOKEN_PREFIX}${body}`;
};

export const hashAgentToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const tokenPrefixForDisplay = (token: string): string =>
  `${token.slice(0, AGENT_TOKEN_PREFIX.length + 6)}…`;
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-token.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-token.ts packages/api/src/services/agent-token.test.ts
git commit -m "feat(api): add agent token generation and hashing utils"
```

---

## Task 4: 测试用内存假实现（D1 + KV）

**Files:**
- Create: `packages/api/src/test-support/agent-fakes.ts`

> 纯测试脚手架，无需 TDD。后续 Task 5/6/7 复用。

- [ ] **Step 1: 实现假 D1（针对 `agent_grant` 语句）与假 KV**

```typescript
// agent-fakes.ts
import type { AgentGrantRow } from "../types/agent";

export interface FakeD1 {
  db: D1Database;
  grants: Map<string, AgentGrantRow>;
}

/**
 * 面向 agent_grant 的最小 D1 假实现：按 SQL 子串分派，
 * 与仓库现有测试（idempotency.test.ts）的风格一致。
 */
export const createFakeD1 = (): FakeD1 => {
  const grants = new Map<string, AgentGrantRow>();

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

  const db = {
    prepare(sql: string) {
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound.push(...args);
          return api;
        },
        async run() {
          if (sql.includes("INSERT INTO agent_grant")) {
            runInsert(bound);
          } else if (sql.includes("SET status = 'expired'")) {
            const [id] = bound as string[];
            const g = grants.get(id);
            if (g && g.status === "active") grants.set(id, { ...g, status: "expired" });
          } else if (sql.includes("SET last_used_at")) {
            const [ts, id, threshold] = bound as string[];
            const g = grants.get(id);
            if (g && (!g.last_used_at || g.last_used_at < threshold)) {
              grants.set(id, { ...g, last_used_at: ts });
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
            }
          }
          return { success: true, meta: {} };
        },
        async first<T>() {
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

  return { db, grants };
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
```

- [ ] **Step 2: 校验类型**

Run: `cd packages/api && npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/test-support/agent-fakes.ts
git commit -m "test(api): add in-memory D1/KV fakes for agent grant tests"
```

---

## Task 5: 授权服务 `agent-grant`（TDD）

**Files:**
- Create: `packages/api/src/services/agent-grant.ts`
- Test: `packages/api/src/services/agent-grant.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// agent-grant.test.ts
import { describe, expect, it } from "vitest";

import { createFakeD1 } from "../test-support/agent-fakes";
import {
  createAgentGrant,
  listGrantsForUser,
  resolveAgentByToken,
  revokeGrant,
  touchGrantLastUsed
} from "./agent-grant";

describe("agent-grant", () => {
  it("creates a grant and resolves it by the plaintext token", async () => {
    const { db } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(grant.status).toBe("active");
    expect(new Date(grant.expires_at).getTime()).toBeGreaterThan(Date.now());

    const identity = await resolveAgentByToken(db, token);
    expect(identity).not.toBeNull();
    expect(identity?.wecomUserid).toBe("MaxLiu");
    expect(identity?.roles).toEqual(["finance"]);
    expect(identity?.permissions).toContain("payment:write");
    expect(identity?.grantId).toBe(grant.id);
  });

  it("returns null for unknown or revoked tokens", async () => {
    const { db } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    expect(await resolveAgentByToken(db, "hybc_agent_nope")).toBeNull();

    await revokeGrant(db, grant.id, "super_admin");
    expect(await resolveAgentByToken(db, token)).toBeNull();
  });

  it("expires grants past expires_at", async () => {
    const { db, grants } = createFakeD1();
    const { grant, token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    grants.set(grant.id, {
      ...grants.get(grant.id)!,
      expires_at: new Date(Date.now() - 1000).toISOString()
    });
    expect(await resolveAgentByToken(db, token)).toBeNull();
    expect(grants.get(grant.id)?.status).toBe("expired");
  });

  it("lists a user's grants without leaking token_hash", async () => {
    const { db } = createFakeD1();
    await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const views = await listGrantsForUser(db, "MaxLiu");
    expect(views).toHaveLength(1);
    expect(views[0]).not.toHaveProperty("token_hash");
    expect(views[0]).toHaveProperty("token_prefix");
  });

  it("throttles last_used_at updates", async () => {
    const { db, grants } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    await touchGrantLastUsed(db, grant.id);
    const first = grants.get(grant.id)?.last_used_at;
    expect(first).toBeTruthy();
    await touchGrantLastUsed(db, grant.id); // within threshold -> no change
    expect(grants.get(grant.id)?.last_used_at).toBe(first);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-grant.test.ts`
Expected: FAIL（`Cannot find module './agent-grant'`）。

- [ ] **Step 3: 实现**

```typescript
// agent-grant.ts
import { defaultPermissionsByRole } from "./auth";
import { generateAgentToken, hashAgentToken, tokenPrefixForDisplay } from "./agent-token";
import type { UserRole } from "../types/auth";
import type { AgentGrantRow, AgentIdentity, PublicGrantView } from "../types/agent";

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

export const listAllGrants = async (db: D1Database): Promise<PublicGrantView[]> => {
  const res = await db
    .prepare(`SELECT * FROM agent_grant ORDER BY created_at DESC`)
    .all<AgentGrantRow>();
  return (res.results ?? []).map(toPublicView);
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-grant.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-grant.ts packages/api/src/services/agent-grant.test.ts
git commit -m "feat(api): add agent grant service (create/resolve/list/revoke)"
```

---

## Task 6: agent-token 鉴权分支 + 审计（TDD）

**Files:**
- Modify: `packages/api/src/middleware/auth.ts`
- Test: `packages/api/src/middleware/auth.agent.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// auth.agent.test.ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { authMiddleware, type AuthVariables } from "./auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import { createAgentGrant } from "../services/agent-grant";
import type { Env } from "../types/env";

const buildApp = (env: Env) => {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/protected", authMiddleware);
  app.get("/protected", (c) => {
    const auth = c.get("auth");
    return c.json({ sub: auth.sub, via: auth.via, roles: auth.roles });
  });
  return { app, env };
};

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({ DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env);

describe("authMiddleware agent-token branch", () => {
  it("authenticates a valid agent token and sets via=mcp", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { token } = await createAgentGrant(db, {
      wecomUserid: "MaxLiu",
      role: "finance"
    });
    const { app, env } = buildApp(fakeEnv(db, kv));

    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${token}` }
    }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sub: string; via: string; roles: string[] };
    expect(body.sub).toBe("MaxLiu");
    expect(body.via).toBe("mcp");
    expect(body.roles).toEqual(["finance"]);
  });

  it("rejects a revoked/unknown agent token with 401", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const { app, env } = buildApp(fakeEnv(db, kv));
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer hybc_agent_bogus" }
    }, env);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/middleware/auth.agent.test.ts`
Expected: FAIL（agent token 走 JWT 分支 → 401，`via` 未设置）。

- [ ] **Step 3: 修改 `middleware/auth.ts` 增加 agent 分支**

在文件顶部 imports 增加：

```typescript
import { isAgentToken } from "../services/agent-token";
import { resolveAgentByToken, touchGrantLastUsed } from "../services/agent-grant";
import { writeAuditLog } from "../services/audit-log";
```

在 `authMiddleware` 内，取出 `token` 之后、现有 `try { const payload = await verifyToken(...) }` 之前，插入 agent 分支：

```typescript
  if (isAgentToken(token)) {
    const identity = await resolveAgentByToken(c.env.DB, token);
    if (!identity) {
      return unauthorized("Invalid or expired agent token");
    }

    const now = Math.floor(Date.now() / 1000);
    c.set("auth", {
      sub: identity.wecomUserid,
      username: identity.wecomUserid,
      nickname: identity.wecomUserid,
      avatar: "",
      roles: identity.roles,
      permissions: identity.permissions,
      tokenId: identity.grantId,
      type: "access",
      auth_method: "mcp_agent",
      wecom_verified_at: new Date().toISOString(),
      via: "mcp",
      grant_id: identity.grantId,
      iat: now,
      exp: now
    });

    const auditPromise = Promise.all([
      touchGrantLastUsed(c.env.DB, identity.grantId),
      writeAuditLog(c.env.DB, {
        actorUserId: identity.wecomUserid,
        actorRoles: identity.roles,
        action: `agent:${c.req.method}`,
        targetType: "agent_request",
        targetId: new URL(c.req.url).pathname,
        detail: { via: "mcp", grant_id: identity.grantId }
      })
    ]).catch(() => undefined);
    // 生产 Workers 有 executionCtx；vitest 直接 app.request 时可能没有 —— 两种都容错。
    try {
      c.executionCtx.waitUntil(auditPromise);
    } catch {
      void auditPromise;
    }

    await next();
    return;
  }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/middleware/auth.agent.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 回归全部现有鉴权测试**

Run: `cd packages/api && npm test -- src/middleware src/routes/system-integrity-authz.test.ts`
Expected: PASS（现有 JWT 分支行为不变）。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/src/middleware/auth.agent.test.ts
git commit -m "feat(api): accept MCP agent tokens in authMiddleware with audit"
```

---

## Task 7: 设备流状态机 `agent-device`（TDD）

**Files:**
- Create: `packages/api/src/services/agent-device.ts`
- Test: `packages/api/src/services/agent-device.test.ts`

设计：KV 键 `agent:device:{deviceCode}`、`agent:usercode:{userCode}`、`agent:boot:{bootCode}`，TTL 600s。

- [ ] **Step 1: 写失败测试**

```typescript
// agent-device.test.ts
import { describe, expect, it } from "vitest";

import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import {
  approveDeviceByUserCode,
  pollDeviceToken,
  provisionBootstrapGrant,
  redeemBootstrap,
  startDeviceAuthorization
} from "./agent-device";

describe("agent-device", () => {
  it("runs the device flow: start -> approve -> poll returns token once", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();

    const start = await startDeviceAuthorization(kv, {
      webBaseUrl: "https://web.hybcdg.com",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(start.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start.verification_uri_complete).toContain(start.user_code);

    expect(await pollDeviceToken(kv, db, start.device_code)).toEqual({
      status: "authorization_pending"
    });

    await approveDeviceByUserCode(kv, db, start.user_code, {
      wecomUserid: "MaxLiu",
      role: "manager"
    });

    const granted = await pollDeviceToken(kv, db, start.device_code);
    expect(granted.status).toBe("granted");
    if (granted.status === "granted") {
      expect(granted.agent_token.startsWith("hybc_agent_")).toBe(true);
      expect(granted.wecom_userid).toBe("MaxLiu");
      expect(granted.role).toBe("manager");
    }

    // token issued only once
    expect(await pollDeviceToken(kv, db, start.device_code)).toEqual({
      status: "expired"
    });
  });

  it("rejects approving an unknown user_code", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    await expect(
      approveDeviceByUserCode(kv, db, "ZZZZ-ZZZZ", {
        wecomUserid: "MaxLiu",
        role: "operator"
      })
    ).rejects.toThrow(/user_code/i);
  });

  it("provisions via bootstrap and redeems once", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const prov = await provisionBootstrapGrant(kv, db, {
      wecomUserid: "MaxLiu",
      role: "finance",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(prov.boot_code).toBeTruthy();

    const redeemed = await redeemBootstrap(kv, prov.boot_code);
    expect(redeemed?.agent_token.startsWith("hybc_agent_")).toBe(true);
    expect(await redeemBootstrap(kv, prov.boot_code)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-device.test.ts`
Expected: FAIL（`Cannot find module './agent-device'`）。

- [ ] **Step 3: 实现**

```typescript
// agent-device.ts
import { createAgentGrant } from "./agent-grant";
import type { UserRole } from "../types/auth";
import type { DeviceCodeRecord } from "../types/agent";

const DEVICE_TTL_SECONDS = 600;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混字符

const deviceKey = (code: string) => `agent:device:${code}`;
const userCodeKey = (code: string) => `agent:usercode:${code}`;
const bootKey = (code: string) => `agent:boot:${code}`;

const randomFrom = (alphabet: string, length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const makeUserCode = (): string =>
  `${randomFrom(USER_CODE_ALPHABET, 4)}-${randomFrom(USER_CODE_ALPHABET, 4)}`;

export interface StartDeviceInput {
  webBaseUrl: string;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
}

export interface StartDeviceResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export const startDeviceAuthorization = async (
  kv: KVNamespace,
  input: StartDeviceInput
): Promise<StartDeviceResult> => {
  const deviceCode = crypto.randomUUID();
  const userCode = makeUserCode();
  const nowIso = new Date().toISOString();
  const record: DeviceCodeRecord = {
    userCode,
    status: "pending",
    agentType: input.agentType,
    deviceName: input.deviceName,
    clientInfo: input.clientInfo,
    expiresAt: new Date(Date.now() + DEVICE_TTL_SECONDS * 1000).toISOString(),
    createdAt: nowIso
  };
  await kv.put(deviceKey(deviceCode), JSON.stringify(record), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
  await kv.put(userCodeKey(userCode), deviceCode, {
    expirationTtl: DEVICE_TTL_SECONDS
  });

  const base = input.webBaseUrl.replace(/\/$/, "");
  const verificationUri = `${base}/agent/authorize`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_TTL_SECONDS,
    interval: 5
  };
};

export const approveDeviceByUserCode = async (
  kv: KVNamespace,
  db: D1Database,
  userCode: string,
  approver: { wecomUserid: string; role: UserRole }
): Promise<void> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) throw new Error("Unknown or expired user_code");
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) throw new Error("Unknown or expired user_code");
  const record = JSON.parse(raw) as DeviceCodeRecord;
  if (record.status !== "pending") throw new Error("Device request already resolved");

  const { token } = await createAgentGrant(db, {
    wecomUserid: approver.wecomUserid,
    role: approver.role,
    deviceName: record.deviceName,
    clientInfo: record.clientInfo,
    agentType: record.agentType
  });

  const updated: DeviceCodeRecord = {
    ...record,
    status: "approved",
    wecomUserid: approver.wecomUserid,
    role: approver.role,
    agentToken: token
  };
  await kv.put(deviceKey(deviceCode), JSON.stringify(updated), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
};

export type PollResult =
  | { status: "authorization_pending" }
  | { status: "expired" }
  | { status: "denied" }
  | {
      status: "granted";
      agent_token: string;
      wecom_userid: string;
      role: UserRole;
    };

export const pollDeviceToken = async (
  kv: KVNamespace,
  _db: D1Database,
  deviceCode: string
): Promise<PollResult> => {
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) return { status: "expired" };
  const record = JSON.parse(raw) as DeviceCodeRecord;
  if (record.status === "pending") return { status: "authorization_pending" };
  if (record.status === "denied") return { status: "denied" };
  if (record.status === "approved" && record.agentToken && record.wecomUserid) {
    // 一次性发放：领取后删除
    await kv.delete(deviceKey(deviceCode));
    await kv.delete(userCodeKey(record.userCode));
    return {
      status: "granted",
      agent_token: record.agentToken,
      wecom_userid: record.wecomUserid,
      role: record.role ?? ("operator" as UserRole)
    };
  }
  return { status: "expired" };
};

export interface ProvisionInput {
  wecomUserid: string;
  role: UserRole;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
}

export const provisionBootstrapGrant = async (
  kv: KVNamespace,
  db: D1Database,
  input: ProvisionInput
): Promise<{ boot_code: string; expires_in: number }> => {
  const { token } = await createAgentGrant(db, input);
  const bootCode = crypto.randomUUID();
  await kv.put(
    bootKey(bootCode),
    JSON.stringify({ agent_token: token, wecom_userid: input.wecomUserid, role: input.role }),
    { expirationTtl: DEVICE_TTL_SECONDS }
  );
  return { boot_code: bootCode, expires_in: DEVICE_TTL_SECONDS };
};

export const redeemBootstrap = async (
  kv: KVNamespace,
  bootCode: string
): Promise<{ agent_token: string; wecom_userid: string; role: UserRole } | null> => {
  const raw = await kv.get(bootKey(bootCode));
  if (!raw) return null;
  await kv.delete(bootKey(bootCode));
  return JSON.parse(raw) as { agent_token: string; wecom_userid: string; role: UserRole };
};
```

> 注：`DeviceCodeRecord.role?` 已在 Task 2 定义，`updated` 记录已写入 `role: approver.role`，故 `pollDeviceToken` 可直接读 `record.role`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-device.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-device.ts packages/api/src/services/agent-device.test.ts packages/api/src/types/agent.ts
git commit -m "feat(api): add device authorization + bootstrap state machine"
```

---

## Task 8: 路由 `/api/v1/agent`（设备流 + bootstrap + 授权管理）+ 挂载（TDD）

**Files:**
- Create: `packages/api/src/routes/agent.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/routes/agent.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// agent.test.ts
import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    AGENT_API_BASE_URL: "https://api.hybcdg.com"
  } as unknown as Env);

// 用一个假的已登录 JWT 上下文：直接在测试里通过 header 走 agent 端点的免鉴权部分，
// 对需要 JWT 的端点，注入一个绕过 authMiddleware 的测试专用中间件。
describe("agent routes device flow", () => {
  it("POST /device/code returns codes and verification uri", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const res = await agentRoutes.request(
      "/device/code",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_name: "Max MacBook", agent_type: "claude_code" })
      },
      fakeEnv(db, kv)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { user_code: string } };
    expect(body.success).toBe(true);
    expect(body.data.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("POST /device/token pending before approval", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const start = await agentRoutes.request(
      "/device/code",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      fakeEnv(db, kv)
    );
    const { data } = (await start.json()) as { data: { device_code: string } };
    const poll = await agentRoutes.request(
      "/device/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: data.device_code })
      },
      fakeEnv(db, kv)
    );
    const pollBody = (await poll.json()) as { data: { status: string } };
    expect(pollBody.data.status).toBe("authorization_pending");
  });
});
```

> JWT 端点（`/setup/provision`、`/device/approve`、`/grants`）的完整集成测试依赖真实 JWT 签发，放到 P1c 的 e2e，或在此用注入身份的方式补测；本任务先覆盖免鉴权设备端点。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/routes/agent.test.ts`
Expected: FAIL（`Cannot find module './agent'`）。

- [ ] **Step 3: 实现 `routes/agent.ts`**

```typescript
// agent.ts
import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import {
  approveDeviceByUserCode,
  pollDeviceToken,
  provisionBootstrapGrant,
  redeemBootstrap,
  startDeviceAuthorization
} from "../services/agent-device";
import { getGrantById, listGrantsForUser, revokeGrant } from "../services/agent-grant";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const ok = <T>(data: T) => ({ success: true as const, data });
const fail = (message: string) => ({ success: false as const, error: { message } });

export const agentRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const deviceRateLimit = createRateLimitMiddleware({
  scope: "agent-device",
  maxRequests: 30,
  windowSeconds: 60
});

// --- 设备流（免鉴权，CLI 发起）---
agentRoutes.post("/device/code", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const webBaseUrl = c.env.AGENT_WEB_BASE_URL;
  if (!webBaseUrl) return c.json(fail("AGENT_WEB_BASE_URL not configured"), 500);
  const result = await startDeviceAuthorization(c.env.KV, {
    webBaseUrl,
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  return c.json(ok(result));
});

agentRoutes.post("/device/token", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  if (!body.device_code) return c.json(fail("device_code required"), 400);
  const result = await pollDeviceToken(c.env.KV, c.env.DB, body.device_code);
  return c.json(ok(result));
});

agentRoutes.post("/setup/redeem", deviceRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { boot_code?: string };
  if (!body.boot_code) return c.json(fail("boot_code required"), 400);
  const redeemed = await redeemBootstrap(c.env.KV, body.boot_code);
  if (!redeemed) return c.json(fail("boot_code invalid or already used"), 410);
  return c.json(ok(redeemed));
});

// --- install.sh（免鉴权，数据类）---
agentRoutes.get("/install.sh", (c) => {
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const boot = c.req.query("boot") ?? "";
  const script = [
    "#!/bin/sh",
    "set -e",
    `HYBC_API="${apiBase}"`,
    `HYBC_BOOT="${boot}"`,
    'echo "恒越百川 MCP 安装器占位（P1b 完善）：将在此拉取 bundle、写配置、兑换令牌。"',
    'echo "API=$HYBC_API BOOT=$HYBC_BOOT"'
  ].join("\n");
  return c.text(`${script}\n`, 200, { "content-type": "text/x-shellscript; charset=utf-8" });
});

// --- 以下需 JWT（登录员工本人）---
agentRoutes.use("/setup/provision", authMiddleware);
agentRoutes.use("/device/approve", authMiddleware);
agentRoutes.use("/grants", authMiddleware);
agentRoutes.use("/grants/*", authMiddleware);

const primaryRole = (c: { get: (k: "auth") => AuthVariables["auth"] }): UserRole =>
  (c.get("auth").roles[0] ?? "operator") as UserRole;

agentRoutes.post("/setup/provision", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as {
    device_name?: string;
    agent_type?: string;
    client_info?: string;
  };
  const prov = await provisionBootstrapGrant(c.env.KV, c.env.DB, {
    wecomUserid: auth.sub,
    role: primaryRole(c),
    deviceName: body.device_name,
    agentType: body.agent_type,
    clientInfo: body.client_info
  });
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  return c.json(
    ok({
      ...prov,
      install_sh: `curl -fsSL "${apiBase}/api/v1/agent/install.sh?boot=${prov.boot_code}" | sh`,
      install_ps1: `irm "${apiBase}/api/v1/agent/install.ps1?boot=${prov.boot_code}" | iex`
    })
  );
});

agentRoutes.post("/device/approve", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  if (!body.user_code) return c.json(fail("user_code required"), 400);
  try {
    await approveDeviceByUserCode(c.env.KV, c.env.DB, body.user_code, {
      wecomUserid: auth.sub,
      role: primaryRole(c)
    });
  } catch (error) {
    return c.json(fail(error instanceof Error ? error.message : "approve failed"), 400);
  }
  return c.json(ok({ approved: true }));
});

agentRoutes.get("/grants", async (c) => {
  const auth = c.get("auth");
  const grants = await listGrantsForUser(c.env.DB, auth.sub);
  return c.json(ok(grants));
});

agentRoutes.post("/grants/:id/revoke", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const grant = await getGrantById(c.env.DB, id);
  if (!grant || grant.wecom_userid !== auth.sub) {
    return c.json(fail("Grant not found"), 404);
  }
  await revokeGrant(c.env.DB, id, auth.sub);
  return c.json(ok({ revoked: true }));
});
```

- [ ] **Step 4: 挂载到 `index.ts`**

在 imports 区加：`import { agentRoutes } from "./routes/agent";`
在 `app.route("/api/v1/admin", adminRoutes);` 之前加：`app.route("/api/v1/agent", agentRoutes);`

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/routes/agent.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 6: 校验类型**

Run: `cd packages/api && npm run typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/agent.ts packages/api/src/index.ts
git commit -m "feat(api): add /api/v1/agent device flow, bootstrap, grant mgmt routes"
```

---

## Task 9: super_admin 吊销任意授权（TDD）

**Files:**
- Modify: `packages/api/src/routes/admin.ts`
- Test: `packages/api/src/routes/admin-agent-grants.test.ts`

- [ ] **Step 1: 确认现有 admin 鉴权装配方式**

`admin.ts` 已 `import { requireRoles } from "../middleware/rbac";`，并在文件中 `adminRoutes.use("*", authMiddleware);` 全局挂鉴权，各路由用 `requireRoles(["super_admin"])`。下面沿用这一模式，无需新增 import。

- [ ] **Step 2: 写失败测试**

```typescript
// admin-agent-grants.test.ts
import { describe, expect, it } from "vitest";

import { createFakeD1 } from "../test-support/agent-fakes";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
import { adminRevokeAgentGrant } from "./admin";

describe("admin revoke agent grant (service-level)", () => {
  it("super_admin can revoke any grant", async () => {
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "SomeStaff",
      role: "operator"
    });
    await adminRevokeAgentGrant(db, grant.id, "super_admin_user");
    const after = await getGrantById(db, grant.id);
    expect(after?.status).toBe("revoked");
    expect(after?.revoked_by).toBe("super_admin_user");
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd packages/api && npm test -- src/routes/admin-agent-grants.test.ts`
Expected: FAIL（`adminRevokeAgentGrant` 未导出）。

- [ ] **Step 4: 在 `admin.ts` 增加导出的服务函数 + 路由**

在 `admin.ts` 顶部 imports 加：

```typescript
import { listAllGrants, revokeGrant, getGrantById } from "../services/agent-grant";
```

新增可测试的纯函数（供测试直接调用）：

```typescript
export const adminRevokeAgentGrant = async (
  db: D1Database,
  grantId: string,
  revokedBy: string
): Promise<void> => {
  await revokeGrant(db, grantId, revokedBy);
};
```

新增两个路由（放在 `adminRoutes.use("*", authMiddleware);` 之后的路由区）：

```typescript
adminRoutes.get("/agent/grants", requireRoles(["super_admin"]), async (c) => {
  const grants = await listAllGrants(c.env.DB);
  return c.json({ success: true, data: grants });
});

adminRoutes.post("/agent/grants/:id/revoke", requireRoles(["super_admin"]), async (c) => {
  const id = c.req.param("id");
  const grant = await getGrantById(c.env.DB, id);
  if (!grant) return c.json({ success: false, error: { message: "Grant not found" } }, 404);
  await adminRevokeAgentGrant(c.env.DB, id, c.get("auth").sub);
  return c.json({ success: true, data: { revoked: true } });
});
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd packages/api && npm test -- src/routes/admin-agent-grants.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/admin.ts packages/api/src/routes/admin-agent-grants.test.ts
git commit -m "feat(api): super_admin list/revoke any agent grant"
```

---

## Task 10: 环境变量绑定 + 全量校验

**Files:**
- Modify: `packages/api/wrangler.toml`

- [ ] **Step 1: 在 `wrangler.toml` 的 `[vars]` 增加两项**

Run: `grep -n "\[vars\]" packages/api/wrangler.toml`
在 `[vars]` 段下增加（值按环境）：

```toml
AGENT_WEB_BASE_URL = "https://web.hybcdg.com"
AGENT_API_BASE_URL = "https://api.hybcdg.com"
```

若存在多环境 `[env.xxx.vars]`，在每个环境段同样补上（本地 dev 可用 `http://localhost:8849` / `http://localhost:8787`）。

- [ ] **Step 2: 全量测试**

Run: `cd packages/api && npm test`
Expected: PASS（新增用例全绿，现有用例无回归）。

- [ ] **Step 3: 全量类型 + lint**

Run: `cd packages/api && npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 4: 本地冒烟（可选，手动）**

Run: `cd packages/api && npm run dev`（另开终端）
```bash
curl -s -X POST http://localhost:8787/api/v1/agent/device/code \
  -H "content-type: application/json" \
  -d '{"device_name":"smoke","agent_type":"claude_code"}' | jq
```
Expected: 返回 `success:true` 且含 `user_code`、`verification_uri_complete`。

- [ ] **Step 5: Commit**

```bash
git add packages/api/wrangler.toml
git commit -m "chore(api): bind AGENT_WEB_BASE_URL/AGENT_API_BASE_URL vars"
```

---

## 收尾：自检与远程迁移

- [ ] **应用远程 D1 迁移**（部署依赖；参照 CLAUDE.md）

Run: `cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote`
Expected: `0058_mcp_agent_grant.sql` 应用成功。

- [ ] **推送分支**（`main` 推送即部署；本功能在 `feat/mcp-agent-access` 分支，合并前不触发生产部署）

Run: `git push -u origin feat/mcp-agent-access`

---

## Self-Review 记录（对照 spec）

- **设备授权码流程（spec §5.2）** → Task 7/8：code/token/approve ✅
- **Web setup bootstrap（spec §5.1）** → Task 7/8：provision/redeem ✅
- **6 个月长期令牌（spec §2/§4）** → Task 5：`GRANT_TTL_DAYS=180` ✅
- **agent-token 运行时鉴权 + RBAC 镜像（spec §7）** → Task 6：`authMiddleware` 分支，构造 `auth` ✅（P1 用 role_snapshot，活体重解析 P2）
- **即时吊销（spec §7/§11）** → Task 5/6：每请求 D1 查 status；Task 8/9 吊销 ✅
- **审计（spec §9）** → Task 6：`writeAuditLog` via=mcp ✅
- **授权管理（spec §9）** → Task 8（本人）/Task 9（super_admin）✅
- **分发脚本（spec §6）** → Task 8：`install.sh` 占位端点（bundle 拉取/写配置在 P1b）
- **令牌仅存 hash、前缀展示、限流（spec §11）** → Task 3/5/8 ✅

**已知延后**：`install.sh` 实体逻辑、R2 bundle、MCP 包 → P1b；Web 三页 → P1c；高危延迟执行 → P2。

---

## 实现期安全修订（erratum，评审驱动）

> 以下问题在本计划的原始 Task 代码里存在，实现时经代码评审发现并已修复。**P1b/P1c/P2 在此基础上开发时必须保持这些约束，不得回退。**

1. **`authMiddleware` 同时接受人类 JWT 与 agent 令牌**（Task 6）。因此任何"必须本人网页登录"的端点，仅挂 `authMiddleware` **不够**，必须再加 `requireHumanSession`（`auth.auth_method === "mcp_agent"` → 403）。P1a 已对 `/setup/provision`、`/device/approve` 加此闸门；**P2 高危延迟执行确认端点同理必须人本人**。反向：P2 靠 `auth.via === "mcp"` 识别"智能体发起"来触发微信确认。见记忆 `mcp-agent-token-shares-authmiddleware`。

2. **`/install.sh`、`/install.ps1` 的 `?boot=` 必须校验为 UUID（`safeBoot`）后才能拼进脚本**——否则是 shell 注入→RCE（脚本走 `curl|sh`/`iex`）。P1b 完善安装器实体逻辑时，任何把请求参数拼进"将被执行的文本"的地方都要同等校验。

3. **`/me`、`/routes`（`routes/user.ts`）改为读 `c.get("auth")`**（Task 6），不再自行 `verifyToken` 重解析——否则 agent 令牌（非 JWT 形态）会被误判 401。新增受保护端点应统一读 `c.get("auth")`。

4. **令牌解析/审计失败要留痕**（`console.error`），不可静默吞。

**其它评审记录**：Task 5 补了跨用户隔离/hash-only/幂等吊销测试；Task 7 补了 `webBaseUrl` 边界校验 + `JSON.parse` 容错 + 双重批准守卫测试；Task 8 补了 owner/403/注入路由级测试。两个跨切面后续项已开独立任务：共享 `sha256Hex` 工具、`api_audit_log` 保留/归档策略。
