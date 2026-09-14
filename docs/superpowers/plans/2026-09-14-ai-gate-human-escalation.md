# AI 关卡拦截转人工兜底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 关卡判定拦截时不再自动退回发起人，而是在关卡节点上给系统级配置的兜底审核人建一条正式审批任务，由他放行 / 退回发起人 / 驳回。

**Architecture:** 拦截落地收口在 `ai-gate-apply.ts` 的 `settleAiGateBlock`（有审核人 → 转人工；无审核人 → 旧的 returned 路径）。`AiGateExecutor` 学会识别节点上的人工任务（pending 未完成、approve 通过），退回与驳回复用通用操作。审核人 userid 存在新的通用键值表 `system_config`，由超管接口读写；角色解析从 `routes/auth.ts` 抽到 `services/wecom-api.ts` + `services/wecom-role.ts`。通知走新事件 `APPROVAL_AI_ESCALATED`。

**Tech Stack:** Hono on Cloudflare Workers、D1（无事务，写入顺序 + 幂等守卫）、vitest（假 D1 捕获 SQL）、Vue 3 + Element Plus、微信小程序原生。

**规格：** `docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md`

**仓库约定（执行前必读）：**
- 包管理用 pnpm；API 测试 `cd packages/api && npx vitest run <file>`；typecheck `npx tsc --noEmit`；lint `npx eslint <files>`。
- Web 测试 `cd packages/web && npx vitest run <file>`；typecheck `npm run typecheck`（tsc + vue-tsc，约 2 分钟）；lint `npx eslint <file>`。
- 小程序测试是 node 脚本：`cd packages/miniapp && node utils/enum-labels.test.js`。
- 不加 Co-Authored-By 等 AI 署名 trailer。提交类型用 feat/fix/refactor/docs/test。
- 不要 push；push main 即部署，由 owner 决定。
- `packages/api/src/routes/payment.ts` 本就不满足 prettier，不要对它整文件格式化（本计划不改它）。

---

## 文件结构

**新增**
- `packages/api/migrations/0088_system_config.sql` — 通用键值表。
- `packages/api/src/services/system-config.ts` — system_config 读写。
- `packages/api/src/services/system-config.test.ts`
- `packages/api/src/services/wecom-api.ts` — 从 routes/auth.ts 搬出的企微 HTTP/令牌/缓存底层。
- `packages/api/src/services/wecom-role.ts` — 从 routes/auth.ts 搬出的标签→角色解析；新增 `resolveSystemRoleForUser`。
- `packages/api/src/services/wecom-role.test.ts`
- `packages/api/src/services/approval/ai-gate-fallback.ts` — 兜底审核人读取 + 节点是否已有 pending 人工任务。
- `packages/api/src/services/approval/ai-gate-fallback.test.ts`
- `packages/api/src/services/approval/ai-gate-executor.test.ts` — AiGateExecutor 人工任务判定。
- `packages/api/src/queue-handler-ai-escalated.test.ts` — 转人工事件的两路推卡。
- `packages/api/src/routes/admin-ai-gate-settings.test.ts` — 设置接口。
- `packages/web/src/views/admin/ai-gate-settings.ts` + `.test.ts` — 设置卡的纯逻辑（过滤超管、提示文案）。
- `packages/web/src/views/approval/human-review.ts` + `.test.ts` — 时间线「人工复核」判定与文案。

**修改**
- `packages/api/src/services/event-bus.ts` — 事件类型 `APPROVAL_AI_ESCALATED`。
- `packages/api/src/services/wecom-approval-push.ts` — 导出 `ApprovalResultType`，加 `escalated`。
- `packages/api/src/services/approval/ai-gate-apply.ts` — `settleAiGateBlock`。
- `packages/api/src/services/approval/ai-gate-apply.test.ts` — 假件扩展 + 新分支用例。
- `packages/api/src/services/approval/executors.ts` — AiGateExecutor.processAction / isNodeComplete。
- `packages/api/src/queue-handler.ts` — 引用导出的结果类型；新增 `handleApprovalAiEscalated` 与 switch 分支。
- `packages/api/src/routes/auth.ts` — 改为引用 wecom-api / wecom-role。
- `packages/api/src/routes/admin.ts` — settings GET/PUT；handle 路由取消悬空人工任务。
- `packages/api/src/routes/admin-ai-gate-handle-state-guard.test.ts` — 新增取消悬空任务断言。
- `packages/web/src/api/admin.ts` — settings 接口封装。
- `packages/web/src/views/admin/ai-gate-tasks.vue` — 设置卡。
- `packages/web/src/views/approval/detail.vue` — 时间线标签。
- `packages/miniapp/utils/enum-labels.js` + `enum-labels.test.js` — `aiGateHumanReviewActionLabel`。
- `packages/miniapp/pages/approval-detail/index.js` — 时间线文案。
- `doc/开发记录.md`、`doc/UI设计文档.md`。

---

### Task 1: 迁移 0088 + system-config 服务

**Files:**
- Create: `packages/api/migrations/0088_system_config.sql`
- Create: `packages/api/src/services/system-config.ts`
- Test: `packages/api/src/services/system-config.test.ts`

- [ ] **Step 1: 写迁移**

```sql
-- 0088_system_config.sql
-- 通用系统级键值配置。首个使用方：AI 关卡兜底审核人（approval.ai_gate.fallback_reviewer_userid）。
-- 背景：2026-09-13 SP-20260913-0007 被 AI 退回后没有人工兜底出口，见
-- docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md。

CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/api/src/services/system-config.test.ts
import { describe, expect, it } from "vitest";

import { getSystemConfig, getSystemConfigEntry, setSystemConfig } from "./system-config";
import type { Env } from "../types/env";

type Row = { config_value: string; updated_by: string | null; updated_at: string };

const createFakeEnv = (rows: Map<string, Row>) => {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+system_config/i.test(sql)) {
                const row = rows.get(String(args[0]));
                return (row ? { ...row } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async run() {
              runs.push({ sql, args });
              if (/INSERT\s+INTO\s+system_config/i.test(sql)) {
                rows.set(String(args[0]), {
                  config_value: String(args[1]),
                  updated_by: (args[2] as string | null) ?? null,
                  updated_at: String(args[4])
                });
              }
              return { success: true, meta: {} };
            },
            async all<T>() {
              return { results: [] as T[] };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, runs, rows };
};

describe("system-config", () => {
  it("未配置返回 null", async () => {
    const { env } = createFakeEnv(new Map());
    expect(await getSystemConfig(env, "approval.ai_gate.fallback_reviewer_userid")).toBeNull();
    expect(await getSystemConfigEntry(env, "approval.ai_gate.fallback_reviewer_userid")).toBeNull();
  });

  it("空白值视为未配置", async () => {
    const rows = new Map<string, Row>([
      ["k", { config_value: "   ", updated_by: "boss", updated_at: "2026-09-14T00:00:00.000Z" }]
    ]);
    const { env } = createFakeEnv(rows);
    expect(await getSystemConfig(env, "k")).toBeNull();
  });

  it("setSystemConfig 走 upsert，回读得到 trim 后的值与更新人", async () => {
    const { env, runs, rows } = createFakeEnv(new Map());
    await setSystemConfig(env, "k", "  UserA ", "boss");
    expect(runs[0].sql).toMatch(/INSERT\s+INTO\s+system_config/i);
    expect(runs[0].sql).toMatch(/ON\s+CONFLICT\s*\(\s*config_key\s*\)\s+DO\s+UPDATE/i);
    expect(rows.get("k")?.config_value).toBe("UserA");
    expect(await getSystemConfig(env, "k")).toBe("UserA");
    const entry = await getSystemConfigEntry(env, "k");
    expect(entry?.updated_by).toBe("boss");
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/system-config.test.ts`
Expected: FAIL，提示找不到模块 `./system-config`。

- [ ] **Step 4: 实现**

```ts
// packages/api/src/services/system-config.ts
/**
 * 通用系统级键值配置（表 system_config，迁移 0088）。
 * 直连 D1、不做 KV 缓存：现有使用方（AI 关卡兜底审核人）只在 AI 拦截时读一次。
 */
import type { Env } from "../types/env";

const nowIso = () => new Date().toISOString();

export type SystemConfigEntry = {
  value: string;
  updated_by: string | null;
  updated_at: string;
};

/** 读取一项配置；不存在或值为空白时返回 null。 */
export const getSystemConfigEntry = async (
  env: Env,
  key: string
): Promise<SystemConfigEntry | null> => {
  const row = await env.DB.prepare(
    "SELECT config_value, updated_by, updated_at FROM system_config WHERE config_key = ?"
  )
    .bind(key)
    .first<{ config_value: string; updated_by: string | null; updated_at: string }>();
  if (!row) return null;
  const value = String(row.config_value ?? "").trim();
  if (!value) return null;
  return { value, updated_by: row.updated_by ?? null, updated_at: row.updated_at };
};

export const getSystemConfig = async (env: Env, key: string): Promise<string | null> => {
  const entry = await getSystemConfigEntry(env, key);
  return entry ? entry.value : null;
};

/** upsert；value 先 trim，空串也允许写入（表示清除）。 */
export const setSystemConfig = async (
  env: Env,
  key: string,
  value: string,
  updatedBy: string | null
): Promise<void> => {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO system_config (config_key, config_value, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(config_key) DO UPDATE SET
       config_value = excluded.config_value,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  )
    .bind(key, value.trim(), updatedBy, now, now)
    .run();
};
```

- [ ] **Step 5: 运行确认通过**

Run: `cd packages/api && npx vitest run src/services/system-config.test.ts`
Expected: 3 passed。

- [ ] **Step 6: 本地应用迁移并提交**

Run: `cd packages/api && npm run db:migrate:local`
Expected: 输出含 `0088_system_config.sql` 已应用。

```bash
git add packages/api/migrations/0088_system_config.sql packages/api/src/services/system-config.ts packages/api/src/services/system-config.test.ts
git commit -m "feat(api): 新增 system_config 通用键值表与读写服务"
```

---

### Task 2: 企微底层与角色解析抽到 service

**Files:**
- Create: `packages/api/src/services/wecom-api.ts`
- Create: `packages/api/src/services/wecom-role.ts`
- Test: `packages/api/src/services/wecom-role.test.ts`
- Modify: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/api/src/services/wecom-role.test.ts
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";

const apiMock = vi.hoisted(() => ({
  fetchWeComAccessToken: vi.fn(async () => "token-1"),
  fetchWeComJson: vi.fn(async (_env: unknown, url: string) => {
    if (url.includes("/tag/list")) {
      return {
        errcode: 0,
        taglist: [
          { tagid: 11, tagname: "HY_ROLE_SUPER_ADMIN" },
          { tagid: 12, tagname: "HY_ROLE_MANAGER" }
        ]
      };
    }
    if (url.includes("tagid=11")) return { errcode: 0, userlist: [{ userid: "Boss" }] };
    if (url.includes("tagid=12")) return { errcode: 0, userlist: [{ userid: "Mgr" }] };
    return { errcode: 0, userlist: [] };
  })
}));

vi.mock("./wecom-api", () => ({
  fetchWeComAccessToken: apiMock.fetchWeComAccessToken,
  fetchWeComJson: apiMock.fetchWeComJson,
  weComErrorMessage: (errmsg: string | undefined, fallback: string) =>
    !errmsg || errmsg === "ok" ? fallback : errmsg
}));

import { parseRoleTagMapping, resolveSystemRoleForUser } from "./wecom-role";

const env = { WECHAT_ROLE_TAG_MAPPING: undefined } as unknown as Env;

describe("parseRoleTagMapping", () => {
  it("空配置回落默认标签名", () => {
    expect(parseRoleTagMapping(undefined).super_admin).toEqual(["HY_ROLE_SUPER_ADMIN"]);
  });

  it("按 role:tag|tag;role:tag 解析并忽略未知角色", () => {
    const mapping = parseRoleTagMapping("super_admin:BOSS|OWNER;unknown:X;manager:M1");
    expect(mapping.super_admin).toEqual(["BOSS", "OWNER"]);
    expect(mapping.manager).toEqual(["M1"]);
    expect(mapping.finance).toEqual(["HY_ROLE_FINANCE"]);
  });
});

describe("resolveSystemRoleForUser", () => {
  it("命中超管标签返回 super_admin", async () => {
    expect(await resolveSystemRoleForUser(env, "Boss")).toBe("super_admin");
  });

  it("按优先级返回首个命中的角色", async () => {
    expect(await resolveSystemRoleForUser(env, "Mgr")).toBe("manager");
  });

  it("任何标签都不命中返回 null", async () => {
    expect(await resolveSystemRoleForUser(env, "Nobody")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/wecom-role.test.ts`
Expected: FAIL，找不到模块 `./wecom-role`。

- [ ] **Step 3: 新建 `services/wecom-api.ts`（内容从 routes/auth.ts 原样搬出）**

从 `packages/api/src/routes/auth.ts` 剪切以下定义到新文件，并全部加 `export`：
`WeComTokenResponse`、`weComErrorMessage`、`normalizeBridgeProxyUrl`、`fetchViaBridge`、`fetchDirectWeComJson`、`fetchWeComJson`、`ACCESS_TOKEN_KV_KEY`、`TOKEN_DEFAULT_TTL_SECONDS`、`getCachedString`、`putCachedString`、`fetchWeComAccessToken`。

新文件内容（与 auth.ts 现有实现逐字一致，只加 export 与文件头注释）：

```ts
// packages/api/src/services/wecom-api.ts
/**
 * 企业微信 HTTP 底层：桥接代理/直连、access_token 缓存。
 * 从 routes/auth.ts 抽出，供登录路由与 wecom-role.ts（角色解析）共用。
 * 注意 wecom-contact-book.ts 仍保留一份 bridge-strict 的令牌获取，本次不合并。
 */
import type { Env } from "../types/env";

export type WeComTokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

export const weComErrorMessage = (errmsg: string | undefined, fallback: string): string => {
  if (!errmsg || errmsg === "ok") return fallback;
  return errmsg;
};

const normalizeBridgeProxyUrl = (env: Env): string | null => {
  const explicit = env.WECHAT_BRIDGE_PROXY_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const base = env.WECHAT_BRIDGE_BASE_URL?.trim();
  if (!base) return null;
  const normalized = base.replace(/\/$/, "");
  if (normalized.endsWith("/wecom/proxy")) return normalized;
  return `${normalized}/wecom/proxy`;
};

const fetchViaBridge = async <T>(
  proxyUrl: string,
  targetUrl: string,
  headers: Record<string, string>
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const requestUrl = `${proxyUrl}${proxyUrl.includes("?") ? "&" : "?"}bridge=1`;
  const resp = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: targetUrl }),
    redirect: "manual",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location") ?? "";
    throw new Error(`bridge redirected ${resp.status}${location ? ` to ${location}` : ""}`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`bridge response ${resp.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
};

const fetchDirectWeComJson = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const resp = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new Error(`wecom response ${resp.status}: ${bodyText.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
};

export const fetchWeComJson = async <T>(env: Env, url: string): Promise<T> => {
  const proxyUrl = normalizeBridgeProxyUrl(env);
  if (proxyUrl) {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (env.WECHAT_BRIDGE_TOKEN) {
      headers["x-bridge-token"] = env.WECHAT_BRIDGE_TOKEN;
    }
    try {
      return await fetchViaBridge<T>(proxyUrl, url, headers);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "bridge fetch failed";
      if (reason.includes("redirect") || reason.includes("abort") || reason.includes("Too many redirects")) {
        return fetchDirectWeComJson<T>(url);
      }
      throw error;
    }
  }

  return fetchDirectWeComJson<T>(url);
};

export const ACCESS_TOKEN_KV_KEY = "wecom:access-token:v1";
export const TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;

export const getCachedString = async (env: Env, key: string): Promise<string | null> => {
  return env.KV.get(key);
};

export const putCachedString = async (
  env: Env,
  key: string,
  value: string,
  expiresInSeconds?: number
) => {
  const ttl = Math.max(60, (expiresInSeconds ?? TOKEN_DEFAULT_TTL_SECONDS) - 300);
  await env.KV.put(key, value, { expirationTtl: ttl });
};

export const fetchWeComAccessToken = async (env: Env): Promise<string> => {
  const cached = await getCachedString(env, ACCESS_TOKEN_KV_KEY);
  if (cached) return cached;

  if (!env.WECHAT_CORPID || !env.WECHAT_SECRET) {
    throw new Error("WECHAT_CORPID/WECHAT_SECRET is not configured");
  }

  const tokenJson = await fetchWeComJson<WeComTokenResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(env.WECHAT_CORPID)}&corpsecret=${encodeURIComponent(env.WECHAT_SECRET)}`
  );
  if (tokenJson.errcode !== 0 || !tokenJson.access_token) {
    throw new Error(
      weComErrorMessage(tokenJson.errmsg, "Failed to get WeCom access_token")
    );
  }

  await putCachedString(
    env,
    ACCESS_TOKEN_KV_KEY,
    tokenJson.access_token,
    tokenJson.expires_in
  );

  return tokenJson.access_token;
};
```

搬出前先核对 auth.ts 里 `putCachedString` 的原实现（第 256 行起）与上面一致；若 auth.ts 的版本是多行写法，以 auth.ts 为准逐字复制，只保证语义相同。

- [ ] **Step 4: 新建 `services/wecom-role.ts`**

从 auth.ts 剪切：`WeComTagListResponse`、`WeComTagGetResponse`、`defaultRoleTagMapping`、`rolePriority`、`parseRoleTagMapping`、`fetchWeComTags`、`isUserInTag`、`listUsersInTag`、`resolveRoleByWeComTags`，并新增 `resolveSystemRoleForUser`：

```ts
// packages/api/src/services/wecom-role.ts
/**
 * 企微标签 → 系统角色解析。从 routes/auth.ts 抽出，登录、通讯录权限标注、
 * AI 关卡兜底审核人校验（routes/admin.ts）共用。
 */
import type { Env } from "../types/env";
import type { UserRole } from "../types/auth";
import { fetchWeComAccessToken, fetchWeComJson, weComErrorMessage } from "./wecom-api";

type WeComTagListResponse = {
  errcode?: number;
  errmsg?: string;
  taglist?: Array<{ tagid: number; tagname: string }>;
};

type WeComTagGetResponse = {
  errcode?: number;
  errmsg?: string;
  userlist?: Array<{ userid?: string }>;
};

export const defaultRoleTagMapping: Record<UserRole, string[]> = {
  super_admin: ["HY_ROLE_SUPER_ADMIN"],
  finance: ["HY_ROLE_FINANCE"],
  manager: ["HY_ROLE_MANAGER"],
  site_manager: ["HY_ROLE_SITE_MANAGER"],
  operator: ["HY_ROLE_OPERATOR"]
};

export const rolePriority: UserRole[] = [
  "super_admin",
  "finance",
  "manager",
  "site_manager",
  "operator"
];

export const parseRoleTagMapping = (raw: string | undefined): Record<UserRole, string[]> => {
  if (!raw?.trim()) return defaultRoleTagMapping;

  const parsed: Record<UserRole, string[]> = {
    super_admin: [],
    finance: [],
    manager: [],
    site_manager: [],
    operator: []
  };

  raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [roleRaw, tagsRaw] = item.split(":");
      const role = (roleRaw || "").trim() as UserRole;
      if (!rolePriority.includes(role)) return;
      const tags = (tagsRaw || "")
        .split("|")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length > 0) {
        parsed[role] = tags;
      }
    });

  return {
    super_admin:
      parsed.super_admin.length > 0 ? parsed.super_admin : defaultRoleTagMapping.super_admin,
    finance: parsed.finance.length > 0 ? parsed.finance : defaultRoleTagMapping.finance,
    manager: parsed.manager.length > 0 ? parsed.manager : defaultRoleTagMapping.manager,
    site_manager:
      parsed.site_manager.length > 0 ? parsed.site_manager : defaultRoleTagMapping.site_manager,
    operator: parsed.operator.length > 0 ? parsed.operator : defaultRoleTagMapping.operator
  };
};

export const fetchWeComTags = async (
  env: Env,
  accessToken: string
): Promise<Array<{ tagid: number; tagname: string }>> => {
  const json = await fetchWeComJson<WeComTagListResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/list?access_token=${encodeURIComponent(accessToken)}`
  );
  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, "Failed to fetch WeCom tags"));
  }
  return json.taglist ?? [];
};

export const isUserInTag = async (
  env: Env,
  accessToken: string,
  tagId: number,
  userId: string
): Promise<boolean> => {
  const json = await fetchWeComJson<WeComTagGetResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/get?access_token=${encodeURIComponent(accessToken)}&tagid=${tagId}`
  );
  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, `Failed to get members by WeCom tag ${tagId}`)
    );
  }
  return (json.userlist ?? []).some((user) => user.userid === userId);
};

export const listUsersInTag = async (
  env: Env,
  accessToken: string,
  tagId: number
): Promise<Set<string>> => {
  const json = await fetchWeComJson<WeComTagGetResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/get?access_token=${encodeURIComponent(accessToken)}&tagid=${tagId}`
  );
  if (json.errcode !== 0) {
    throw new Error(
      weComErrorMessage(json.errmsg, `Failed to get members by WeCom tag ${tagId}`)
    );
  }
  const members = new Set<string>();
  (json.userlist ?? []).forEach((item) => {
    if (item.userid) members.add(item.userid);
  });
  return members;
};

/** 登录路径原有实现：按 rolePriority 顺序逐标签查成员，首个命中即返回。 */
export const resolveRoleByWeComTags = async (
  env: Env,
  accessToken: string,
  userId: string
): Promise<UserRole | undefined> => {
  const mapping = parseRoleTagMapping(env.WECHAT_ROLE_TAG_MAPPING);
  const tagList = await fetchWeComTags(env, accessToken);
  const tagIdByName = new Map<string, number>();
  tagList.forEach((item) => {
    tagIdByName.set(item.tagname, item.tagid);
  });

  for (const role of rolePriority) {
    const tagNames = mapping[role] || [];
    for (const tagName of tagNames) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) continue;
      const matched = await isUserInTag(env, accessToken, tagId, userId);
      if (matched) {
        return role;
      }
    }
  }

  return undefined;
};

/**
 * 供非登录场景（如超管配置校验）使用：自取 access_token，只按标签解析，
 * 不做 username 回退；不命中任何标签返回 null。
 */
export const resolveSystemRoleForUser = async (
  env: Env,
  userId: string
): Promise<UserRole | null> => {
  const accessToken = await fetchWeComAccessToken(env);
  const role = await resolveRoleByWeComTags(env, accessToken, userId);
  return role ?? null;
};
```

- [ ] **Step 5: 改 `routes/auth.ts`**

1. 删除已搬出的全部定义（Step 3 与 Step 4 列出的名字）。保留 `isInvalidWeComCodeError`、`CORP_JSAPI_TICKET_KV_KEY`、`AGENT_JSAPI_TICKET_KV_KEY`、`randomNonce`、`buildSignSource`、`sha1Hex`、`WeComTicketResponse`、`WeComContactUserWithPermission`、`enrichPermissionStatusByWeComTags` 等其余内容。
2. 在文件顶部 import 区追加：

```ts
import {
  fetchWeComAccessToken,
  fetchWeComJson,
  getCachedString,
  putCachedString,
  weComErrorMessage
} from "../services/wecom-api";
import {
  fetchWeComTags,
  listUsersInTag,
  parseRoleTagMapping,
  resolveRoleByWeComTags,
  rolePriority
} from "../services/wecom-role";
```

3. 若删除后仍有未使用的 import 或残留引用，以 `npx tsc --noEmit` 与 `npx eslint src/routes/auth.ts` 的报错为准逐个清理；不改任何行为。

- [ ] **Step 6: 运行确认通过 + 全量回归**

Run: `cd packages/api && npx vitest run src/services/wecom-role.test.ts`
Expected: 5 passed。

Run: `cd packages/api && npx tsc --noEmit && npx eslint src/routes/auth.ts src/services/wecom-api.ts src/services/wecom-role.ts && npx vitest run`
Expected: tsc 无输出；eslint 无报错；vitest 全部通过（基线 972 + 本计划新增）。

- [ ] **Step 7: 提交**

```bash
git add packages/api/src/services/wecom-api.ts packages/api/src/services/wecom-role.ts packages/api/src/services/wecom-role.test.ts packages/api/src/routes/auth.ts
git commit -m "refactor(api): 企微 HTTP 底层与标签角色解析抽到 services，新增 resolveSystemRoleForUser"
```

---

### Task 3: 兜底审核人读取服务

**Files:**
- Create: `packages/api/src/services/approval/ai-gate-fallback.ts`
- Test: `packages/api/src/services/approval/ai-gate-fallback.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/api/src/services/approval/ai-gate-fallback.test.ts
import { describe, expect, it } from "vitest";

import {
  AI_GATE_FALLBACK_REVIEWER_KEY,
  hasPendingHumanTaskOnNode,
  resolveAiGateFallbackReviewer
} from "./ai-gate-fallback";
import type { Env } from "../../types/env";

const createFakeEnv = (options: { configValue?: string | null; pendingHumanTaskId?: number | null }) => {
  const captured: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          captured.push({ sql, args });
          return {
            async first<T>() {
              if (/FROM\s+system_config/i.test(sql)) {
                return (options.configValue == null
                  ? null
                  : { config_value: options.configValue, updated_by: null, updated_at: "" }) as unknown as T;
              }
              if (/FROM\s+approval_task/i.test(sql)) {
                return (options.pendingHumanTaskId ? { id: options.pendingHumanTaskId } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async run() {
              return { success: true, meta: {} };
            },
            async all<T>() {
              return { results: [] as T[] };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, captured };
};

describe("resolveAiGateFallbackReviewer", () => {
  it("键名固定", () => {
    expect(AI_GATE_FALLBACK_REVIEWER_KEY).toBe("approval.ai_gate.fallback_reviewer_userid");
  });

  it("未配置返回 null", async () => {
    const { env } = createFakeEnv({ configValue: null });
    expect(await resolveAiGateFallbackReviewer(env)).toBeNull();
  });

  it("返回 trim 后的 userid", async () => {
    const { env } = createFakeEnv({ configValue: " Boss " });
    expect(await resolveAiGateFallbackReviewer(env)).toBe("Boss");
  });
});

describe("hasPendingHumanTaskOnNode", () => {
  it("查询排除 AI_GATE 且只看 pending，命中返回 true", async () => {
    const { env, captured } = createFakeEnv({ pendingHumanTaskId: 9 });
    expect(await hasPendingHumanTaskOnNode(env, 1931)).toBe(true);
    const query = captured.find((c) => /FROM\s+approval_task/i.test(c.sql));
    expect(query?.sql).toMatch(/assignee_userid\s*<>\s*'AI_GATE'/);
    expect(query?.sql).toMatch(/status\s*=\s*'pending'/);
    expect(query?.args[0]).toBe(1931);
  });

  it("无命中返回 false", async () => {
    const { env } = createFakeEnv({ pendingHumanTaskId: null });
    expect(await hasPendingHumanTaskOnNode(env, 1931)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/approval/ai-gate-fallback.test.ts`
Expected: FAIL，找不到模块 `./ai-gate-fallback`。

- [ ] **Step 3: 实现**

```ts
// packages/api/src/services/approval/ai-gate-fallback.ts
/**
 * AI 关卡兜底审核人：系统级配置一位超管，AI 判定拦截时把单子转给他人工裁决。
 * 设计：docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md
 */
import type { Env } from "../../types/env";
import { getSystemConfig } from "../system-config";

export const AI_GATE_FALLBACK_REVIEWER_KEY = "approval.ai_gate.fallback_reviewer_userid";

/** 未配置或空白 → null，调用方据此退化为旧的自动退回。 */
export const resolveAiGateFallbackReviewer = async (env: Env): Promise<string | null> => {
  const value = await getSystemConfig(env, AI_GATE_FALLBACK_REVIEWER_KEY);
  return value ? value.trim() || null : null;
};

/**
 * 节点上是否已有 pending 的人工任务（受理人不是 AI_GATE）。
 * 队列重试时据此整段跳过，避免重复建任务、重复推卡。
 */
export const hasPendingHumanTaskOnNode = async (
  env: Env,
  nodeInstanceId: number
): Promise<boolean> => {
  const row = await env.DB.prepare(
    `SELECT id
       FROM approval_task
      WHERE node_instance_id = ?
        AND assignee_userid <> 'AI_GATE'
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1`
  )
    .bind(nodeInstanceId)
    .first<{ id: number }>();
  return Boolean(row);
};
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run src/services/approval/ai-gate-fallback.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/approval/ai-gate-fallback.ts packages/api/src/services/approval/ai-gate-fallback.test.ts
git commit -m "feat(api): AI 关卡兜底审核人读取与节点人工任务探测"
```

---

### Task 4: 事件类型与结果卡类型

**Files:**
- Modify: `packages/api/src/services/event-bus.ts:5-48`
- Modify: `packages/api/src/services/wecom-approval-push.ts:43,234-240`
- Modify: `packages/api/src/queue-handler.ts:8-18`

- [ ] **Step 1: 事件类型**

在 `event-bus.ts` 的 `domainEventTypes` 数组中，`"APPROVAL_TIMEOUT",` 之后插入一行：

```ts
  "APPROVAL_AI_ESCALATED",
```

- [ ] **Step 2: 结果卡类型导出并加 escalated**

`wecom-approval-push.ts` 第 43 行改为：

```ts
export type ApprovalResultType =
  | "returned"
  | "approved"
  | "rejected"
  | "cancelled"
  | "withdrawn"
  | "escalated";
```

`APPROVAL_RESULT_LABELS` 改为：

```ts
const APPROVAL_RESULT_LABELS: Record<ApprovalResultType, string> = {
  returned: "已退回",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已取消",
  withdrawn: "已撤回",
  escalated: "转人工复核"
};
```

- [ ] **Step 3: queue-handler 改引用**

`queue-handler.ts`：删除第 18 行 `type ApprovalResultType = ...`；把第 8 至 13 行的 import 改为：

```ts
import {
  resolveApplicantDisplayName,
  resolveApprovalPushMeta,
  sendApprovalResultTemplateCard,
  sendApprovalTodoTemplateCard,
  type ApprovalResultType
} from "./services/wecom-approval-push";
```

- [ ] **Step 4: 验证并提交**

Run: `cd packages/api && npx tsc --noEmit && npx vitest run src/services`
Expected: tsc 无输出；services 下测试全部通过。

```bash
git add packages/api/src/services/event-bus.ts packages/api/src/services/wecom-approval-push.ts packages/api/src/queue-handler.ts
git commit -m "feat(api): 新增 APPROVAL_AI_ESCALATED 事件与 escalated 结果卡类型"
```

---

### Task 5: 拦截落地收口 `settleAiGateBlock`

**Files:**
- Modify: `packages/api/src/services/approval/ai-gate-apply.ts`
- Modify: `packages/api/src/services/approval/ai-gate-apply.test.ts`

- [ ] **Step 1: 扩展测试假件并写失败用例**

在 `ai-gate-apply.test.ts` 中：

(a) `InsertedTask` 后新增类型，`FakeState` 增加字段：

```ts
interface InsertedHumanTask {
  node_instance_id: number;
  instance_id: number;
  assignee_userid: string;
  round: number;
}

interface FakeState {
  node: FakeNode;
  instance: FakeInstance;
  decisionTask: { action: string } | null;
  insertedTasks: InsertedTask[];
  insertedHumanTasks: InsertedHumanTask[];
  pendingHumanTaskId: number | null;
  systemConfig: Record<string, string>;
  eventLogTypes: string[];
  bizDraftTables: string[];
  events: Array<{ type: string; payload: Record<string, unknown> }>;
}
```

(b) `run()` 里 `INSERT INTO approval_task` 分支改为先区分人工任务（列表里没有 action 列）：

```ts
              if (/INSERT\s+INTO\s+approval_task/i.test(sql)) {
                if (/\(node_instance_id,\s*instance_id,\s*assignee_userid,\s*round,\s*status/i.test(sql)) {
                  state.insertedHumanTasks.push({
                    node_instance_id: args[0] as number,
                    instance_id: args[1] as number,
                    assignee_userid: args[2] as string,
                    round: args[3] as number
                  });
                  return { success: true, meta: {} };
                }
                state.insertedTasks.push({
                  node_instance_id: args[0] as number,
                  instance_id: args[1] as number,
                  assignee_userid: args[2] as string,
                  action: args[3] as string,
                  comment: args[4] as string
                });
                return { success: true, meta: {} };
              }
              if (/INSERT\s+INTO\s+event_log/i.test(sql)) {
                state.eventLogTypes.push(String(args[0]));
                return { success: true, meta: {} };
              }
```

(c) `first()` 增加两个分支（放在 `FROM approval_instance` 分支之前）：

```ts
              if (/FROM\s+system_config/i.test(sql)) {
                const value = state.systemConfig[String(args[0])];
                return (value === undefined ? null : { config_value: value, updated_by: null, updated_at: "" }) as unknown as T;
              }
              if (/SELECT\s+id\s+FROM\s+approval_task[\s\S]*status\s*=\s*'pending'/i.test(sql)) {
                return (state.pendingHumanTaskId ? { id: state.pendingHumanTaskId } : null) as unknown as T;
              }
```

(d) `baseState()` 增加初始值：

```ts
  insertedHumanTasks: [],
  pendingHumanTaskId: null,
  systemConfig: {},
  eventLogTypes: [],
```

(e) 把现有用例 `"AI 自主 reject → 节点 returned + 任务 action=reject，comment 保留原文"` 改名为 `"AI 自主 reject 且未配置兜底审核人 → 节点 returned + 任务 action=reject + 告警日志"`，并在断言末尾追加：

```ts
    expect(state.eventLogTypes).toContain("ai_gate_fallback_reviewer_missing");
    expect(state.insertedHumanTasks).toHaveLength(0);
```

(f) 新增 describe：

```ts
describe("settleAiGateBlock — AI 拦截转人工", () => {
  const blocked = () =>
    parsedResult({
      outcome: "reject",
      decision: "reject",
      comment: "AI审查不通过：附件费用对象与收款方不一致"
    });

  it("已配置审核人：节点保持 in_progress，写 AI 驳回记录 + 审核人 pending 任务，发 APPROVAL_AI_ESCALATED", async () => {
    const state = baseState();
    state.systemConfig["approval.ai_gate.fallback_reviewer_userid"] = "Boss";
    const env = createFakeEnv(state);

    await applyAiGateDecision(env, state.node, 1, blocked());

    expect(state.node.status).toBe("in_progress");
    expect(state.insertedTasks).toHaveLength(1);
    expect(state.insertedTasks[0].assignee_userid).toBe("AI_GATE");
    expect(state.insertedTasks[0].action).toBe("reject");
    expect(state.insertedTasks[0].comment).toBe("AI审查不通过：附件费用对象与收款方不一致");
    expect(state.insertedHumanTasks).toEqual([
      { node_instance_id: 5, instance_id: 1, assignee_userid: "Boss", round: 1 }
    ]);
    const escalated = state.events.find((e) => e.type === "APPROVAL_AI_ESCALATED");
    expect(escalated).toBeDefined();
    expect(escalated?.payload).toMatchObject({
      instance_id: 1,
      instance_no: "SP-20260814-0001",
      node_instance_id: 5,
      reviewer_userid: "Boss",
      reason: "AI审查不通过：附件费用对象与收款方不一致"
    });
    expect(state.eventLogTypes).not.toContain("ai_gate_fallback_reviewer_missing");
  });

  it("写入顺序：AI 驳回记录先于人工任务", async () => {
    const state = baseState();
    state.systemConfig["approval.ai_gate.fallback_reviewer_userid"] = "Boss";
    const order: string[] = [];
    const env = createFakeEnv(state);
    const originalPrepare = (env.DB as unknown as { prepare: (sql: string) => unknown }).prepare;
    (env.DB as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (/INSERT\s+INTO\s+approval_task/i.test(sql)) {
        order.push(/,\s*round,\s*status/i.test(sql) ? "human" : "ai");
      }
      return originalPrepare(sql);
    };

    await applyAiGateDecision(env, state.node, 1, blocked());

    expect(order).toEqual(["ai", "human"]);
  });

  it("节点已有 pending 人工任务：整段跳过（队列重试幂等）", async () => {
    const state = baseState();
    state.systemConfig["approval.ai_gate.fallback_reviewer_userid"] = "Boss";
    state.pendingHumanTaskId = 77;
    const env = createFakeEnv(state);

    await applyAiGateDecision(env, state.node, 1, blocked());

    expect(state.node.status).toBe("in_progress");
    expect(state.insertedTasks).toHaveLength(0);
    expect(state.insertedHumanTasks).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("超管覆写 reject 不走转人工：节点 completed，无人工任务", async () => {
    const state = baseState();
    state.systemConfig["approval.ai_gate.fallback_reviewer_userid"] = "Boss";
    const env = createFakeEnv(state);

    await applyAiGateDecision(
      env,
      state.node,
      1,
      parsedResult({ outcome: "reject", decision: "reject", manualOverride: true, comment: "管理员驳回" })
    );

    expect(state.node.status).toBe("completed");
    expect(state.insertedHumanTasks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/approval/ai-gate-apply.test.ts`
Expected: 新 describe 的前三条 FAIL（节点被置 returned、无人工任务、无事件）；改名用例因缺告警日志 FAIL。

- [ ] **Step 3: 实现**

`ai-gate-apply.ts` 文件头注释的语义段追加一条，并在 import 区追加：

```ts
import { hasPendingHumanTaskOnNode, resolveAiGateFallbackReviewer } from "./ai-gate-fallback";
```

把 `applyAiGateDecision` 整体替换为：

```ts
const insertAiGateDecisionTask = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult,
  now: string
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO approval_task
      (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      node.id,
      instanceId,
      "AI_GATE",
      parsed.outcome,
      parsed.comment,
      node.round,
      "completed",
      now,
      now,
      now
    )
    .run();
};

export type AiGateBlockSettlement = "escalated" | "returned" | "skipped";

/**
 * AI 自主拦截的落地（2026-09-13 转人工设计）：
 * - 已配置兜底审核人 → 节点保持 in_progress，写 AI 驳回记录，给审核人建 pending 任务，
 *   发 APPROVAL_AI_ESCALATED（审核人待办卡 + 发起人结果卡）
 * - 未配置 → 旧行为：节点 returned（引擎随后 applyAiGateReturn 退回发起人），并写告警日志行
 * - 节点已有 pending 人工任务 → 整段跳过（队列重试幂等）
 * 写入顺序固定：AI 记录 → 人工任务 → 事件；人工任务写失败即抛错交队列重试。
 */
export const settleAiGateBlock = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult
): Promise<AiGateBlockSettlement> => {
  const now = nowIso();

  if (await hasPendingHumanTaskOnNode(env, node.id)) {
    return "skipped";
  }

  const reviewer = await resolveAiGateFallbackReviewer(env);
  if (!reviewer) {
    await env.DB.prepare(
      `UPDATE approval_node_instance SET status = 'returned', completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, node.id)
      .run();
    await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "ai_gate_fallback_reviewer_missing",
        "approval-engine",
        JSON.stringify({ instance_id: instanceId, node_instance_id: node.id }),
        now
      )
      .run();
    return "returned";
  }

  await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
  await env.DB.prepare(
    `INSERT INTO approval_task
      (node_instance_id, instance_id, assignee_userid, round, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(node.id, instanceId, reviewer, node.round, now, now)
    .run();

  const instance = await env.DB.prepare(
    "SELECT id, instance_no FROM approval_instance WHERE id = ?"
  )
    .bind(instanceId)
    .first<{ id: number; instance_no: string }>();

  await publishEvent(env, "APPROVAL_AI_ESCALATED", "approval-engine", {
    instance_id: instanceId,
    instance_no: instance?.instance_no ?? "",
    node_instance_id: node.id,
    reviewer_userid: reviewer,
    reason: parsed.comment
  });
  return "escalated";
};

/**
 * 落地 AI 关卡决策：更新节点状态 + 写 AI_GATE 决策任务（审计与前端展示）。
 * comment 原文保留（reject 时为「AI审查不通过：…」，退回后发起人可见确切理由）。
 */
export const applyAiGateDecision = async (
  env: Env,
  node: GateNodeRef,
  instanceId: number,
  parsed: ParsedAiGateResult
): Promise<void> => {
  const now = nowIso();
  const aiBlocks = parsed.outcome === "reject" && !parsed.manualOverride;

  if (aiBlocks) {
    await settleAiGateBlock(env, node, instanceId, parsed);
    return;
  }

  await env.DB.prepare(
    `UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, node.id)
    .run();

  await insertAiGateDecisionTask(env, node, instanceId, parsed, now);
};
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run src/services/approval/ai-gate-apply.test.ts src/services/approval/ai-gate-result.test.ts`
Expected: 全部通过（原三分支 + 新 describe 4 条 + applyAiGateReturn 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/approval/ai-gate-apply.ts packages/api/src/services/approval/ai-gate-apply.test.ts
git commit -m "feat(approval): AI 关卡拦截落地收口 settleAiGateBlock，已配置审核人时转人工"
```

---

### Task 6: AiGateExecutor 识别人工任务

**Files:**
- Modify: `packages/api/src/services/approval/executors.ts:495-660`
- Test: `packages/api/src/services/approval/ai-gate-executor.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/api/src/services/approval/ai-gate-executor.test.ts
import { describe, expect, it } from "vitest";

import { executorFactory } from "./executors";
import type { ApprovalTask } from "../../types/approval";
import type { Env } from "../../types/env";

/**
 * 只驱动 AiGateExecutor.isNodeComplete / processAction。
 * 假 D1：节点行 + 本节点的任务行（AI_GATE 与人工都放在 tasks 里）。
 */
type FakeTask = Pick<ApprovalTask, "id" | "assignee_userid" | "action" | "status">;

const createFakeEnv = (nodeStatus: string, tasks: FakeTask[]) => {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+approval_node_instance/i.test(sql)) {
                return { id: 5, status: nodeStatus, node_type: "ai_gate" } as unknown as T;
              }
              if (/SELECT\s+action[\s\S]*FROM\s+approval_task[\s\S]*assignee_userid\s*=\s*'AI_GATE'/i.test(sql)) {
                const ai = [...tasks]
                  .reverse()
                  .find(
                    (t) =>
                      t.assignee_userid === "AI_GATE" &&
                      t.status === "completed" &&
                      (t.action === "approve" || t.action === "reject")
                  );
                return (ai ? { action: ai.action } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              if (/FROM\s+approval_task[\s\S]*assignee_userid\s*<>\s*'AI_GATE'/i.test(sql)) {
                return { results: tasks.filter((t) => t.assignee_userid !== "AI_GATE") as unknown as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              updates.push({ sql, args });
              return { success: true, meta: {} };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, updates };
};

const executor = () => executorFactory("ai_gate");

describe("AiGateExecutor.isNodeComplete — 人工兜底任务优先", () => {
  it("无人工任务：维持旧逻辑，AI approve + 节点 completed → approved", async () => {
    const { env } = createFakeEnv("completed", [
      { id: 1, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({ complete: true, outcome: "approved" });
  });

  it("无人工任务：AI reject + 节点 returned → returned（未配置审核人的旧路径）", async () => {
    const { env } = createFakeEnv("returned", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({ complete: true, outcome: "returned" });
  });

  it("AI reject + 人工 pending → 未完成，且不得判 returned/rejected", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "pending" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({ complete: false, outcome: null });
  });

  it("AI reject + 人工 approve → approved", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: "approve", status: "completed" }
    ]);
    expect(await executor().isNodeComplete(env, 5)).toEqual({ complete: true, outcome: "approved" });
  });

  it("人工任务被取消/转签后不计入，回落 AI 判定", async () => {
    const { env } = createFakeEnv("in_progress", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "cancelled" },
      { id: 3, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    // 超管在 AI关卡任务页放行：取消了人工任务并补了 AI_GATE approve；节点由路由置 completed
    const { env: env2 } = createFakeEnv("completed", [
      { id: 1, assignee_userid: "AI_GATE", action: "reject", status: "completed" },
      { id: 2, assignee_userid: "Boss", action: null, status: "cancelled" },
      { id: 3, assignee_userid: "AI_GATE", action: "approve", status: "completed" }
    ]);
    expect((await executor().isNodeComplete(env, 5)).complete).toBe(false);
    expect(await executor().isNodeComplete(env2, 5)).toEqual({ complete: true, outcome: "approved" });
  });
});

describe("AiGateExecutor.processAction — 人工任务落 completed", () => {
  it("写 action/comment/status=completed", async () => {
    const { env, updates } = createFakeEnv("in_progress", []);
    const task = {
      id: 2,
      node_instance_id: 5,
      instance_id: 1,
      assignee_userid: "Boss",
      action: null,
      comment: null,
      round: 1,
      status: "pending",
      acted_at: null,
      created_at: "",
      updated_at: ""
    } as ApprovalTask;

    await executor().processAction(env, task, "approve", "核实无误，放行");

    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/UPDATE\s+approval_task\s+SET\s+action\s*=\s*\?/i);
    expect(updates[0].sql).toMatch(/status\s*=\s*'completed'/i);
    expect(updates[0].args[0]).toBe("approve");
    expect(updates[0].args[1]).toBe("核实无误，放行");
    expect(updates[0].args[updates[0].args.length - 1]).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/services/approval/ai-gate-executor.test.ts`
Expected: 「人工 pending → 未完成」「人工 approve → approved」与 processAction 用例 FAIL；其余通过。

- [ ] **Step 3: 实现**

在 `executors.ts` 的 `AiGateExecutor` 中，把

```ts
  async processAction(): Promise<void> {
  }
```

替换为：

```ts
  /** 人工兜底任务（AI 拦截转人工）的处理：与顺序节点相同写法。 */
  async processAction(
    env: Env,
    task: ApprovalTask,
    action: string,
    comment?: string
  ): Promise<void> {
    const now = nowIso();
    await env.DB.prepare(
      "UPDATE approval_task SET action = ?, comment = ?, status = 'completed', acted_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(action, comment ?? null, now, now, task.id)
      .run();
  }
```

在 `isNodeComplete` 中，`const node = ...first<ApprovalNodeInstance>();` 之后、`const decision = ...` 之前插入：

```ts
    // 人工兜底任务优先（AI 拦截转人工，2026-09-13）：pending 即未完成；
    // 审核人 approve 即通过。驳回/退回发起人由通用操作直接落状态，不经此处。
    const humanRows = await env.DB.prepare(
      `SELECT * FROM approval_task
        WHERE node_instance_id = ?
          AND assignee_userid <> 'AI_GATE'
        ORDER BY id ASC`
    )
      .bind(nodeInstanceId)
      .all<ApprovalTask>();
    const humanTasks = getActiveTasks(humanRows.results ?? []);
    if (humanTasks.some((t) => t.status === "pending")) {
      return { complete: false, outcome: null };
    }
    if (humanTasks.some((t) => t.status === "completed" && t.action === "approve")) {
      return { complete: true, outcome: "approved" };
    }
```

- [ ] **Step 4: 运行确认通过 + 相关回归**

Run: `cd packages/api && npx vitest run src/services/approval`
Expected: 全部通过（含 ai-gate-apply 里经 advanceWorkflow 驱动的用例；其假件 `all()` 返回空数组，人工任务判定自然为空）。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/approval/executors.ts packages/api/src/services/approval/ai-gate-executor.test.ts
git commit -m "feat(approval): AI 关卡执行器识别人工兜底任务（pending 未完成、approve 通过）"
```

---

### Task 7: 队列侧 `APPROVAL_AI_ESCALATED` 推卡

**Files:**
- Modify: `packages/api/src/queue-handler.ts`
- Test: `packages/api/src/queue-handler-ai-escalated.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/api/src/queue-handler-ai-escalated.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./types/env";

const pushMock = vi.hoisted(() => ({
  sendApprovalTodoTemplateCard: vi.fn(async () => ({ msgid: "m1", invaliduser: null, unlicenseduser: null })),
  sendApprovalResultTemplateCard: vi.fn(async () => ({ msgid: "m2", invaliduser: null, unlicenseduser: null })),
  resolveApplicantDisplayName: vi.fn(async (_env: unknown, userid: string) =>
    userid === "Boss" ? "刘老板" : userid === "UserA" ? "小王" : userid
  ),
  resolveApprovalPushMeta: vi.fn(async () => ({ requestTitle: "首笔预付款", amountText: "¥20,000.00" }))
}));

vi.mock("./services/wecom-approval-push", () => ({
  sendApprovalTodoTemplateCard: pushMock.sendApprovalTodoTemplateCard,
  sendApprovalResultTemplateCard: pushMock.sendApprovalResultTemplateCard,
  resolveApplicantDisplayName: pushMock.resolveApplicantDisplayName,
  resolveApprovalPushMeta: pushMock.resolveApprovalPushMeta
}));

import { handleApprovalAiEscalated } from "./queue-handler";

const createFakeEnv = () => {
  const eventLogTypes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+approval_instance\s+ai/i.test(sql)) {
                return {
                  id: 362,
                  instance_no: "SP-20260913-0007",
                  biz_type: "payment_request",
                  biz_id: 2899,
                  biz_summary: "智能发单台-首笔预付款",
                  initiator_userid: "UserA",
                  current_node_name: "AI关卡"
                } as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              if (/FROM\s+approval_task/i.test(sql)) {
                return { results: [{ assignee_userid: "Boss" }] as unknown as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (/INSERT\s+INTO\s+event_log/i.test(sql)) eventLogTypes.push(String(args[0]));
              return { success: true, meta: {} };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, eventLogTypes };
};

describe("handleApprovalAiEscalated", () => {
  beforeEach(() => {
    pushMock.sendApprovalTodoTemplateCard.mockClear();
    pushMock.sendApprovalResultTemplateCard.mockClear();
  });

  it("给审核人推待办卡，给发起人推 escalated 结果卡并点名审核人", async () => {
    const { env, eventLogTypes } = createFakeEnv();

    await handleApprovalAiEscalated(env, {
      instance_id: 362,
      instance_no: "SP-20260913-0007",
      node_instance_id: 1931,
      reviewer_userid: "Boss",
      reason: "AI审查不通过：附件费用对象与收款方不一致"
    });

    expect(pushMock.sendApprovalTodoTemplateCard).toHaveBeenCalledTimes(1);
    expect(pushMock.sendApprovalTodoTemplateCard.mock.calls[0][1]).toMatchObject({
      instanceId: 362,
      assigneeUserId: "Boss",
      currentNodeName: "AI关卡"
    });
    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(pushMock.sendApprovalResultTemplateCard.mock.calls[0][1]).toMatchObject({
      instanceId: 362,
      initiatorUserId: "UserA",
      resultType: "escalated",
      resultReason: "AI 审查未通过，已转人工复核，等待 刘老板 处理"
    });
    expect(eventLogTypes).toContain("wecom_template_card_sent");
    expect(eventLogTypes).toContain("wecom_template_card_result_sent");
  });

  it("待办卡发送失败不影响发起人结果卡：失败由推卡函数自行记 wecom_template_card_failed", async () => {
    const { env, eventLogTypes } = createFakeEnv();
    pushMock.sendApprovalTodoTemplateCard.mockRejectedValueOnce(new Error("wecom down"));

    await handleApprovalAiEscalated(env, { instance_id: 362, reviewer_userid: "Boss" });

    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(eventLogTypes).toContain("wecom_template_card_failed");
    expect(eventLogTypes).toContain("wecom_template_card_result_sent");
  });

  it("结果卡发送失败只记 result isolation guard，不抛出", async () => {
    const { env, eventLogTypes } = createFakeEnv();
    pushMock.sendApprovalResultTemplateCard.mockRejectedValueOnce(new Error("wecom down"));

    await expect(
      handleApprovalAiEscalated(env, { instance_id: 362, reviewer_userid: "Boss" })
    ).resolves.toBeUndefined();

    expect(eventLogTypes).toContain("wecom_template_card_result_failed");
    expect(eventLogTypes).toContain("wecom_template_card_result_isolation_guard");
  });

  it("instance_id 非法直接返回", async () => {
    const { env } = createFakeEnv();
    await handleApprovalAiEscalated(env, { instance_id: 0 });
    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(pushMock.sendApprovalResultTemplateCard).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/queue-handler-ai-escalated.test.ts`
Expected: FAIL，`handleApprovalAiEscalated` 未导出。

- [ ] **Step 3: 实现**

在 `queue-handler.ts` 中，`pushApprovalResultToInitiator` 定义之后（`const REJECT_REASON_MAX_LENGTH` 之前）新增：

```ts
/**
 * AI 关卡拦截转人工（APPROVAL_AI_ESCALATED）：
 * 1. 审核人的待办卡：复用节点进入的推卡逻辑（推给实例上所有 pending 任务受理人，此时只有审核人）；
 * 2. 发起人的结果卡：类型 escalated，点名审核人。
 * 两路各自隔离，失败只记日志行，不互相影响。
 */
export const handleApprovalAiEscalated = async (
  env: Env,
  payload: Record<string, unknown>
): Promise<void> => {
  const instanceId = Number(payload.instance_id ?? 0);
  if (Number.isNaN(instanceId) || instanceId <= 0) return;

  try {
    await handleApprovalSubmitted(env, instanceId);
  } catch (error) {
    await env.DB.prepare(
      "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(
        "wecom_template_card_isolation_guard",
        "queue-handler",
        JSON.stringify({
          instance_id: instanceId,
          event_type: "APPROVAL_AI_ESCALATED",
          error: error instanceof Error ? error.message : "unknown error"
        }),
        nowIso()
      )
      .run();
  }

  const reviewerUserId = String(payload.reviewer_userid ?? "").trim();
  const reviewerName = reviewerUserId
    ? await resolveApplicantDisplayName(env, reviewerUserId)
    : "";
  const reason = reviewerName
    ? `AI 审查未通过，已转人工复核，等待 ${reviewerName} 处理`
    : "AI 审查未通过，已转人工复核";

  try {
    await pushApprovalResultToInitiator(env, instanceId, "escalated", reason);
  } catch (error) {
    await logResultPushIsolationGuard(env, {
      instance_id: instanceId,
      event_type: "APPROVAL_AI_ESCALATED",
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
};
```

`logResultPushIsolationGuard` 已存在于本文件，定义在 `pushApprovalResultToInitiator` 之前，写的事件类型是 `wecom_template_card_result_isolation_guard`；`handleApprovalSubmitted` 对单个受理人推卡失败只记 `wecom_template_card_failed` 且不抛出，所以第一段 try/catch 只兜住查询等意外异常。

在事件 switch 的 `case "APPROVAL_RETURNED":` 之前插入：

```ts
        case "APPROVAL_AI_ESCALATED": {
          await handleApprovalAiEscalated(env, event.payload ?? {});
          break;
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run src/queue-handler-ai-escalated.test.ts && npx tsc --noEmit`
Expected: 4 passed；tsc 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/queue-handler.ts packages/api/src/queue-handler-ai-escalated.test.ts
git commit -m "feat(queue): AI 拦截转人工事件推审核人待办卡与发起人结果卡"
```

---

### Task 8: 超管设置接口 + 手动处理路由取消悬空人工任务

**Files:**
- Modify: `packages/api/src/routes/admin.ts`
- Test: `packages/api/src/routes/admin-ai-gate-settings.test.ts`
- Modify: `packages/api/src/routes/admin-ai-gate-handle-state-guard.test.ts`

- [ ] **Step 1: 写设置接口失败测试**

```ts
// packages/api/src/routes/admin-ai-gate-settings.test.ts
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { adminRoutes } from "./admin";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "boss-a",
    username: "boss-a",
    nickname: "Boss A",
    avatar: "",
    roles: ["super_admin"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const deps = vi.hoisted(() => ({
  roleByUser: new Map<string, string | null>([
    ["Boss", "super_admin"],
    ["Mgr", "manager"]
  ]),
  contacts: [
    { userid: "Boss", name: "刘老板", department: [1] },
    { userid: "Mgr", name: "王经理", department: [1] }
  ]
}));

vi.mock("../services/wecom-role", () => ({
  resolveSystemRoleForUser: async (_env: unknown, userid: string) => deps.roleByUser.get(userid) ?? null
}));

vi.mock("../services/wecom-contact-book", () => ({
  getWeComContactBook: async () => ({ syncedAt: "2026-09-14T00:00:00.000Z", departments: [], users: deps.contacts })
}));

class SettingsStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: SettingsDb,
    private readonly sql: string
  ) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    if (/FROM\s+system_config/i.test(this.sql)) {
      const row = this.db.config.get(String(this.params[0]));
      return (row ?? null) as unknown as T;
    }
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }
  async run() {
    this.db.runs.push({ sql: this.sql, params: this.params });
    if (/INSERT\s+INTO\s+system_config/i.test(this.sql)) {
      this.db.config.set(String(this.params[0]), {
        config_value: String(this.params[1]),
        updated_by: String(this.params[2]),
        updated_at: String(this.params[4])
      });
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class SettingsDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];
  readonly config = new Map<string, { config_value: string; updated_by: string | null; updated_at: string }>();
  prepare(sql: string) {
    return new SettingsStatement(this, sql);
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/admin", adminRoutes);
  return app;
};

const createEnv = (db: SettingsDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: SettingsDb };

const call = (env: Env, method: "GET" | "PUT", body?: Record<string, unknown>) =>
  createApp().request(
    "/admin/approval-ai-gate/settings",
    {
      method,
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    },
    env
  );

describe("AI 关卡兜底审核人设置", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
  });

  it("非超管 403", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
    const res = await call(createEnv(new SettingsDb()), "GET");
    expect(res.status).toBe(403);
  });

  it("GET 未配置返回空值", async () => {
    const res = await call(createEnv(new SettingsDb()), "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "",
      fallback_reviewer_name: null,
      fallback_reviewer_role: null
    });
  });

  it("PUT 非通讯录成员 400", async () => {
    const res = await call(createEnv(new SettingsDb()), "PUT", { fallback_reviewer_userid: "Ghost" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("通讯录");
  });

  it("PUT 非超管成员 400 并带当前角色", async () => {
    const res = await call(createEnv(new SettingsDb()), "PUT", { fallback_reviewer_userid: "Mgr" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("manager");
  });

  it("PUT 成功：upsert + 审计；GET 回读含姓名与角色", async () => {
    const env = createEnv(new SettingsDb());
    const put = await call(env, "PUT", { fallback_reviewer_userid: " Boss " });
    expect(put.status).toBe(200);
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(true);
    const audit = env.DB.runs.find((r) => /INSERT\s+INTO\s+api_audit_log/i.test(r.sql));
    expect(audit?.params[2]).toBe("admin.ai_gate_fallback_reviewer.update");

    const get = await call(env, "GET");
    const body = (await get.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "Boss",
      fallback_reviewer_name: "刘老板",
      fallback_reviewer_role: "super_admin",
      updated_by: "boss-a"
    });
  });

  it("PUT 空串清除配置并审计", async () => {
    const env = createEnv(new SettingsDb());
    env.DB.config.set("approval.ai_gate.fallback_reviewer_userid", {
      config_value: "Boss",
      updated_by: "boss-a",
      updated_at: "2026-09-14T00:00:00.000Z"
    });
    const res = await call(env, "PUT", { fallback_reviewer_userid: "" });
    expect(res.status).toBe(200);
    expect(env.DB.config.get("approval.ai_gate.fallback_reviewer_userid")?.config_value).toBe("");
    const audit = env.DB.runs.find((r) => /INSERT\s+INTO\s+api_audit_log/i.test(r.sql));
    expect(String(audit?.params[6])).toContain('"previous":"Boss"');
  });
});
```

- [ ] **Step 2: 写手动处理路由的失败断言**

在 `admin-ai-gate-handle-state-guard.test.ts` 的 `GateDb.first` 中，`FROM approval_node_instance` 分支之前加入（人工任务探测查询不在本文件路径上，仅保证不误匹配）：无需改动。在最后一个 `it`（"still lets a super admin pass an in_progress gate …"）的断言后追加：

```ts
    const cancelHuman = env.DB.runs.find(
      (call) =>
        /UPDATE\s+approval_task\s+SET\s+status\s*=\s*'cancelled'/i.test(call.sql) &&
        /assignee_userid\s*<>\s*'AI_GATE'/i.test(call.sql)
    );
    expect(cancelHuman).toBeDefined();
    expect(cancelHuman?.params[1]).toBe(1931);
```

- [ ] **Step 3: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/admin-ai-gate-settings.test.ts src/routes/admin-ai-gate-handle-state-guard.test.ts`
Expected: settings 用例除 403 外 FAIL（404 路由不存在）；handle 用例最后一条 FAIL（找不到取消语句）。

- [ ] **Step 4: 实现设置接口**

`admin.ts` import 区追加：

```ts
import { writeAuditLog } from "../services/audit-log";
import { getSystemConfigEntry, setSystemConfig } from "../services/system-config";
import { getWeComContactBook } from "../services/wecom-contact-book";
import { resolveSystemRoleForUser } from "../services/wecom-role";
import { AI_GATE_FALLBACK_REVIEWER_KEY } from "../services/approval/ai-gate-fallback";
```

在 `adminRoutes.post("/approval-ai-gate/tasks/:taskId/handle", ...)` 之前插入：

```ts
// ─── AI 关卡兜底审核人（系统级配置，转人工设计 2026-09-13）──────────

adminRoutes.get("/approval-ai-gate/settings", requireRoles(["super_admin"]), async (c) => {
  const entry = await getSystemConfigEntry(c.env, AI_GATE_FALLBACK_REVIEWER_KEY);
  const userid = entry?.value ?? "";

  let name: string | null = null;
  let role: string | null = null;
  if (userid) {
    try {
      const book = await getWeComContactBook(c.env);
      name = book.users.find((user) => user.userid === userid)?.name ?? null;
    } catch {
      name = null;
    }
    try {
      role = await resolveSystemRoleForUser(c.env, userid);
    } catch {
      role = null;
    }
  }

  return c.json({
    success: true,
    data: {
      fallback_reviewer_userid: userid,
      fallback_reviewer_name: name,
      fallback_reviewer_role: role,
      updated_by: entry?.updated_by ?? null,
      updated_at: entry?.updated_at ?? null
    }
  });
});

adminRoutes.put("/approval-ai-gate/settings", requireRoles(["super_admin"]), async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as { fallback_reviewer_userid?: unknown };
  const next =
    typeof body.fallback_reviewer_userid === "string" ? body.fallback_reviewer_userid.trim() : "";
  const previous = (await getSystemConfigEntry(c.env, AI_GATE_FALLBACK_REVIEWER_KEY))?.value ?? "";

  if (next) {
    const book = await getWeComContactBook(c.env);
    if (!book.users.some((user) => user.userid === next)) {
      return c.json(
        { success: false, error: { message: "兜底审核人不在企业微信通讯录中" } },
        400
      );
    }
    const role = await resolveSystemRoleForUser(c.env, next);
    if (role !== "super_admin") {
      return c.json(
        {
          success: false,
          error: { message: `兜底审核人必须是超级管理员（当前解析角色：${role ?? "未命中任何角色标签"}）` }
        },
        400
      );
    }
  }

  await setSystemConfig(c.env, AI_GATE_FALLBACK_REVIEWER_KEY, next, auth.sub);
  await writeAuditLog(c.env.DB, {
    actorUserId: auth.sub,
    actorRoles: auth.roles,
    action: "admin.ai_gate_fallback_reviewer.update",
    targetType: "system_config",
    targetId: AI_GATE_FALLBACK_REVIEWER_KEY,
    detail: { previous, next }
  });

  return c.json({ success: true, data: { fallback_reviewer_userid: next } });
});
```

- [ ] **Step 5: 手动处理路由取消悬空人工任务**

在 handle 路由中，`let resultPayload: Record<string, unknown> = {};` 之前插入：

```ts
    // 超管在控制台直接放行/驳回时，节点上若挂着兜底审核人的 pending 任务必须一并收掉，
    // 否则它会作为悬空待办留在审核人列表里（转人工设计 2026-09-13）。
    if (node) {
      await c.env.DB.prepare(
        `UPDATE approval_task
            SET status = 'cancelled', updated_at = ?
          WHERE node_instance_id = ?
            AND status = 'pending'
            AND assignee_userid <> 'AI_GATE'`
      )
        .bind(now, node.id)
        .run();
    }
```

- [ ] **Step 6: 运行确认通过**

Run: `cd packages/api && npx vitest run src/routes/admin-ai-gate-settings.test.ts src/routes/admin-ai-gate-handle-state-guard.test.ts src/routes/admin-agent-grants.test.ts && npx tsc --noEmit && npx eslint src/routes/admin.ts src/routes/admin-ai-gate-settings.test.ts`
Expected: 全部通过；tsc/eslint 无报错。

- [ ] **Step 7: 提交**

```bash
git add packages/api/src/routes/admin.ts packages/api/src/routes/admin-ai-gate-settings.test.ts packages/api/src/routes/admin-ai-gate-handle-state-guard.test.ts
git commit -m "feat(admin): AI 关卡兜底审核人设置接口；控制台放行时收掉悬空人工任务"
```

---

### Task 9: Web — 设置卡与时间线标签

**Files:**
- Modify: `packages/web/src/api/admin.ts`
- Create: `packages/web/src/views/admin/ai-gate-settings.ts`
- Test: `packages/web/src/views/admin/ai-gate-settings.test.ts`
- Modify: `packages/web/src/views/admin/ai-gate-tasks.vue`
- Create: `packages/web/src/views/approval/human-review.ts`
- Test: `packages/web/src/views/approval/human-review.test.ts`
- Modify: `packages/web/src/views/approval/detail.vue`

- [ ] **Step 1: 写失败测试（纯逻辑）**

```ts
// packages/web/src/views/admin/ai-gate-settings.test.ts
import { describe, expect, it } from "vitest";
import {
  buildFallbackReviewerNotice,
  filterSuperAdminContacts
} from "./ai-gate-settings";

describe("filterSuperAdminContacts", () => {
  it("只保留 system_role 为 super_admin 的联系人并按姓名排序", () => {
    const result = filterSuperAdminContacts([
      { userid: "b", name: "王", department: [1], system_role: "super_admin" },
      { userid: "m", name: "李", department: [1], system_role: "manager" },
      { userid: "a", name: "刘", department: [1], system_role: "super_admin" },
      { userid: "n", name: "无角色", department: [1] }
    ]);
    expect(result.map(u => u.userid)).toEqual(["a", "b"]);
  });
});

describe("buildFallbackReviewerNotice", () => {
  it("未配置给黄色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "",
        fallback_reviewer_name: null,
        fallback_reviewer_role: null
      })
    ).toEqual({
      type: "warning",
      text: "未配置兜底审核人，AI 拦截将退回发起人修改重提"
    });
  });

  it("角色不再是超管时给黄色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: "manager"
      })
    ).toEqual({
      type: "warning",
      text: "当前兜底审核人 刘老板 的角色已不是超级管理员（manager），请重新指定"
    });
  });

  it("正常配置给绿色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: "super_admin"
      })
    ).toEqual({
      type: "success",
      text: "AI 拦截将转给 刘老板 人工复核"
    });
  });
});
```

```ts
// packages/web/src/views/approval/human-review.test.ts
import { describe, expect, it } from "vitest";
import {
  humanReviewStatusText,
  isAiGateHumanReviewTask
} from "./human-review";

const task = (over: Partial<{ assignee_userid: string; status: string; action: string | null }>) => ({
  id: 1,
  node_instance_id: 5,
  instance_id: 1,
  assignee_userid: "Boss",
  action: null,
  comment: null,
  round: 1,
  status: "pending",
  acted_at: null,
  created_at: "",
  updated_at: "",
  ...over
});

describe("isAiGateHumanReviewTask", () => {
  it("关卡节点上的真人任务为人工复核", () => {
    expect(isAiGateHumanReviewTask("ai_gate", task({}))).toBe(true);
  });
  it("AI_GATE 自身任务不是", () => {
    expect(isAiGateHumanReviewTask("ai_gate", task({ assignee_userid: "AI_GATE" }))).toBe(false);
  });
  it("非关卡节点不是", () => {
    expect(isAiGateHumanReviewTask("sequential", task({}))).toBe(false);
  });
});

describe("humanReviewStatusText", () => {
  it("pending 提示等待人工复核", () => {
    expect(humanReviewStatusText(task({}))).toBe("AI 拦截，等待人工复核");
  });
  it("已处理不再提示", () => {
    expect(humanReviewStatusText(task({ status: "completed", action: "approve" }))).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npx vitest run src/views/admin/ai-gate-settings.test.ts src/views/approval/human-review.test.ts`
Expected: FAIL，两个模块不存在。

- [ ] **Step 3: 实现纯逻辑与 API 封装**

```ts
// packages/web/src/views/admin/ai-gate-settings.ts
import type { WeComUser } from "@/api/wecom";

export type AiGateFallbackReviewerSettings = {
  fallback_reviewer_userid: string;
  fallback_reviewer_name: string | null;
  fallback_reviewer_role: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

/** 设置卡下拉人选：只列超管，按姓名排序。 */
export const filterSuperAdminContacts = (users: WeComUser[]): WeComUser[] =>
  users
    .filter(user => user.system_role === "super_admin")
    .sort((a, b) => `${a.name || ""}`.localeCompare(`${b.name || ""}`, "zh-Hans-CN"));

export const buildFallbackReviewerNotice = (
  settings: AiGateFallbackReviewerSettings
): { type: "warning" | "success"; text: string } => {
  if (!settings.fallback_reviewer_userid) {
    return {
      type: "warning",
      text: "未配置兜底审核人，AI 拦截将退回发起人修改重提"
    };
  }
  const name = settings.fallback_reviewer_name || settings.fallback_reviewer_userid;
  if (settings.fallback_reviewer_role !== "super_admin") {
    return {
      type: "warning",
      text: `当前兜底审核人 ${name} 的角色已不是超级管理员（${settings.fallback_reviewer_role ?? "未命中角色标签"}），请重新指定`
    };
  }
  return { type: "success", text: `AI 拦截将转给 ${name} 人工复核` };
};
```

```ts
// packages/web/src/views/approval/human-review.ts
import type { ApprovalTask } from "@/api/approval";

/** AI 关卡节点上受理人是真人的任务 = AI 拦截转人工的兜底复核任务。 */
export const isAiGateHumanReviewTask = (nodeType: string, task: ApprovalTask): boolean =>
  nodeType === "ai_gate" && task.assignee_userid !== "AI_GATE";

export const humanReviewStatusText = (task: ApprovalTask): string =>
  task.status === "pending" ? "AI 拦截，等待人工复核" : "";
```

`packages/web/src/api/admin.ts` 在 `handleApprovalAiGateTask` 之后追加：

```ts
export type ApprovalAiGateSettings = {
  fallback_reviewer_userid: string;
  fallback_reviewer_name: string | null;
  fallback_reviewer_role: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

export const getApprovalAiGateSettings = () => {
  return http.request<{ success: boolean; data: ApprovalAiGateSettings }>(
    "get",
    "/api/v1/admin/approval-ai-gate/settings"
  );
};

export const updateApprovalAiGateSettings = (data: { fallback_reviewer_userid: string }) => {
  return http.request<{ success: boolean; data: { fallback_reviewer_userid: string } }>(
    "put",
    "/api/v1/admin/approval-ai-gate/settings",
    { data }
  );
};
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/web && npx vitest run src/views/admin/ai-gate-settings.test.ts src/views/approval/human-review.test.ts`
Expected: 8 passed。

- [ ] **Step 5: 设置卡接入 `ai-gate-tasks.vue`**

script 部分：import 区追加

```ts
import { computed } from "vue";
import {
  getApprovalAiGateSettings,
  updateApprovalAiGateSettings,
  type ApprovalAiGateSettings
} from "@/api/admin";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  buildFallbackReviewerNotice,
  filterSuperAdminContacts
} from "./ai-gate-settings";
```

（`computed` 与现有 `import { onMounted, ref } from "vue";` 合并为一行。）

在 `onMounted(loadRows);` 之前加入：

```ts
const settings = ref<ApprovalAiGateSettings | null>(null);
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const reviewerDraft = ref("");
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const superAdminOptions = computed(() => filterSuperAdminContacts(wecomUsers.value));
const reviewerNotice = computed(() =>
  settings.value ? buildFallbackReviewerNotice(settings.value) : null
);

const loadSettings = async () => {
  settingsLoading.value = true;
  try {
    const result = await getApprovalAiGateSettings();
    settings.value = result.data;
    reviewerDraft.value = result.data.fallback_reviewer_userid;
  } finally {
    settingsLoading.value = false;
  }
};

const saveSettings = async () => {
  settingsSaving.value = true;
  try {
    await updateApprovalAiGateSettings({ fallback_reviewer_userid: reviewerDraft.value });
    message("兜底审核人已保存", { type: "success" });
    await loadSettings();
  } finally {
    settingsSaving.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadSettings(), loadWecomUsers().catch(() => undefined)]);
});
```

保留原有的 `onMounted(loadRows);` 不动；Vue 允许注册多个 onMounted，两者都会执行。

template：在最外层 `<el-card shadow="never" style="background: #fffaf2">` 之前插入设置卡：

```vue
  <el-card shadow="never" style="margin-bottom: 12px">
    <template #header>
      <div style="font-size: 16px; font-weight: 700">AI 关卡兜底审核人</div>
      <div style="margin-top: 4px; font-size: 13px; color: #6e6458">
        AI 判定拦截时不再自动退回，转给此人以普通审批任务处理（放行 / 退回发起人 / 驳回）
      </div>
    </template>
    <el-alert
      v-if="reviewerNotice"
      :type="reviewerNotice.type"
      :title="reviewerNotice.text"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <el-select
        v-model="reviewerDraft"
        clearable
        filterable
        placeholder="选择超级管理员"
        style="width: 280px"
        :loading="settingsLoading"
      >
        <el-option
          v-for="user in superAdminOptions"
          :key="user.userid"
          :label="`${user.name}（${user.userid}）`"
          :value="user.userid"
        />
      </el-select>
      <el-button type="primary" :loading="settingsSaving" @click="saveSettings">
        保存
      </el-button>
      <span v-if="settings?.updated_at" style="font-size: 12px; color: #999">
        最近更新：{{ settings.updated_by || "-" }} · {{ formatBeijingDateTime(settings.updated_at) }}
      </span>
    </div>
  </el-card>
```

现有 template 已是 `el-card` 与 `el-dialog` 两个根节点，Vue 3 允许多根，新卡片直接并列放在最前面。

- [ ] **Step 6: 时间线标签接入 `detail.vue`**

script import 区追加：

```ts
import { humanReviewStatusText, isAiGateHumanReviewTask } from "./human-review";
```

template 中任务行 `<span>{{ toUserLabel(task.assignee_userid) }}</span>` 之后插入：

```vue
                    <el-tag
                      v-if="isAiGateHumanReviewTask(node.node_type, task)"
                      type="warning"
                      size="small"
                      style="margin-left: 6px"
                      >人工复核</el-tag
                    >
                    <span
                      v-if="
                        isAiGateHumanReviewTask(node.node_type, task) &&
                        humanReviewStatusText(task)
                      "
                      style="margin-left: 6px; color: #e6a23c"
                      >{{ humanReviewStatusText(task) }}</span
                    >
```

- [ ] **Step 7: 验证**

Run: `cd packages/web && npx eslint src/views/admin/ai-gate-tasks.vue src/views/approval/detail.vue src/views/admin/ai-gate-settings.ts src/views/approval/human-review.ts src/api/admin.ts && npx prettier --check src/views/admin/ai-gate-tasks.vue src/views/approval/detail.vue src/views/admin/ai-gate-settings.ts src/views/approval/human-review.ts src/api/admin.ts && npm run typecheck && npx vitest run`
Expected: eslint/prettier 无报错；typecheck 通过；web 测试全部通过（基线 213 + 8）。

- [ ] **Step 8: 提交**

```bash
git add packages/web/src/api/admin.ts packages/web/src/views/admin/ai-gate-settings.ts packages/web/src/views/admin/ai-gate-settings.test.ts packages/web/src/views/admin/ai-gate-tasks.vue packages/web/src/views/approval/human-review.ts packages/web/src/views/approval/human-review.test.ts packages/web/src/views/approval/detail.vue
git commit -m "feat(web): AI 关卡兜底审核人设置卡；审批时间线标注人工复核任务"
```

---

### Task 10: 小程序 — 时间线文案

**Files:**
- Modify: `packages/miniapp/utils/enum-labels.js`
- Modify: `packages/miniapp/utils/enum-labels.test.js`
- Modify: `packages/miniapp/pages/approval-detail/index.js:497-506`

- [ ] **Step 1: 写失败测试**

在 `enum-labels.test.js` 的 require 解构里加入 `aiGateHumanReviewActionLabel`，文件末尾追加：

```js
// AI 拦截转人工：关卡节点上真人任务的动作文案（2026-09-13 设计）
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "Boss", status: "pending" }, "-"),
  "AI 拦截，等待人工复核"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "Boss", status: "completed", action: "approve" }, "通过"),
  "人工复核 · 通过"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "AI_GATE", status: "completed" }, "AI通过"),
  "AI通过"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("sequential", { assignee_userid: "Boss", status: "pending" }, "-"),
  "-"
);
console.log("enum-labels.test.js (ai-gate human review) passed");
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/miniapp && node utils/enum-labels.test.js`
Expected: TypeError，`aiGateHumanReviewActionLabel is not a function`。

- [ ] **Step 3: 实现**

`enum-labels.js` 在 `module.exports` 之前加入：

```js
/**
 * AI 关卡节点上受理人是真人的任务 = AI 拦截转人工的兜底复核任务：
 * pending 提示等待人工复核，已处理时在原动作前加「人工复核 ·」。
 */
const aiGateHumanReviewActionLabel = (nodeType, task, baseActionLabel) => {
  if (nodeType !== "ai_gate" || !task || task.assignee_userid === "AI_GATE") return baseActionLabel;
  if (task.status === "pending") return "AI 拦截，等待人工复核";
  return `人工复核 · ${baseActionLabel}`;
};
```

并在 `module.exports = {` 中追加 `aiGateHumanReviewActionLabel,`。

`pages/approval-detail/index.js`：文件顶部第 5 至 24 行已有 `const { ... } = require("../../utils/enum-labels");` 的多行解构，在其中加入 `aiGateHumanReviewActionLabel,`。`buildTimelineNodes` 中把

```js
            const actionLabel =
              task.assignee_userid === "AI_GATE"
                ? this.aiOutcomeLabel(aiOutcome, aiComment)
                : this.actionLabel(task.action);
```

改为

```js
            const baseActionLabel =
              task.assignee_userid === "AI_GATE"
                ? this.aiOutcomeLabel(aiOutcome, aiComment)
                : this.actionLabel(task.action);
            const actionLabel = aiGateHumanReviewActionLabel(node.node_type, task, baseActionLabel);
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/miniapp && node utils/enum-labels.test.js && npx tsc --noEmit`
Expected: 输出含 `enum-labels.test.js (ai-gate human review) passed`；tsc 无报错。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/utils/enum-labels.js packages/miniapp/utils/enum-labels.test.js packages/miniapp/pages/approval-detail/index.js
git commit -m "feat(miniapp): 审批时间线标注 AI 拦截转人工复核任务"
```

---

### Task 11: 文档、全量验证与上线说明

**Files:**
- Modify: `doc/开发记录.md`（追加）
- Modify: `doc/UI设计文档.md`（追加）

- [ ] **Step 1: 开发记录追加条目**

在 `doc/开发记录.md` 末尾追加：

```markdown

### AI 关卡拦截转人工兜底（2026-09-14）

- **诱因**：SP-20260913-0007 被 AI 退回后没有人工兜底出口（超管放行在 returned 实例上无效、只能作废重建）。owner 拍板：AI 判定拦截时不退回，转系统级配置的一位超管以普通审批任务处理。规格 docs/superpowers/specs/2026-09-13-ai-gate-human-escalation-design.md，计划 docs/superpowers/plans/2026-09-14-ai-gate-human-escalation.md。
- **数据**：迁移 0088 新增通用键值表 `system_config`，键 `approval.ai_gate.fallback_reviewer_userid`。
- **API**：`ai-gate-apply.ts` 新增 `settleAiGateBlock` 收口拦截落地（有审核人 → 节点保持 in_progress、写 AI 驳回记录、建审核人 pending 任务、发 `APPROVAL_AI_ESCALATED`；无审核人 → 旧 returned 路径 + `ai_gate_fallback_reviewer_missing` 日志行；节点已有 pending 人工任务则整段跳过）；`AiGateExecutor` 识别人工任务（pending 未完成、approve 通过）并实现 processAction；queue-handler 新分支推审核人待办卡与发起人 escalated 结果卡；`GET/PUT /admin/approval-ai-gate/settings`（通讯录 + super_admin 标签校验 + 审计）；控制台放行/驳回时收掉悬空人工任务；企微 HTTP 底层与标签角色解析从 routes/auth.ts 抽到 services/wecom-api.ts、services/wecom-role.ts。
- **Web**：AI关卡任务页顶部设置卡（人选过滤 super_admin，未配置/角色不符黄色提示）；审批详情时间线「人工复核」标签与「AI 拦截，等待人工复核」文案。
- **小程序**：时间线同样文案，随下次提审。
- **验证**：api vitest 全绿（新增 system-config 3 / wecom-role 5 / ai-gate-fallback 5 / ai-gate-apply +4 / ai-gate-executor 6 / queue-handler-ai-escalated 4 / admin-ai-gate-settings 6，handle 守卫 +1）、tsc/eslint 通过；web vitest +8、typecheck/eslint 通过；miniapp 脚本测试 + tsc 通过。
- **上线**：先远程应用迁移 0088，再 push main；部署后立刻在「AI关卡任务」页配置兜底审核人，否则行为与现状相同。
- **遗留**：审批详情对首节点仍显示「退回上一节点」，关卡任务点它会报无上一节点；wecom-contact-book.ts 仍保留一份 bridge-strict 的令牌获取未与 wecom-api.ts 合并。
```

- [ ] **Step 2: UI 设计文档追加**

在 `doc/UI设计文档.md` 末尾追加：

```markdown

## AI 关卡兜底审核人（2026-09-14）

- **系统管理 → AI关卡任务**：页面顶部新增「AI 关卡兜底审核人」卡片。下拉只列企微标签解析为超级管理员的人；未配置时黄色提示「未配置兜底审核人，AI 拦截将退回发起人修改重提」，角色不符时黄色提示重新指定，正常时绿色提示「AI 拦截将转给 X 人工复核」。保存后显示最近更新人与时间。
- **审批详情（网页与小程序）**：AI 关卡节点上受理人为真人的任务打「人工复核」标签；pending 时显示「AI 拦截，等待人工复核」，处理后动作前缀「人工复核 ·」。审核人的放行/退回/驳回按钮复用普通任务按钮。
- **企微通知**：审核人收「AI关卡」节点待办卡；发起人收「转人工复核」结果卡，说明「AI 审查未通过，已转人工复核，等待 X 处理」。
```

- [ ] **Step 3: 全量验证**

Run: `cd packages/api && npx tsc --noEmit && npx eslint src --ext .ts && npx vitest run`
Expected: 全部通过。

Run: `cd packages/web && npm run typecheck && npx vitest run`
Expected: 全部通过。

Run: `cd packages/miniapp && node utils/returned-approval.test.js && node utils/error-message.test.js && node utils/enum-labels.test.js && npx tsc --noEmit`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add doc/开发记录.md doc/UI设计文档.md
git commit -m "docs: AI 关卡拦截转人工兜底开发记录与 UI 说明"
```

- [ ] **Step 5: 交回 owner 的上线动作（不要自行执行）**

1. `cd packages/api && npx wrangler d1 migrations apply hybcdg-prod-db --remote`（应用 0088）。
2. `git push origin main`（自动部署 API 与 Web）。
3. 部署后在网页「系统管理 → AI关卡任务」顶部配置兜底审核人。
4. 小程序改动随下次提审。
