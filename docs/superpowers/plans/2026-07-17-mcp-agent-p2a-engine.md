# MCP 智能体接入 — P2a：高危写延迟执行引擎（park → 微信确认 → 服务端重放） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent 令牌对审批 approve/reject 的写请求被拦下并暂存（park）、推微信卡片给本人；本人确认后由服务端**全栈重放**原请求真正落库，MCP 侧可轮询结果。

**Architecture:** 在 `authMiddleware` 的 `mcp_agent` 唯一收敛点把"只读白名单未命中"细分为三路：命中高危写表且无重放标记 → park 落 `agent_pending_action` + 推微信 + 202；带有效 HMAC 重放标记 → 放行（确认后的重放）；其余 → 沿用 403。确认端点用 `app-ref` 注册的 fetcher 重放原请求，走完整中间件栈与 `approveOp`，保证"agent 的写 == 人的写"。状态机用条件 UPDATE + rows-affected 做乐观锁（生产 D1 无事务）。

**Tech Stack:** Hono / Cloudflare Workers / D1 / KV、Web Crypto HMAC-SHA256、vitest、企业微信 template_card（经 bridge 代理）。

**上游设计：** `docs/superpowers/specs/2026-07-17-mcp-agent-p2-design.md`（本计划实现其 §4–§5、§9–§11 的后端部分；confirm.vue 与 MCP 写工具见后续 P2b）。

---

## 依赖与既有事实（recon 已确认，直接采信）

- **审批端点**：`packages/api/src/routes/approval.ts:767-799`
  ```ts
  approvalRoutes.post("/:id/approve", async (c) => {
    const instanceId = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json()) as { comment?: string };   // 注意在 try 之外，空 body 会抛
    try {
      const task = await findPendingTask(c.env, instanceId, auth.sub);
      await approveOp(c.env, task.id, auth.sub, body.comment);
      return c.json({ success: true });
    } catch (err) { /* → 400 */ }
  });
  ```
  `reject` 同形。`approvalRoutes.use("*", authMiddleware)`（`approval.ts:44`）。`approveOp(env, taskId, userId, comment?)` 来自 `services/approval/operations.ts:91`。
- **authMiddleware 的 mcp_agent 分支**：`packages/api/src/middleware/auth.ts:46-128`。只读闸门在 `:63` `if (!isAllowedAgentRead(c.req.method, c.req.path))`，其内写 `agent.blocked_write` 审计并 `return agentReadonlyForbidden()`。`identity` 形如 `{ wecomUserid, roles, permissions, grantId }`。**`c.executionCtx.waitUntil` 必须 try/catch 包裹**（vitest 直接 `app.request` 时没有 executionCtx，现有代码 `:78`、`:121` 已是此写法）。
- **agent-readonly.ts**：导出 `AGENT_READONLY_MESSAGE`、`AgentReadRule`、`isAllowedAgentRead(method, path)`、`agentReadonlyForbidden()`；内部 `stripApiPrefix`（剥 `/api/v1`）、`pathnameOnly`（剥 `?#`）。白名单 13 条 GET。
- **fake D1**（`packages/api/src/test-support/agent-fakes.ts`）：按 SQL 子串分派、**仅支持 `agent_grant`**，`run()` 返回 `{ success: true, meta: {} }` —— **不支持 `meta.changes`**，本计划 Task 2 必须扩展。fake KV 支持 `get/put/delete` 与 `expirationTtl`（惰性过期）。
- **feature flag 先例**：`services/passkey.ts:26-42`，单 KV 键存 JSON，缺省按 `env.APP_ENV === "local"`，防御式 `Partial<T>` 解析。
- **审计**：`writeAuditLog(db, { actorUserId, actorRoles, action, targetType, targetId, status?, detail? })`，第一参是 `D1Database`（`c.env.DB`）。
- **企微卡片**：`sendWeComTemplateCard(env, { touser, template_card, enable_duplicate_check?, fallback_error_message? })`（`services/wecom-approval-push.ts:415`），需 `WECHAT_AGENT_ID`，经 bridge 代理；卡片 `card_action` 用 `{ type: 1, url }`。
- **index.ts**：`export default { fetch: app.fetch, queue, scheduled }`，**无具名 `app` 导出**；`routes/agent.ts` 不能静态 import `index.ts`（循环）。本计划用 `services/app-ref.ts` 注册表解决。
- **迁移风格**：见 `migrations/0058_mcp_agent_grant.sql`（`-- 文件名` 注释 + 中文用途 + `CREATE TABLE IF NOT EXISTS` + 末尾 `CREATE INDEX IF NOT EXISTS idx_<表>_<列>`）。

**流程约束：** 分支 `feat/mcp-agent-p2`（已建，spec 已提交其上）。api 包用 **npm**（web 才是 pnpm）。改动含 api，合并 push main 即部署——本计划全部在分支上，合并另行决策。**高危路径默认由 feature flag 关闭**，部署即上线也不放量。

---

## 文件结构

**新建 `packages/api/`**
- `migrations/0059_agent_pending_action.sql` — 待确认动作表
- `src/services/app-ref.ts` — app fetcher 注册表（打破循环依赖，可测试注入）
- `src/services/agent-high-risk.ts` — 高危匹配表 + matcher + feature flag 读取
- `src/services/agent-replay.ts` — HMAC 重放标记签/验 + sha256
- `src/services/agent-pending.ts` — pending 状态机（park/get/confirm/reject/claim/finish），条件 UPDATE 乐观锁
- `src/services/agent-confirm-push.ts` — 企微确认卡片
- 各配套 `*.test.ts`
- `src/routes/agent-pending.test.ts` — 端点+重放集成测试

**修改 `packages/api/`**
- `src/types/agent.ts` — 加 `AgentPendingRow`、`PendingStatus`、`PendingPublicView`
- `src/types/env.ts` — 加 `AGENT_REPLAY_SECRET`
- `wrangler.toml` — 顶层 `[vars]` 与 production section **两处一致**加 `AGENT_REPLAY_SECRET`；`.dev.vars` 本地覆盖
- `src/test-support/agent-fakes.ts` — 支持 `agent_pending_action` + `meta.changes`
- `src/middleware/agent-readonly.ts` — 白名单加 `GET /agent/pending/<uuid>`
- `src/middleware/auth.ts` — mcp_agent 分支插入高危三路裁决
- `src/routes/agent.ts` — pending 三端点 + 重放执行
- `src/index.ts` — 注册 app fetcher

**不在本计划**（P2b）：`views/agent/confirm.vue`、web `api/agent.ts` 包装、MCP 写工具与 `instructions`/`SKILL.md`、UI 文档。

---

## Task 0: 准备

- [ ] **Step 1: 确认分支与清理误拷贝文件**

Run:
```bash
cd /Users/zihaoliu/Documents/Code/hybc_core && git branch --show-current
```
Expected: `feat/mcp-agent-p2`（若不是，`git checkout feat/mcp-agent-p2`）。

工作区里有文件同步产生的未跟踪副本（文件名带 ` 2`），会干扰搜索与 typecheck，删掉：
```bash
find packages/api/src docs -name "* 2.ts" -o -name "* 2.md" | tee /dev/stderr | xargs -r rm
git status --short | grep " 2\." || echo "已清理"
```
Expected: 列出并删除若干 `agent-readonly 2.ts`、`agent-readonly.test 2.ts`、`agent-device-consent.test 2.ts`、`...p1c-web 2.md` 之类；之后无残留。（这些都是未跟踪副本，删除不影响已提交内容。）

- [ ] **Step 2: 基线全绿**

Run: `cd packages/api && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: `74 passed` / `496 passed`（P1c 合并后的基线）。

---

## Task 1: 迁移 + 类型 + 密钥

**Files:**
- Create: `packages/api/migrations/0059_agent_pending_action.sql`
- Modify: `packages/api/src/types/agent.ts`
- Modify: `packages/api/src/types/env.ts`
- Modify: `packages/api/wrangler.toml`、`packages/api/.dev.vars`

- [ ] **Step 1: 写迁移**

```sql
-- 0059_agent_pending_action.sql
-- MCP 智能体高危写操作的「待本人微信确认」暂存；确认后由服务端重放原请求执行。
CREATE TABLE IF NOT EXISTS agent_pending_action (
  -- 不透明 UUID：会出现在卡片链接与 MCP 轮询里，避免泄漏数量/顺序
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  wecom_userid TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  request_snapshot TEXT NOT NULL,
  risk_reason TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_snapshot TEXT,
  confirm_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_wecom_userid_status ON agent_pending_action(wecom_userid, status);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_grant_id ON agent_pending_action(grant_id);
CREATE INDEX IF NOT EXISTS idx_agent_pending_action_confirm_token_hash ON agent_pending_action(confirm_token_hash);
```

- [ ] **Step 2: 本地应用迁移**

Run: `cd packages/api && npm run db:migrate:local 2>&1 | tail -3`
Expected: 显示应用 `0059_agent_pending_action.sql` 成功（或"No migrations to apply"若已应用）。

- [ ] **Step 3: 加类型**（`packages/api/src/types/agent.ts` 末尾追加）

```typescript
export type PendingStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "done"
  | "failed"
  | "rejected"
  | "expired";

export interface AgentPendingRow {
  id: string;
  grant_id: string;
  wecom_userid: string;
  action_kind: string;
  /** JSON: { method, path, headers: { authorization, "content-type" }, body } */
  request_snapshot: string;
  risk_reason: string | null;
  summary: string;
  status: PendingStatus;
  /** JSON: { status: number, body: unknown } */
  result_snapshot: string | null;
  confirm_token_hash: string;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
}

/** 回给 MCP / 确认页的安全投影：绝不含 request_snapshot（内含 Authorization）与 confirm_token。 */
export interface PendingPublicView {
  id: string;
  action_kind: string;
  summary: string;
  status: PendingStatus;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  result: unknown | null;
}

export interface RequestSnapshot {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}
```

- [ ] **Step 4: 加环境变量**

`packages/api/src/types/env.ts`：在 `JWT_SECRET: string;` 附近加
```typescript
  /** 高危重放标记专用 HMAC 密钥；不复用 JWT_SECRET，缩小泄露爆炸半径。 */
  AGENT_REPLAY_SECRET: string;
```

`packages/api/wrangler.toml`：**顶层 `[vars]` 与 production 两处都要加**（对齐既有 APP_ENV 双 section 教训，两边不一致会导致生产取到错值）：
```toml
AGENT_REPLAY_SECRET = "REPLACE_WITH_PROD_SECRET"
```
`packages/api/.dev.vars` 加本地值：
```
AGENT_REPLAY_SECRET=local-dev-replay-secret-not-for-prod
```
> 生产真实值由 owner 用 `npx wrangler secret put AGENT_REPLAY_SECRET` 设置更佳；若用 `[vars]` 明文则务必换成高强度随机串。**实现者只写占位，不得编造真实密钥。**

- [ ] **Step 5: typecheck + Commit**

Run: `cd packages/api && npm run typecheck`
Expected: 通过。
```bash
git add packages/api/migrations/0059_agent_pending_action.sql packages/api/src/types/agent.ts packages/api/src/types/env.ts packages/api/wrangler.toml packages/api/.dev.vars
git commit -m "feat(api): agent_pending_action 迁移 + 类型 + 重放密钥 env"
```

---

## Task 2: 扩展 fake D1（支持 pending 表与 rows-affected）

**Files:**
- Modify: `packages/api/src/test-support/agent-fakes.ts`
- Test: `packages/api/src/test-support/agent-fakes.test.ts`（新建）

> 现有 fake 只认 `agent_grant` 且 `run()` 返回 `meta: {}`。本计划的乐观锁靠 `meta.changes` 判断单赢家，没有它整套并发保证无法测试。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/test-support/agent-fakes.test.ts
import { describe, expect, it } from "vitest";

import { createFakeD1 } from "./agent-fakes";

const insertPending = async (db: D1Database, id: string, status = "pending") => {
  await db
    .prepare(
      `INSERT INTO agent_pending_action
        (id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason, summary,
         status, confirm_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, "g1", "MaxLiu", "approval.approve", "{}", "r", "s", status, `hash-${id}`,
      "2026-07-17T00:00:00.000Z", "2026-07-17T00:10:00.000Z")
    .run();
};

describe("fake D1 · agent_pending_action", () => {
  it("inserts and reads back by id", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ?")
      .bind("p1")
      .first<{ id: string; status: string }>();
    expect(row?.id).toBe("p1");
    expect(row?.status).toBe("pending");
  });

  it("reads back by confirm_token_hash", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE confirm_token_hash = ?")
      .bind("hash-p1")
      .first<{ id: string }>();
    expect(row?.id).toBe("p1");
  });

  it("conditional UPDATE reports meta.changes = 1 on the winner and 0 on the loser", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const first = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-17T00:01:00.000Z", "p1", "2026-07-17T00:01:00.000Z")
      .run();
    expect(first.meta.changes).toBe(1);

    // 第二次同样的条件更新（模拟并发/重复确认）应当 0 行
    const second = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-17T00:01:00.000Z", "p1", "2026-07-17T00:01:00.000Z")
      .run();
    expect(second.meta.changes).toBe(0);
  });

  it("expired rows fail the expires_at guard", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'pending' AND expires_at > ?`
      )
      .bind("2026-07-17T99:00:00.000Z", "p1", "2026-07-17T99:00:00.000Z")
      .run();
    expect(res.meta.changes).toBe(0);
  });

  it("claim-for-execution transitions confirmed → executing exactly once", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "confirmed");
    const a = await db
      .prepare(`UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`)
      .bind("p1")
      .run();
    const b = await db
      .prepare(`UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`)
      .bind("p1")
      .run();
    expect(a.meta.changes).toBe(1);
    expect(b.meta.changes).toBe(0);
  });

  it("finish writes status and result_snapshot", async () => {
    const { db } = createFakeD1();
    await insertPending(db, "p1", "executing");
    const res = await db
      .prepare(
        `UPDATE agent_pending_action SET status = ?, result_snapshot = ?, executed_at = ?
         WHERE id = ? AND status = 'executing'`
      )
      .bind("done", '{"status":200}', "2026-07-17T00:02:00.000Z", "p1")
      .run();
    expect(res.meta.changes).toBe(1);
    const row = await db
      .prepare("SELECT * FROM agent_pending_action WHERE id = ?")
      .bind("p1")
      .first<{ status: string; result_snapshot: string }>();
    expect(row?.status).toBe("done");
    expect(row?.result_snapshot).toBe('{"status":200}');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/test-support/agent-fakes.test.ts`
Expected: FAIL（fake 不认 `agent_pending_action`，`meta.changes` 为 undefined）。

- [ ] **Step 3: 扩展 fake**（`packages/api/src/test-support/agent-fakes.ts`）

在 `createFakeD1` 里加一张 pending 表并让 `run()` 返回 `changes`。改法：

1）在 `const grants = new Map<string, AgentGrantRow>();` 之后加：
```typescript
  const pendings = new Map<string, Record<string, unknown>>();
```

2）在 `FakeD1` 接口加 `pendings: Map<string, Record<string, unknown>>;`，并在 `return { db, grants }` 改为 `return { db, grants, pendings }`。

3）在 `prepare(sql)` 的 `run()` 里，**最前面**加 pending 分支（保持既有 agent_grant 分支不动），并把所有返回改为带 `changes`：

```typescript
        async run() {
          // ── agent_pending_action ──
          if (sql.includes("INSERT INTO agent_pending_action")) {
            const [id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason,
                   summary, status, confirm_token_hash, created_at, expires_at] = bound as string[];
            pendings.set(id, {
              id, grant_id, wecom_userid, action_kind, request_snapshot,
              risk_reason: risk_reason ?? null, summary, status,
              result_snapshot: null, confirm_token_hash, created_at, expires_at,
              confirmed_at: null, executed_at: null
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE agent_pending_action")) {
            // 条件更新：按 SQL 里出现的 WHERE 条件手工模拟，返回 changes 表达单赢家
            if (sql.includes("SET status = 'confirmed'")) {
              const [confirmedAt, id, now] = bound as string[];
              const row = pendings.get(id);
              if (!row || row.status !== "pending" || !((row.expires_at as string) > now)) {
                return { success: true, meta: { changes: 0 } };
              }
              pendings.set(id, { ...row, status: "confirmed", confirmed_at: confirmedAt });
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'rejected'")) {
              const [id] = bound as string[];
              const row = pendings.get(id);
              if (!row || row.status !== "pending") {
                return { success: true, meta: { changes: 0 } };
              }
              pendings.set(id, { ...row, status: "rejected" });
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'executing'")) {
              const [id] = bound as string[];
              const row = pendings.get(id);
              if (!row || row.status !== "confirmed") {
                return { success: true, meta: { changes: 0 } };
              }
              pendings.set(id, { ...row, status: "executing" });
              return { success: true, meta: { changes: 1 } };
            }
            // finish：SET status = ?, result_snapshot = ?, executed_at = ? WHERE id = ? AND status = 'executing'
            const [status, resultSnapshot, executedAt, id] = bound as string[];
            const row = pendings.get(id);
            if (!row || row.status !== "executing") {
              return { success: true, meta: { changes: 0 } };
            }
            pendings.set(id, { ...row, status, result_snapshot: resultSnapshot, executed_at: executedAt });
            return { success: true, meta: { changes: 1 } };
          }

          // ── 既有 agent_grant 分支（原样保留，仅把返回补上 changes）──
          if (sql.includes("INSERT INTO agent_grant")) { runInsert(bound); return { success: true, meta: { changes: 1 } }; }
          /* …其余既有分支保持逻辑不变，返回统一改成 { success: true, meta: { changes: 1 } } … */
          return { success: true, meta: { changes: 0 } };
        },
```

4）在 `first<T>()` 里加 pending 查询（放在既有分支之前）：
```typescript
        async first<T>() {
          if (sql.includes("FROM agent_pending_action")) {
            if (sql.includes("WHERE confirm_token_hash = ?")) {
              const [hash] = bound as string[];
              const hit = [...pendings.values()].find((p) => p.confirm_token_hash === hash);
              return (hit ?? null) as T | null;
            }
            const [id] = bound as string[];
            return ((pendings.get(id) ?? null) as unknown) as T | null;
          }
          /* …既有 agent_grant 分支不动… */
        },
```

> 注意：既有 `agent_grant` 分支的行为不能改，只把 `meta` 补上 `changes`——现有测试不读 `meta`，向后兼容。

- [ ] **Step 4: 运行，确认通过 + 回归**

Run: `cd packages/api && npm test -- src/test-support/agent-fakes.test.ts`
Expected: PASS（6 passed）。
Run: `cd packages/api && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: 全绿（原 496 + 6）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/test-support/agent-fakes.ts packages/api/src/test-support/agent-fakes.test.ts
git commit -m "test(api): fake D1 支持 agent_pending_action 与 rows-affected（乐观锁可测）"
```

---

## Task 3: 高危匹配表 + feature flag（TDD）

**Files:**
- Create: `packages/api/src/services/agent-high-risk.ts`
- Test: `packages/api/src/services/agent-high-risk.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/services/agent-high-risk.test.ts
import { describe, expect, it } from "vitest";

import { isHighRiskEnabled, matchHighRisk } from "./agent-high-risk";
import { createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

describe("matchHighRisk", () => {
  it("matches approval approve/reject with action kind", () => {
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve")).toMatchObject({
      actionKind: "approval.approve"
    });
    expect(matchHighRisk("POST", "/api/v1/approval/7/reject")).toMatchObject({
      actionKind: "approval.reject"
    });
  });

  it("matches without the /api/v1 prefix and ignores query strings", () => {
    expect(matchHighRisk("POST", "/approval/42/approve")).not.toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve?x=1")).not.toBeNull();
  });

  it("does not match reads, other writes, or near-miss paths", () => {
    expect(matchHighRisk("GET", "/api/v1/approval/42")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/transfer")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/payment")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/abc/approve")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve/extra")).toBeNull();
  });

  it("is method sensitive", () => {
    expect(matchHighRisk("GET", "/api/v1/approval/42/approve")).toBeNull();
  });
});

const envWith = (kv: KVNamespace, appEnv: string): Env =>
  ({ KV: kv, APP_ENV: appEnv }) as unknown as Env;

describe("isHighRiskEnabled", () => {
  it("defaults to enabled only in local when the KV key is absent", async () => {
    const { kv } = createFakeKV();
    expect(await isHighRiskEnabled(envWith(kv, "local"))).toBe(true);
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
  });

  it("honours an explicit enabled flag", async () => {
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: true }));
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(true);
  });

  it("treats anything but a literal true as disabled, and malformed JSON as disabled", async () => {
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: "yes" }));
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
    await kv.put("agent:highrisk:config", "{not json");
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-high-risk.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/api/src/services/agent-high-risk.ts
import type { Env } from "../types/env";

/**
 * 高危写匹配表：mcp_agent 令牌命中这些端点时不直接执行，而是 park 成待确认动作，
 * 推微信卡片给授权人本人，确认后由服务端重放执行。
 *
 * 首批仅审批 approve/reject（P2a 窄验证闭环）。付款/报销/合同金额变更留 P3。
 * 新增条目必须同步补单测，并确认该端点的业务语义适合"人在环延迟执行"。
 */
export interface HighRiskRule {
  readonly method: "POST";
  /** 归一化后（剥离 /api/v1 与 query）的路径正则，必须锚定首尾。 */
  readonly pattern: RegExp;
  /** 审计与卡片文案用的动作类型。 */
  readonly actionKind: string;
  /** 展示给员工的风险说明。 */
  readonly riskReason: string;
}

const HIGH_RISK_RULES: readonly HighRiskRule[] = [
  {
    method: "POST",
    pattern: /^\/approval\/\d+\/approve$/,
    actionKind: "approval.approve",
    riskReason: "智能体请求批准审批单"
  },
  {
    method: "POST",
    pattern: /^\/approval\/\d+\/reject$/,
    actionKind: "approval.reject",
    riskReason: "智能体请求拒绝审批单"
  }
];

const stripApiPrefix = (path: string): string => path.replace(/^\/api\/v1(?=\/|$)/, "");
const pathnameOnly = (path: string): string => path.replace(/[?#].*$/, "");

/** 命中返回规则，否则 null。 */
export const matchHighRisk = (method: string, path: string): HighRiskRule | null => {
  const upper = method.toUpperCase();
  const normalized = stripApiPrefix(pathnameOnly(path));
  return (
    HIGH_RISK_RULES.find(
      (rule) => rule.method === upper && rule.pattern.test(normalized)
    ) ?? null
  );
};

const HIGH_RISK_KV_KEY = "agent:highrisk:config";

/**
 * 高危写路径总开关（部署了也能先不放量）。
 * 缺省：仅本地开启，生产关闭——与 passkey feature flag 同款保守口径。
 */
export const isHighRiskEnabled = async (env: Env): Promise<boolean> => {
  const raw = await env.KV.get(HIGH_RISK_KV_KEY);
  if (!raw) {
    return env.APP_ENV === "local";
  }
  try {
    const parsed = JSON.parse(raw) as Partial<{ enabled: boolean }>;
    return parsed.enabled === true;
  } catch (err) {
    console.error("agent highrisk flag parse failed", err);
    return false;
  }
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-high-risk.test.ts`
Expected: PASS（7 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-high-risk.ts packages/api/src/services/agent-high-risk.test.ts
git commit -m "feat(api): 高危写匹配表 + KV feature flag（默认仅本地开）"
```

---

## Task 4: 重放标记签名/校验（TDD）

**Files:**
- Create: `packages/api/src/services/agent-replay.ts`
- Test: `packages/api/src/services/agent-replay.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/services/agent-replay.test.ts
import { describe, expect, it } from "vitest";

import {
  REPLAY_HEADER,
  sha256Hex,
  signReplayMarker,
  verifyReplayMarker
} from "./agent-replay";

const SECRET = "test-replay-secret";

describe("sha256Hex", () => {
  it("is stable and differs by content", async () => {
    expect(await sha256Hex("a")).toBe(await sha256Hex("a"));
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});

describe("replay marker", () => {
  it("verifies a marker it signed", async () => {
    const bodyHash = await sha256Hex('{"comment":"ok"}');
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker)).toBe(true);
  });

  it("rejects a marker signed with a different secret", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker("other-secret", "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker bound to a different pending id", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-2", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker when the body changed", async () => {
    const marker = await signReplayMarker(SECRET, "pending-1", await sha256Hex("{}"));
    const tampered = await sha256Hex('{"comment":"evil"}');
    expect(await verifyReplayMarker(SECRET, "pending-1", tampered, marker)).toBe(false);
  });

  it("rejects garbage, empty and truncated markers without throwing", async () => {
    const bodyHash = await sha256Hex("{}");
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, "")).toBe(false);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, "!!!not-base64!!!")).toBe(false);
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker.slice(0, 8))).toBe(false);
  });

  it("exposes the header name used to carry the marker", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-replay.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/api/src/services/agent-replay.ts

/**
 * 高危动作确认后「服务端重放」用的不可伪造标记。
 *
 * 标记 = base64(HMAC-SHA256(AGENT_REPLAY_SECRET, `${pendingId}:${bodyHash}`))，
 * 由服务端在重放前派生并放进请求头；高危闸门用同一密钥重算比对。
 * 外部客户端没有密钥，无法伪造；标记绑定 pendingId + body 摘要，
 * 换一笔动作或改动 body 都会验不过。**绝不接受任何来自客户端的"我是重放"声明。**
 */
export const REPLAY_HEADER = "x-hybc-agent-replay";

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hmac = async (secret: string, message: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
};

export const signReplayMarker = async (
  secret: string,
  pendingId: string,
  bodyHash: string
): Promise<string> => toBase64(await hmac(secret, `${pendingId}:${bodyHash}`));

/** 常数时间比较，避免按字节泄漏。 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const verifyReplayMarker = async (
  secret: string,
  pendingId: string,
  bodyHash: string,
  marker: string
): Promise<boolean> => {
  if (!marker) return false;
  try {
    const expected = await signReplayMarker(secret, pendingId, bodyHash);
    return timingSafeEqual(expected, marker);
  } catch (err) {
    console.error("replay marker verify failed", err);
    return false;
  }
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-replay.test.ts`
Expected: PASS（7 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-replay.ts packages/api/src/services/agent-replay.test.ts
git commit -m "feat(api): 重放标记 HMAC 签名与常数时间校验"
```

---

## Task 5: pending 状态机（TDD）

**Files:**
- Create: `packages/api/src/services/agent-pending.ts`
- Test: `packages/api/src/services/agent-pending.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/services/agent-pending.test.ts
import { describe, expect, it } from "vitest";

import {
  PENDING_TTL_SECONDS,
  claimForExecution,
  confirmPending,
  finishPending,
  getPendingById,
  getPendingByConfirmToken,
  parkPendingAction,
  rejectPending,
  toPublicView
} from "./agent-pending";
import { createFakeD1 } from "../test-support/agent-fakes";

const park = async (db: D1Database) =>
  parkPendingAction(db, {
    grantId: "g1",
    wecomUserid: "MaxLiu",
    actionKind: "approval.approve",
    riskReason: "智能体请求批准审批单",
    summary: "批准审批单 #42",
    snapshot: {
      method: "POST",
      path: "/api/v1/approval/42/approve",
      headers: { authorization: "Bearer hybc_agent_x", "content-type": "application/json" },
      body: '{"comment":"ok"}'
    }
  });

describe("parkPendingAction", () => {
  it("stores a pending row and returns a one-time confirm token", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(parked.id).toBeTruthy();
    expect(parked.confirmToken).toBeTruthy();
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("pending");
    expect(row?.wecom_userid).toBe("MaxLiu");
    // 明文 token 不落库，只存 hash
    expect(row?.confirm_token_hash).not.toBe(parked.confirmToken);
  });

  it("is findable by confirm token and not by a wrong one", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect((await getPendingByConfirmToken(db, parked.confirmToken))?.id).toBe(parked.id);
    expect(await getPendingByConfirmToken(db, "wrong-token")).toBeNull();
  });
});

describe("state machine (optimistic locking)", () => {
  it("confirms once; a second confirm is a no-op", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await confirmPending(db, parked.id)).toBe(true);
    expect(await confirmPending(db, parked.id)).toBe(false);
    expect((await getPendingById(db, parked.id))?.status).toBe("confirmed");
  });

  it("rejects once; cannot confirm a rejected action", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await rejectPending(db, parked.id)).toBe(true);
    expect(await rejectPending(db, parked.id)).toBe(false);
    expect(await confirmPending(db, parked.id)).toBe(false);
    expect((await getPendingById(db, parked.id))?.status).toBe("rejected");
  });

  it("claims execution exactly once", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    expect(await claimForExecution(db, parked.id)).toBe(true);
    expect(await claimForExecution(db, parked.id)).toBe(false);
    expect((await getPendingById(db, parked.id))?.status).toBe("executing");
  });

  it("cannot claim without confirming first", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    expect(await claimForExecution(db, parked.id)).toBe(false);
  });

  it("finishes with done + result snapshot", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    await confirmPending(db, parked.id);
    await claimForExecution(db, parked.id);
    await finishPending(db, parked.id, "done", { status: 200, body: { success: true } });
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("done");
    expect(JSON.parse(row?.result_snapshot as string)).toMatchObject({ status: 200 });
  });
});

describe("toPublicView", () => {
  it("never leaks the request snapshot or the token hash", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    const view = toPublicView(row!);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain(row!.confirm_token_hash);
    expect(view).toMatchObject({ id: parked.id, status: "pending", summary: "批准审批单 #42" });
  });

  it("reports expired for a past-due pending row", async () => {
    const { db } = createFakeD1();
    const parked = await park(db);
    const row = await getPendingById(db, parked.id);
    const stale = { ...row!, expires_at: "2000-01-01T00:00:00.000Z" };
    expect(toPublicView(stale).status).toBe("expired");
  });
});

describe("TTL", () => {
  it("is ten minutes", () => {
    expect(PENDING_TTL_SECONDS).toBe(600);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-pending.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/api/src/services/agent-pending.ts
import { sha256Hex } from "./agent-replay";
import type {
  AgentPendingRow,
  PendingPublicView,
  PendingStatus,
  RequestSnapshot
} from "../types/agent";

/** 待确认动作有效期：10 分钟。 */
export const PENDING_TTL_SECONDS = 600;

export interface ParkInput {
  grantId: string;
  wecomUserid: string;
  actionKind: string;
  riskReason: string;
  summary: string;
  snapshot: RequestSnapshot;
}

export interface ParkResult {
  id: string;
  /** 明文一次性确认令牌；只在此刻返回（用于拼卡片链接），库里只存其 SHA-256。 */
  confirmToken: string;
  expiresAt: string;
}

const randomToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const parkPendingAction = async (
  db: D1Database,
  input: ParkInput
): Promise<ParkResult> => {
  const id = crypto.randomUUID();
  const confirmToken = randomToken();
  const confirmTokenHash = await sha256Hex(confirmToken);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO agent_pending_action
        (id, grant_id, wecom_userid, action_kind, request_snapshot, risk_reason, summary,
         status, confirm_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.grantId,
      input.wecomUserid,
      input.actionKind,
      JSON.stringify(input.snapshot),
      input.riskReason,
      input.summary,
      "pending",
      confirmTokenHash,
      createdAt,
      expiresAt
    )
    .run();

  return { id, confirmToken, expiresAt };
};

export const getPendingById = async (
  db: D1Database,
  id: string
): Promise<AgentPendingRow | null> =>
  db
    .prepare(`SELECT * FROM agent_pending_action WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<AgentPendingRow>();

export const getPendingByConfirmToken = async (
  db: D1Database,
  confirmToken: string
): Promise<AgentPendingRow | null> => {
  const hash = await sha256Hex(confirmToken);
  return db
    .prepare(`SELECT * FROM agent_pending_action WHERE confirm_token_hash = ? LIMIT 1`)
    .bind(hash)
    .first<AgentPendingRow>();
};

/**
 * 以下状态迁移全部用「条件 UPDATE + rows-affected」实现乐观锁：
 * 生产 D1 不支持事务回滚，只能靠单条件更新保证并发下单赢家、至多执行一次。
 * 返回 true 表示本次调用抢到了这次迁移。
 */
const changed = (res: { meta?: { changes?: number } }): boolean =>
  (res.meta?.changes ?? 0) === 1;

export const confirmPending = async (db: D1Database, id: string): Promise<boolean> => {
  const now = new Date().toISOString();
  const res = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'confirmed', confirmed_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`
    )
    .bind(now, id, now)
    .run();
  return changed(res);
};

export const rejectPending = async (db: D1Database, id: string): Promise<boolean> => {
  const res = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'rejected' WHERE id = ? AND status = 'pending'`
    )
    .bind(id)
    .run();
  return changed(res);
};

export const claimForExecution = async (db: D1Database, id: string): Promise<boolean> => {
  const res = await db
    .prepare(
      `UPDATE agent_pending_action SET status = 'executing' WHERE id = ? AND status = 'confirmed'`
    )
    .bind(id)
    .run();
  return changed(res);
};

export const finishPending = async (
  db: D1Database,
  id: string,
  status: Extract<PendingStatus, "done" | "failed">,
  result: { status: number; body: unknown }
): Promise<boolean> => {
  const res = await db
    .prepare(
      `UPDATE agent_pending_action SET status = ?, result_snapshot = ?, executed_at = ?
       WHERE id = ? AND status = 'executing'`
    )
    .bind(status, JSON.stringify(result), new Date().toISOString(), id)
    .run();
  return changed(res);
};

/**
 * 对外投影：**绝不回显 request_snapshot（内含 Authorization 头）与 confirm_token_hash**。
 * 过期惰性判定：到期且仍处于未终态时对外呈现 expired。
 */
export const toPublicView = (row: AgentPendingRow): PendingPublicView => {
  const notSettled = row.status === "pending" || row.status === "confirmed";
  const expired = notSettled && row.expires_at <= new Date().toISOString();
  return {
    id: row.id,
    action_kind: row.action_kind,
    summary: row.summary,
    status: expired ? "expired" : row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    confirmed_at: row.confirmed_at,
    executed_at: row.executed_at,
    result: row.result_snapshot ? JSON.parse(row.result_snapshot) : null
  };
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-pending.test.ts`
Expected: PASS（10 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-pending.ts packages/api/src/services/agent-pending.test.ts
git commit -m "feat(api): pending 状态机（乐观锁单赢家 + 安全投影）"
```

---

## Task 6: 企微确认卡片（TDD）

**Files:**
- Create: `packages/api/src/services/agent-confirm-push.ts`
- Test: `packages/api/src/services/agent-confirm-push.test.ts`

> `sendWeComTemplateCard` 会真发网络请求，测试里注入一个假的 sender，只验卡片内容与链接拼装。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/services/agent-confirm-push.test.ts
import { describe, expect, it, vi } from "vitest";

import { buildConfirmCard, pushConfirmCard } from "./agent-confirm-push";
import type { Env } from "../types/env";

const env = ({ AGENT_WEB_BASE_URL: "https://web.hybcdg.com" }) as unknown as Env;

describe("buildConfirmCard", () => {
  it("shows the summary and links to the hash-routed confirm page", () => {
    const card = buildConfirmCard(env, {
      summary: "批准审批单 #42（张三 申请：付款 ￥120,000）",
      riskReason: "智能体请求批准审批单",
      confirmToken: "tok123",
      deviceName: "Max 的 MacBook"
    });
    const json = JSON.stringify(card);
    expect(json).toContain("批准审批单 #42");
    expect(json).toContain("Max 的 MacBook");
    // 必须是 hash 路由的确认页（路径模式在生产会 404）
    expect(json).toContain("https://web.hybcdg.com/#/agent/confirm?token=tok123");
  });

  it("url-encodes the token", () => {
    const card = buildConfirmCard(env, {
      summary: "s",
      riskReason: "r",
      confirmToken: "a b&c",
      deviceName: null
    });
    expect(JSON.stringify(card)).toContain("token=a%20b%26c");
  });
});

describe("pushConfirmCard", () => {
  it("sends to the granting employee via the injected sender", async () => {
    const sender = vi.fn(async () => ({ msgid: "m1", invaliduser: null, unlicenseduser: null }));
    await pushConfirmCard(
      env,
      {
        wecomUserid: "MaxLiu",
        summary: "批准审批单 #42",
        riskReason: "智能体请求批准审批单",
        confirmToken: "tok123",
        deviceName: null
      },
      sender
    );
    expect(sender).toHaveBeenCalledTimes(1);
    const [, input] = sender.mock.calls[0];
    expect(input.touser).toBe("MaxLiu");
    expect(JSON.stringify(input.template_card)).toContain("tok123");
  });

  it("never throws out of the push path (a failed card must not break the park)", async () => {
    const sender = vi.fn(async () => {
      throw new Error("wecom down");
    });
    await expect(
      pushConfirmCard(
        env,
        { wecomUserid: "MaxLiu", summary: "s", riskReason: "r", confirmToken: "t", deviceName: null },
        sender
      )
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-confirm-push.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/api/src/services/agent-confirm-push.ts
import { sendWeComTemplateCard } from "./wecom-approval-push";
import type { Env } from "../types/env";

export interface ConfirmCardInput {
  summary: string;
  riskReason: string;
  confirmToken: string;
  deviceName: string | null;
}

export interface PushConfirmInput extends ConfirmCardInput {
  wecomUserid: string;
}

/** 与 sendWeComTemplateCard 同形，便于测试注入。 */
export type TemplateCardSender = (
  env: Env,
  input: { touser: string; template_card: Record<string, unknown>; enable_duplicate_check?: 0 | 1 }
) => Promise<{ msgid: string | null; invaliduser: string | null; unlicenseduser: string | null }>;

export const buildConfirmCard = (
  env: Env,
  input: ConfirmCardInput
): Record<string, unknown> => {
  const webBase = (env.AGENT_WEB_BASE_URL ?? "https://web.hybcdg.com").replace(/\/$/, "");
  // hash 路由：确认页只存在于 #/agent/confirm，路径模式在 Pages 上会 404
  const url = `${webBase}/#/agent/confirm?token=${encodeURIComponent(input.confirmToken)}`;
  return {
    card_type: "text_notice",
    source: { desc: "智能体接入", desc_color: 0 },
    main_title: {
      title: "智能体操作确认",
      desc: input.riskReason
    },
    emphasis_content: {
      title: input.summary,
      desc: "待你确认"
    },
    sub_title_text: `${
      input.deviceName ? `发起设备：${input.deviceName}。` : ""
    }确认前请核对单号与内容；10 分钟内有效，逾期需重新发起。`,
    jump_list: [{ type: 1, title: "查看并确认", url }],
    card_action: { type: 1, url }
  };
};

/**
 * 推送确认卡片。**任何推送失败都不得让 park 失败**——动作已落库，
 * 员工仍可从确认页/轮询看到它；因此这里吞掉异常只记日志。
 */
export const pushConfirmCard = async (
  env: Env,
  input: PushConfirmInput,
  sender: TemplateCardSender = sendWeComTemplateCard
): Promise<void> => {
  try {
    await sender(env, {
      touser: input.wecomUserid,
      template_card: buildConfirmCard(env, input),
      enable_duplicate_check: 0
    });
  } catch (err) {
    console.error("agent confirm card push failed", err);
  }
};
```

- [ ] **Step 4: 运行，确认通过 + typecheck**

Run: `cd packages/api && npm test -- src/services/agent-confirm-push.test.ts`
Expected: PASS（4 passed）。
Run: `cd packages/api && npm run typecheck`
Expected: 通过（若 `Env` 无 `AGENT_WEB_BASE_URL` 报错，说明已有该字段名不同——按 `types/env.ts` 实际字段名调整并在报告中说明）。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/agent-confirm-push.ts packages/api/src/services/agent-confirm-push.test.ts
git commit -m "feat(api): 企微高危确认卡片（hash 确认页链接，推送失败不影响 park）"
```

---

## Task 7: app fetcher 注册表（打破循环依赖）

**Files:**
- Create: `packages/api/src/services/app-ref.ts`
- Test: `packages/api/src/services/app-ref.test.ts`
- Modify: `packages/api/src/index.ts`

> `routes/agent.ts` 需要重放整包请求，但不能静态 import `index.ts`（会循环）。用注册表：index 在模块求值时注册 fetcher，agent 路由运行时取用；测试可注入假的。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/services/app-ref.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { getAppFetcher, resetAppFetcher, setAppFetcher } from "./app-ref";

describe("app-ref", () => {
  beforeEach(() => resetAppFetcher());

  it("returns the registered fetcher", async () => {
    const fake = async () => new Response("ok");
    setAppFetcher(fake);
    const fetcher = getAppFetcher();
    expect(await (await fetcher(new Request("https://x/"), {} as never)).text()).toBe("ok");
  });

  it("throws a clear error when nothing is registered", () => {
    expect(() => getAppFetcher()).toThrow(/app fetcher not registered/i);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/app-ref.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/api/src/services/app-ref.ts
import type { Env } from "../types/env";

/**
 * 应用 fetcher 注册表。
 *
 * 高危动作确认后要「全栈重放」原请求，需要重新进入整个 Hono app；
 * 但 routes/agent.ts 被 index.ts 引入，不能反向静态 import（循环依赖）。
 * 因此由 index.ts 在模块求值时注册，路由运行时取用；测试可注入假实现。
 */
export type AppFetcher = (
  request: Request,
  env: Env,
  ctx?: ExecutionContext
) => Promise<Response>;

let fetcher: AppFetcher | null = null;

export const setAppFetcher = (fn: AppFetcher): void => {
  fetcher = fn;
};

export const resetAppFetcher = (): void => {
  fetcher = null;
};

export const getAppFetcher = (): AppFetcher => {
  if (!fetcher) {
    throw new Error("app fetcher not registered");
  }
  return fetcher;
};
```

- [ ] **Step 4: index.ts 注册**

在 `packages/api/src/index.ts` 顶部 import 区加：
```typescript
import { setAppFetcher } from "./services/app-ref";
```
在文件末尾 `export default {...}` **之前**加：
```typescript
// 供高危动作确认后的服务端重放复用整包中间件栈（见 services/agent-pending 执行路径）
setAppFetcher((request, env, ctx) => app.fetch(request, env, ctx));
```

- [ ] **Step 5: 运行，确认通过 + typecheck**

Run: `cd packages/api && npm test -- src/services/app-ref.test.ts`
Expected: PASS（2 passed）。
Run: `cd packages/api && npm run typecheck`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/app-ref.ts packages/api/src/services/app-ref.test.ts packages/api/src/index.ts
git commit -m "feat(api): app fetcher 注册表（为全栈重放打破循环依赖）"
```

---

## Task 8: 闸门三路裁决（park / 重放放行 / 403）（TDD）

**Files:**
- Modify: `packages/api/src/middleware/agent-readonly.ts`（白名单加 pending 读）
- Modify: `packages/api/src/middleware/auth.ts`（插入高危裁决）
- Create: `packages/api/src/middleware/agent-high-risk-gate.ts`（裁决与 park 落地）
- Test: `packages/api/src/middleware/agent-high-risk-gate.test.ts`

- [ ] **Step 1: 只读白名单加 pending 读**

`packages/api/src/middleware/agent-readonly.ts` 的 `ALLOWED_AGENT_READS` 数组末尾加一条（uuid 形态，与其余 `\d+` 不同）：
```typescript
  {
    method: "GET",
    pattern: /^\/agent\/pending\/[0-9a-f-]{36}$/i,
    tool: "check_pending"
  }
```
> 归属校验在路由里做（只能读自己 grant 的），白名单只负责"这个形状的读允许到达路由"。

- [ ] **Step 2: 写失败测试**

```typescript
// packages/api/src/middleware/agent-high-risk-gate.test.ts
import { describe, expect, it } from "vitest";

import { decideAgentRequest } from "./agent-high-risk-gate";
import { createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";
import { REPLAY_HEADER, sha256Hex, signReplayMarker } from "../services/agent-replay";

const SECRET = "test-replay-secret";
const envWith = async (opts: { enabled: boolean }): Promise<Env> => {
  const { kv } = createFakeKV();
  await kv.put("agent:highrisk:config", JSON.stringify({ enabled: opts.enabled }));
  return { KV: kv, APP_ENV: "production", AGENT_REPLAY_SECRET: SECRET } as unknown as Env;
};

describe("decideAgentRequest", () => {
  it("allows an allowlisted read", async () => {
    const env = await envWith({ enabled: true });
    const d = await decideAgentRequest(env, "GET", "/api/v1/project", "", null);
    expect(d.kind).toBe("allow");
  });

  it("parks a high-risk write when the flag is on", async () => {
    const env = await envWith({ enabled: true });
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", '{"comment":"ok"}', null);
    expect(d.kind).toBe("park");
    if (d.kind === "park") expect(d.rule.actionKind).toBe("approval.approve");
  });

  it("forbids a high-risk write when the flag is off", async () => {
    const env = await envWith({ enabled: false });
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", "{}", null);
    expect(d.kind).toBe("forbid");
  });

  it("forbids anything not on either list", async () => {
    const env = await envWith({ enabled: true });
    expect((await decideAgentRequest(env, "POST", "/api/v1/payment", "{}", null)).kind).toBe("forbid");
    expect(
      (await decideAgentRequest(env, "GET", "/api/v1/reimbursement/1/ocr-status", "", null)).kind
    ).toBe("forbid");
  });

  it("allows a high-risk write carrying a valid replay marker", async () => {
    const env = await envWith({ enabled: true });
    const body = '{"comment":"ok"}';
    const marker = await signReplayMarker(SECRET, "pending-1", await sha256Hex(body));
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-1",
      marker
    });
    expect(d.kind).toBe("replay");
  });

  it("parks (never allows) when the replay marker is forged or mismatched", async () => {
    const env = await envWith({ enabled: true });
    const body = '{"comment":"ok"}';
    const forged = await signReplayMarker("wrong-secret", "pending-1", await sha256Hex(body));
    const d1 = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-1",
      marker: forged
    });
    expect(d1.kind).toBe("park");

    const good = await signReplayMarker(SECRET, "pending-1", await sha256Hex(body));
    const d2 = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", '{"comment":"evil"}', {
      pendingId: "pending-1",
      marker: good
    });
    expect(d2.kind).toBe("park");
  });

  it("exposes the header used to carry the marker and pending id", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd packages/api && npm test -- src/middleware/agent-high-risk-gate.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 4: 实现裁决**

```typescript
// packages/api/src/middleware/agent-high-risk-gate.ts
import { isAllowedAgentRead } from "./agent-readonly";
import { isHighRiskEnabled, matchHighRisk, type HighRiskRule } from "../services/agent-high-risk";
import { sha256Hex, verifyReplayMarker } from "../services/agent-replay";
import type { Env } from "../types/env";

/** 重放请求额外带的 pending id 头（与签名头配套；单独带它没有意义，签名才是凭据）。 */
export const REPLAY_PENDING_HEADER = "x-hybc-agent-pending";

export type AgentDecision =
  | { kind: "allow" }
  | { kind: "replay"; pendingId: string }
  | { kind: "park"; rule: HighRiskRule }
  | { kind: "forbid" };

/**
 * mcp_agent 请求的统一裁决（deny-by-default）：
 *   只读白名单命中            → allow
 *   高危写 + 有效重放标记      → replay（确认后的服务端重放，放行执行）
 *   高危写 + flag 开           → park（暂存并推微信确认）
 *   高危写 + flag 关           → forbid
 *   其余                      → forbid
 *
 * 注意：重放标记验不过时**降级为 park，绝不 allow**——伪造标记者拿不到执行。
 */
export const decideAgentRequest = async (
  env: Env,
  method: string,
  path: string,
  body: string,
  replay: { pendingId: string; marker: string } | null
): Promise<AgentDecision> => {
  if (isAllowedAgentRead(method, path)) {
    return { kind: "allow" };
  }

  const rule = matchHighRisk(method, path);
  if (!rule) {
    return { kind: "forbid" };
  }

  if (replay?.marker && replay.pendingId) {
    const ok = await verifyReplayMarker(
      env.AGENT_REPLAY_SECRET,
      replay.pendingId,
      await sha256Hex(body),
      replay.marker
    );
    if (ok) {
      return { kind: "replay", pendingId: replay.pendingId };
    }
  }

  if (!(await isHighRiskEnabled(env))) {
    return { kind: "forbid" };
  }
  return { kind: "park", rule };
};
```

- [ ] **Step 5: 运行，确认通过**

Run: `cd packages/api && npm test -- src/middleware/agent-high-risk-gate.test.ts`
Expected: PASS（7 passed）。

- [ ] **Step 6: 接入 authMiddleware**

`packages/api/src/middleware/auth.ts`：顶部 import 加
```typescript
import { REPLAY_PENDING_HEADER, decideAgentRequest } from "./agent-high-risk-gate";
import { REPLAY_HEADER } from "../services/agent-replay";
import { parkAndRespond } from "../services/agent-park";
```
把 `:63` 处的只读闸门整块替换为：

```typescript
    // agent 请求统一裁决：只读放行 / 高危 park / 确认后重放放行 / 其余 403
    // 读 body 用 clone，绝不能把下游 handler 要用的 body 吃掉
    const rawBody =
      c.req.method === "GET" || c.req.method === "HEAD"
        ? ""
        : await c.req.raw.clone().text();
    const replayMarker = c.req.header(REPLAY_HEADER);
    const replayPendingId = c.req.header(REPLAY_PENDING_HEADER);
    const decision = await decideAgentRequest(
      c.env,
      c.req.method,
      c.req.path,
      rawBody,
      replayMarker && replayPendingId
        ? { pendingId: replayPendingId, marker: replayMarker }
        : null
    );

    if (decision.kind === "forbid") {
      const blockedAudit = writeAuditLog(c.env.DB, {
        actorUserId: identity.wecomUserid,
        actorRoles: identity.roles,
        action: "agent.blocked_write",
        targetType: "agent_request",
        targetId: c.req.path,
        status: "blocked",
        detail: { via: "mcp", grant_id: identity.grantId, method: c.req.method }
      }).catch((err) => {
        console.error("agent blocked-write audit failed", err);
      });
      try {
        c.executionCtx.waitUntil(blockedAudit);
      } catch {
        void blockedAudit;
      }
      return agentReadonlyForbidden();
    }

    if (decision.kind === "park") {
      return parkAndRespond(c, identity, decision.rule, rawBody);
    }
    // allow / replay 继续往下走（replay 已由 HMAC 验明是服务端自己发起的）
```

- [ ] **Step 7: 实现 park 落地**（`packages/api/src/services/agent-park.ts`，新建）

```typescript
// packages/api/src/services/agent-park.ts
import { parkPendingAction } from "./agent-pending";
import { pushConfirmCard } from "./agent-confirm-push";
import { getGrantById } from "./agent-grant";
import { writeAuditLog } from "./audit-log";
import type { HighRiskRule } from "./agent-high-risk";
import type { Env } from "../types/env";

interface AgentIdentityLike {
  wecomUserid: string;
  roles: string[];
  grantId: string;
}

/** 从路径里取审批实例号，拼一句人读摘要。 */
const buildSummary = (rule: HighRiskRule, path: string): string => {
  const id = path.match(/\/approval\/(\d+)\//)?.[1] ?? "?";
  const verb = rule.actionKind === "approval.approve" ? "批准" : "拒绝";
  return `${verb}审批单 #${id}`;
};

/**
 * 落 pending + 推微信卡片，返回 202。
 * 注意 202 的 data.status 才是 MCP 侧的判定依据——MCP 客户端会丢弃 HTTP 状态码。
 */
export const parkAndRespond = async (
  c: {
    env: Env;
    req: { method: string; path: string; header: (k: string) => string | undefined };
    executionCtx: ExecutionContext;
    json: (body: unknown, status?: number) => Response;
  },
  identity: AgentIdentityLike,
  rule: HighRiskRule,
  rawBody: string
): Promise<Response> => {
  const summary = buildSummary(rule, c.req.path);
  const parked = await parkPendingAction(c.env.DB, {
    grantId: identity.grantId,
    wecomUserid: identity.wecomUserid,
    actionKind: rule.actionKind,
    riskReason: rule.riskReason,
    summary,
    snapshot: {
      method: c.req.method,
      path: c.req.path,
      headers: {
        authorization: c.req.header("authorization") ?? "",
        "content-type": c.req.header("content-type") ?? "application/json"
      },
      body: rawBody
    }
  });

  const grant = await getGrantById(c.env.DB, identity.grantId);
  const side = Promise.all([
    pushConfirmCard(c.env, {
      wecomUserid: identity.wecomUserid,
      summary,
      riskReason: rule.riskReason,
      confirmToken: parked.confirmToken,
      deviceName: grant?.device_name ?? null
    }),
    writeAuditLog(c.env.DB, {
      actorUserId: identity.wecomUserid,
      actorRoles: identity.roles,
      action: "agent.high_risk_parked",
      targetType: "agent_pending_action",
      targetId: parked.id,
      detail: {
        via: "mcp",
        grant_id: identity.grantId,
        action_kind: rule.actionKind,
        path: c.req.path
      }
    })
  ]).catch((err) => {
    console.error("agent park side effects failed", err);
  });
  try {
    c.executionCtx.waitUntil(side);
  } catch {
    void side;
  }

  return c.json(
    {
      success: true,
      data: {
        pending_action_id: parked.id,
        status: "awaiting_confirmation",
        summary,
        expires_at: parked.expiresAt,
        poll_after: 3,
        message: "已推送确认卡片到你的企业微信，请本人确认后该操作才会执行。"
      }
    },
    202
  );
};
```

- [ ] **Step 8: 全量回归 + typecheck**

Run: `cd packages/api && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: 全绿。**若既有 agent 只读测试因新增 body clone 而失败，说明 clone 用法有误——修实现，不要改测试。**
Run: `cd packages/api && npm run typecheck && npm run lint`
Expected: 通过。

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/middleware/agent-high-risk-gate.ts packages/api/src/middleware/agent-high-risk-gate.test.ts packages/api/src/middleware/agent-readonly.ts packages/api/src/middleware/auth.ts packages/api/src/services/agent-park.ts
git commit -m "feat(api): agent 请求三路裁决（park/重放放行/403）+ park 落地与 202"
```

---

## Task 9: pending 端点 + 确认触发重放（TDD 集成）

**Files:**
- Modify: `packages/api/src/routes/agent.ts`
- Test: `packages/api/src/routes/agent-pending.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/routes/agent-pending.test.ts
import { describe, expect, it, vi } from "vitest";

import { agentRoutes } from "./agent";
import { createAgentGrant } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import { getPendingById, parkPendingAction } from "../services/agent-pending";
import { resetAppFetcher, setAppFetcher } from "../services/app-ref";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_REPLAY_SECRET: "test-replay-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    APP_ENV: "local"
  }) as unknown as Env;

const humanJwt = async (env: Env, userId: string) => {
  const issued = await issueTokens(
    env,
    createSessionPayload({ userId, username: userId, role: "manager" })
  );
  return issued.accessToken;
};

const park = async (db: D1Database, wecomUserid = "MaxLiu", grantId = "g1") =>
  parkPendingAction(db, {
    grantId,
    wecomUserid,
    actionKind: "approval.approve",
    riskReason: "智能体请求批准审批单",
    summary: "批准审批单 #42",
    snapshot: {
      method: "POST",
      path: "/api/v1/approval/42/approve",
      headers: { authorization: "Bearer hybc_agent_x", "content-type": "application/json" },
      body: '{"comment":"ok"}'
    }
  });

describe("POST /agent/pending/:id/confirm", () => {
  it("403s when the confirming human is not the granting employee", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const jwt = await humanJwt(env, "SomeoneElse");
    const res = await agentRoutes.request(
      `/pending/${parked.id}/confirm`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(403);
    expect((await getPendingById(db, parked.id))?.status).toBe("pending");
  });

  it("403s for an agent token (confirmation is human-only)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const res = await agentRoutes.request(
      `/pending/${parked.id}/confirm`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
  });

  it("confirms, replays through the app, and stores the result", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const jwt = await humanJwt(env, "MaxLiu");

    // 假 app：断言重放请求带了签名头与原 body，然后返回业务成功
    const seen: { url?: string; marker?: string | null; body?: string } = {};
    setAppFetcher(async (req) => {
      seen.url = req.url;
      seen.marker = req.headers.get("x-hybc-agent-replay");
      seen.body = await req.text();
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const res = await agentRoutes.request(
      `/pending/${parked.id}/confirm`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    resetAppFetcher();

    expect(res.status).toBe(200);
    expect(seen.url).toContain("/api/v1/approval/42/approve");
    expect(seen.marker).toBeTruthy();
    expect(seen.body).toBe('{"comment":"ok"}');
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("done");
    expect(JSON.parse(row!.result_snapshot as string)).toMatchObject({ status: 200 });
  });

  it("is idempotent: a second confirm does not replay again", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const jwt = await humanJwt(env, "MaxLiu");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    setAppFetcher(fetcher);

    await agentRoutes.request(`/pending/${parked.id}/confirm`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } }, env);
    await agentRoutes.request(`/pending/${parked.id}/confirm`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } }, env);
    resetAppFetcher();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("marks failed when the replay returns a business error", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const jwt = await humanJwt(env, "MaxLiu");
    setAppFetcher(async () =>
      new Response(JSON.stringify({ success: false, error: { message: "No pending task" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    await agentRoutes.request(`/pending/${parked.id}/confirm`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } }, env);
    resetAppFetcher();
    const row = await getPendingById(db, parked.id);
    expect(row?.status).toBe("failed");
  });
});

describe("POST /agent/pending/:id/reject", () => {
  it("rejects and never replays", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const parked = await park(db, "MaxLiu");
    const jwt = await humanJwt(env, "MaxLiu");
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    setAppFetcher(fetcher);
    const res = await agentRoutes.request(
      `/pending/${parked.id}/reject`,
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    resetAppFetcher();
    expect(res.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await getPendingById(db, parked.id))?.status).toBe("rejected");
  });
});

describe("GET /agent/pending/:id", () => {
  it("lets the owning agent grant read it, without leaking the snapshot", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { token, grant } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const parked = await park(db, "MaxLiu", grant.id);
    const res = await agentRoutes.request(
      `/pending/${parked.id}`,
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("批准审批单 #42");
    expect(text).not.toContain("Bearer hybc_agent_x");
    expect(text).not.toContain("authorization");
  });

  it("404s for a pending action belonging to another grant", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const parked = await park(db, "MaxLiu", "some-other-grant");
    const res = await agentRoutes.request(
      `/pending/${parked.id}`,
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/routes/agent-pending.test.ts`
Expected: FAIL（端点不存在 → 404）。

- [ ] **Step 3: 实现端点**（`packages/api/src/routes/agent.ts`）

顶部 import 补：
```typescript
import { getAppFetcher } from "../services/app-ref";
import {
  claimForExecution,
  confirmPending,
  finishPending,
  getPendingById,
  rejectPending,
  toPublicView
} from "../services/agent-pending";
import { REPLAY_HEADER, sha256Hex, signReplayMarker } from "../services/agent-replay";
import { REPLAY_PENDING_HEADER } from "../middleware/agent-high-risk-gate";
import type { RequestSnapshot } from "../types/agent";
```

在既有 `agentRoutes.use("/device/deny", authMiddleware);` 一组后补鉴权（三个端点都要 JWT/agent 令牌，具体人/机校验在 handler 内）：
```typescript
agentRoutes.use("/pending/*", authMiddleware);
```

在 `/device/deny` 路由之后加：

```typescript
// ── 高危待确认动作 ──

/** GET /pending/:id —— agent 令牌轮询自己的动作，或本人网页查看。绝不回显请求快照。 */
agentRoutes.get("/pending/:id", async (c) => {
  const auth = c.get("auth");
  const row = await getPendingById(c.env.DB, c.req.param("id"));
  if (!row) return c.json(fail("not found"), 404);
  const isOwningAgent =
    auth.auth_method === "mcp_agent" && auth.grant_id === row.grant_id;
  const isOwningHuman = auth.auth_method !== "mcp_agent" && auth.sub === row.wecom_userid;
  if (!isOwningAgent && !isOwningHuman) {
    return c.json(fail("not found"), 404);
  }
  return c.json(ok(toPublicView(row)));
});

/** 确认后由服务端重放原请求执行；确认必须是授权本人的网页会话。 */
agentRoutes.post("/pending/:id/confirm", requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const row = await getPendingById(c.env.DB, id);
  if (!row) return c.json(fail("not found"), 404);
  if (auth.sub !== row.wecom_userid) {
    return c.json(fail("只有发起授权的本人可以确认此操作"), 403);
  }

  if (!(await confirmPending(c.env.DB, id))) {
    // 已确认/已拒绝/已过期 —— 幂等返回当前状态，不重复执行
    const current = await getPendingById(c.env.DB, id);
    return c.json(ok(toPublicView(current!)));
  }

  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "agent.high_risk_confirmed",
    targetType: "agent_pending_action",
    targetId: id,
    detail: { action_kind: row.action_kind, grant_id: row.grant_id }
  });

  if (!(await claimForExecution(c.env.DB, id))) {
    const current = await getPendingById(c.env.DB, id);
    return c.json(ok(toPublicView(current!)));
  }

  const snapshot = JSON.parse(row.request_snapshot) as RequestSnapshot;
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const marker = await signReplayMarker(
    c.env.AGENT_REPLAY_SECRET,
    id,
    await sha256Hex(snapshot.body)
  );
  const replayReq = new Request(`${apiBase}${snapshot.path}`, {
    method: snapshot.method,
    headers: {
      ...snapshot.headers,
      [REPLAY_HEADER]: marker,
      [REPLAY_PENDING_HEADER]: id
    },
    body: snapshot.body
  });

  let result: { status: number; body: unknown };
  try {
    const replayed = await getAppFetcher()(replayReq, c.env, c.executionCtx);
    const text = await replayed.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON 响应原样保留文本 */
    }
    result = { status: replayed.status, body: parsed };
  } catch (err) {
    console.error("agent replay failed", err);
    result = { status: 500, body: { message: err instanceof Error ? err.message : "replay failed" } };
  }

  const succeeded =
    result.status >= 200 &&
    result.status < 300 &&
    (result.body as { success?: boolean })?.success !== false;
  await finishPending(c.env.DB, id, succeeded ? "done" : "failed", result);

  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "agent.high_risk_executed",
    targetType: "agent_pending_action",
    targetId: id,
    status: succeeded ? "success" : "error",
    detail: { action_kind: row.action_kind, grant_id: row.grant_id, http_status: result.status }
  });

  const current = await getPendingById(c.env.DB, id);
  return c.json(ok(toPublicView(current!)));
});

/** 拒绝：只标状态，绝不重放。 */
agentRoutes.post("/pending/:id/reject", requireHumanSession, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const row = await getPendingById(c.env.DB, id);
  if (!row) return c.json(fail("not found"), 404);
  if (auth.sub !== row.wecom_userid) {
    return c.json(fail("只有发起授权的本人可以拒绝此操作"), 403);
  }
  await rejectPending(c.env.DB, id);
  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "agent.high_risk_rejected",
    targetType: "agent_pending_action",
    targetId: id,
    detail: { action_kind: row.action_kind, grant_id: row.grant_id }
  });
  const current = await getPendingById(c.env.DB, id);
  return c.json(ok(toPublicView(current!)));
});
```

> `writeAuditLog` 若尚未在本文件 import，补 `import { writeAuditLog } from "../services/audit-log";`。

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/api && npm test -- src/routes/agent-pending.test.ts`
Expected: PASS（8 passed）。

- [ ] **Step 5: 全量 + typecheck + lint**

Run: `cd packages/api && npm test 2>&1 | grep -E "Test Files|Tests |FAIL" && npm run typecheck && npm run lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/agent.ts packages/api/src/routes/agent-pending.test.ts
git commit -m "feat(api): pending 确认/拒绝/查询端点 + 确认触发全栈重放"
```

---

## Task 10: 端到端本地验证 + 文档

- [ ] **Step 1: 本地端到端冒烟（无需企业微信）**

前置：`cd packages/api && npm run db:migrate:local`（0059 已应用）；另开终端 `npm run dev:api`（8787，`APP_ENV=local` → 高危 flag 默认开）。

```bash
# 1) 造一个 agent 令牌：本地免 code 登录拿 JWT，再 provision
JWT=$(curl -s -X POST http://localhost:8787/api/v1/auth/login/web \
  -H "content-type: application/json" -d '{"username":"manager"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])")

BOOT=$(curl -s -X POST http://localhost:8787/api/v1/agent/setup/provision \
  -H "authorization: Bearer $JWT" -H "content-type: application/json" \
  -d '{"device_name":"p2-smoke","agent_type":"claude_code"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['boot_code'])")

AGENT=$(curl -s -X POST http://localhost:8787/api/v1/agent/setup/redeem \
  -H "content-type: application/json" -d "{\"boot_code\":\"$BOOT\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['agent_token'])")

# 2) agent 发起高危写 → 应 202 awaiting_confirmation
curl -s -X POST "http://localhost:8787/api/v1/approval/1/approve" \
  -H "authorization: Bearer $AGENT" -H "content-type: application/json" \
  -d '{"comment":"agent 请求批准"}'
```
Expected: `{"success":true,"data":{"pending_action_id":"…","status":"awaiting_confirmation",…}}`（HTTP 202）。企微推送会在本地失败并打日志，**不影响 park**。

```bash
# 3) agent 轮询自己的 pending（只读白名单放行 + 归属校验）
PID=<上一步的 pending_action_id>
curl -s "http://localhost:8787/api/v1/agent/pending/$PID" -H "authorization: Bearer $AGENT"
```
Expected: `status: "pending"`，且**响应里不含 `authorization` / `Bearer`**。

```bash
# 4) 本人确认 → 触发重放
curl -s -X POST "http://localhost:8787/api/v1/agent/pending/$PID/confirm" -H "authorization: Bearer $JWT"
```
Expected: 返回 `status: "done"` 或 `"failed"`（取决于审批单 1 是否真的有待办任务——**失败也算闭环打通**，关键是状态从 pending 推进且 `result` 里带回了业务响应）。

```bash
# 5) 幂等：再确认一次，不应重复执行
curl -s -X POST "http://localhost:8787/api/v1/agent/pending/$PID/confirm" -H "authorization: Bearer $JWT"
# 6) 关掉 flag 后 agent 写应 403
npx wrangler kv key put --local --binding=KV "agent:highrisk:config" '{"enabled":false}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:8787/api/v1/approval/1/approve" \
  -H "authorization: Bearer $AGENT" -H "content-type: application/json" -d '{}'
```
Expected: 步骤 5 返回同一终态（未二次执行）；步骤 6 返回 `403`。

> `wrangler kv key put --local` 的确切子命令随 wrangler 版本略有差异；若不可用，改为在 `.dev.vars` 侧或直接跳过步骤 6（该分支已有单测覆盖），并在报告中注明。

- [ ] **Step 2: 更新文档**

`doc/开发记录.md` **末尾追加**（本文件只增不改）：

```markdown
## 2026-07-17 MCP 智能体接入 P2a（高危写延迟执行引擎）

- 新增 `agent_pending_action` 表（迁移 0059）：暂存 agent 发起的高危写请求快照、摘要、一次性 confirm_token hash、状态机。
- 高危匹配表 `services/agent-high-risk.ts`：首批仅 `POST /approval/:id/approve|reject`；配 KV feature flag `agent:highrisk:config`（缺省仅本地开，生产默认关）。
- authMiddleware 的 mcp_agent 收敛点由「只读白名单二选一」扩为三路裁决：只读放行 / 高危 park（202 awaiting_confirmation + 推企微卡片）/ 带有效 HMAC 重放标记放行 / 其余 403。
- 确认后**服务端全栈重放**：`services/app-ref.ts` 注册表打破循环依赖，用原请求快照重建 Request + `x-hybc-agent-replay` HMAC 标记，经完整中间件栈跑 `approveOp`，保证 agent 的写与人工审批同一代码路径；重放时令牌仍会校验（吊销即 401 不执行）。
- 状态机全部用条件 UPDATE + rows-affected 乐观锁（生产 D1 无事务回滚）：确认/拒绝/抢占执行各自至多一次，重复确认幂等不重复执行。
- `GET /agent/pending/:id` 加入只读白名单并做归属校验；对外投影绝不回显 request_snapshot（内含 Authorization）与 token hash。
- 三段审计：`agent.high_risk_parked` / `_confirmed` / `_executed`（或 `_rejected`）。
- 验证：api 全量测试 + typecheck + lint 全绿；本地端到端冒烟（park→202→轮询→确认→重放→终态、幂等、flag 关闭 403）通过。
- confirm.vue 确认页与 MCP 写工具见 P2b；设计见 `docs/superpowers/specs/2026-07-17-mcp-agent-p2-design.md`。
```

- [ ] **Step 3: 最终校验 + Commit**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全绿。
```bash
git add doc/开发记录.md
git commit -m "docs: 记录 P2a 高危写延迟执行引擎"
```

---

## Self-Review 记录（对照 spec）

- **spec §4 数据模型** → Task 1（迁移 0059 + 类型 + env）✅
- **spec §5.1 两道闸门共处 / 四类出口** → Task 8（`decideAgentRequest` 四分支 + 白名单加 pending 读）✅
- **spec §5.2 重放引擎与不可伪造标记**（含 body 消费陷阱）→ Task 4（HMAC）+ Task 8（`c.req.raw.clone()` 读 body）+ Task 9（重建请求带标记）✅
- **spec §5.3 状态机与幂等** → Task 5（条件 UPDATE 乐观锁）+ Task 2（fake 支持 rows-affected，否则无法测）✅
- **spec §5.4 确认端点** → Task 9（confirm/reject/get + 身份匹配 + 归属校验）✅
- **spec §5.5 企微卡片** → Task 6（hash 确认页链接、推送失败不影响 park）✅
- **spec §2 feature flag** → Task 3（`isHighRiskEnabled`，缺省保守）✅
- **spec §9 测试策略** → 各 Task 的 TDD + Task 10 端到端冒烟；重放标记不可伪造、幂等、归属校验、flag 开关均有用例 ✅
- **spec §10 安全**：token 只存 hash（Task 5）、标记服务端派生+常数时间比较（Task 4）、投影不回显敏感字段（Task 5 + Task 9 测试断言）、三段审计（Task 8/9）✅
- **spec §6/§7 前端与 MCP 工具** → **不在本计划**（P2b），已在文件结构与目标里显式声明 ✅
- **spec §11 上线与回滚** → Task 10 冒烟 + flag 回滚口径；远程迁移与放量属部署动作，留合并时执行 ✅

**类型一致性**：`RequestSnapshot`/`AgentPendingRow`/`PendingPublicView`/`PendingStatus`（Task 1）在 Task 5、8、9 中用法一致；`HighRiskRule`（Task 3）被 Task 8 的 `decideAgentRequest` 与 Task 8 的 `parkAndRespond` 共用；`signReplayMarker/verifyReplayMarker/sha256Hex/REPLAY_HEADER`（Task 4）在 Task 8、9 中签名一致；`AppFetcher`（Task 7）与 Task 9 调用形一致。

**占位符扫描**：无 TBD/TODO；每个改代码的步骤均给出完整代码；两处显式"按实际调整并在报告中说明"（Env 字段名、wrangler kv 子命令）属真实环境差异的诚实提示，不是占位。

## 开放问题 / 待评审确认

1. `AGENT_REPLAY_SECRET` 生产值建议用 `wrangler secret put` 而非 `[vars]` 明文——合并部署时由 owner 决定并设置。
2. 摘要目前只含"批准/拒绝审批单 #id"。是否要在 park 时查一次审批单标题/金额，让卡片更具信息量？（会多一次 D1 查询；建议 P2b 做，届时确认页也能展示完整详情）
3. 过期回收：当前惰性判定，不物理清理过期行。量小可接受；后续可加定时归档。
