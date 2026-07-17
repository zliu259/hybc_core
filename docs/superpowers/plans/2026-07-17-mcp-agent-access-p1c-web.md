# MCP 智能体接入 — P1c：Web 三页（setup / authorize / grants） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 员工在 Web 端自助完成智能体接入：`/agent/setup` 生成一键安装命令、`/agent/authorize?user_code=` 完成 CLI 设备流的同意/拒绝、`/agent/grants` 查看与吊销授权（super_admin 可管理全部）。

**Architecture:** 纯前端为主（PureAdmin Vue3 + Element Plus，静态路由模块自动注册），复用 P1a 既有端点；仅补两个小端点（`GET /agent/device/info`、`POST /agent/device/deny`——同意页需要展示设备信息与"拒绝"能力，`DeviceStatus` 已含 `denied`、轮询已处理，只缺路由/服务函数）。另修一个真实缺口：路由守卫未保留原始 URL、WeCom OAuth 往返丢 hash——用 `sessionStorage` 暂存 + 白名单校验的 redirect 贯通，保证未登录访问 `/agent/authorize?user_code=XXXX` 登录后能回到原页。

**Tech Stack:** Vue 3 `<script setup>` + Element Plus、Pinia（`useUserStoreHook`）、vue-router(hash 模式)、vitest(happy-dom)、Hono + vitest（api 侧）。

---

## 依赖与既有事实（recon 已确认，直接采信）

**后端（P1a/P1b 已部署生产）：**
- `POST /api/v1/agent/setup/provision`（JWT+human）→ `{ boot_code, expires_in, install_sh, install_ps1 }`（完整一行命令，含 `&agent=`）
- `POST /api/v1/agent/device/approve`（JWT+human）`{user_code}` → `{ approved: true }`
- `GET /api/v1/agent/grants`（JWT）→ `PublicGrantView[]`；`POST /api/v1/agent/grants/:id/revoke`
- `GET /api/v1/admin/agent/grants`（JWT+super_admin，挂载 `/api/v1/admin`）→ `AdminGrantView[]`；`POST /api/v1/admin/agent/grants/:id/revoke`
- `PublicGrantView`: `{ id, device_name, agent_type, token_prefix, status: "active"|"revoked"|"expired", created_at, expires_at, last_used_at }`；`AdminGrantView` 另加 `wecom_userid, role_snapshot`
- 设备流 KV：`agent:usercode:{user_code}` → device_code；`agent:device:{device_code}` → `DeviceCodeRecord`（`status: "pending"|"approved"|"denied"`，`deviceName/agentType/clientInfo` 字段）；`pollDeviceToken` 已处理 `denied`
- 测试铸人类 JWT：`issueTokens(env, createSessionPayload({ userId, username, role }))` → `.accessToken`（`services/auth.ts`；fake KV 支持 TTL put）
- `agentRoutes` 里已有 `requireHumanSession`（拒 `auth_method === "mcp_agent"`）、`deviceRateLimit`、`ok()/fail()`

**前端（packages/web）：**
- 路由：`src/router/modules/*.ts` 自动 glob 注册，模板照 `modules/account.ts`（`satisfies RouteConfigsTable`、绝对子路径、`meta.roles` 槽位：`super_admin/manager/site_manager/finance/operator`，省略 = 任何已登录用户；`showLink:false` 隐藏菜单）
- **hash 路由**（三个 env 均 `VITE_ROUTER_HISTORY="hash"`）：路由 query 在 hash 内；WeCom OAuth `redirectUri = origin+pathname`（**不含 hash**），返回时 hash 丢失 → redirect 必须 sessionStorage 暂存
- 守卫缺口（`src/router/index.ts` 未登录分支）：`next({ path: "/login" })` 丢 `to.fullPath`；`login/index.vue` 登录成功后固定 `router.replace(getTopMenu(true).path)`（`loginByCode` 与 passkey 两处）
- API 包装：`import { http } from "@/utils/http"`，`http.request<{ success: boolean; data: T }>("get"|"post", url, { params }|{ data })`，**没有**共享 envelope 类型（每文件内联）
- 页面约定：`message()` 来自 `@/utils/message`（不用裸 ElMessage）；确认框 `ElMessageBox.confirm`；**不用 el-form `:rules`**，提交前手工校验（全库惯例）；列表页模板照 `views/finance/payee/index.vue`；复制/时间格式化照 `views/admin/wecom-bot-settings.vue`（`navigator.clipboard` + `formatTime`）
- 当前用户角色：`useUserStoreHook().roles`（`@/store/modules/user`）
- 测试：vitest ^3.2.4 + happy-dom + @vue/test-utils ^2.4.11，colocated `src/**/*.{test,spec}.ts`，`pnpm test`
- `src/views/agent/`、`src/api/agent.ts` 均不存在（全新）

**流程约束：** 分支 `feat/mcp-agent-p1c`（从 main 拉）。web 包用 **pnpm**。改动含 api 时 push main 即部署——本计划全部在分支上，合并另行决策。

---

## 文件结构

**修改 `packages/api/`**
- `src/services/agent-device.ts` — 加 `getDeviceInfoByUserCode`、`denyDeviceByUserCode`
- `src/routes/agent.ts` — 加 `GET /device/info`、`POST /device/deny`
- 新增 `src/routes/agent-device-consent.test.ts` — 两端点路由级测试

**新建/修改 `packages/web/`**
- `src/utils/loginRedirect.ts` + `src/utils/loginRedirect.test.ts` — redirect 白名单校验/暂存/弹出（TDD）
- `src/router/index.ts` — 未登录分支带上 `redirect` query
- `src/views/login/index.vue` — 挂载时暂存 redirect；两处登录成功改为 pop 后跳转
- `src/api/agent.ts` — 8 个包装 + 类型
- `src/router/modules/agent.ts` — 路由模块（setup/grants 进菜单，authorize 隐藏）
- `src/views/agent/setup.vue`、`src/views/agent/authorize.vue`、`src/views/agent/grants.vue`

**文档**
- `doc/UI设计文档.md` — 三页 UI 说明；`doc/开发记录.md` — 追加条目

---

## Task 0: 建分支

- [ ] **Step 1:**

```bash
cd /Users/zihaoliu/Documents/Code/hybc_core && git checkout main && git pull && git checkout -b feat/mcp-agent-p1c
```

---

## Task 1: API — `GET /agent/device/info` + `POST /agent/device/deny`（TDD）

**Files:**
- Test: `packages/api/src/routes/agent-device-consent.test.ts`（新建）
- Modify: `packages/api/src/services/agent-device.ts`
- Modify: `packages/api/src/routes/agent.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/api/src/routes/agent-device-consent.test.ts
import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createAgentGrant } from "../services/agent-grant";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const fakeEnv = (db: D1Database, kv: KVNamespace): Env =>
  ({
    DB: db,
    KV: kv,
    JWT_SECRET: "test-secret",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    AGENT_API_BASE_URL: "https://api.hybcdg.com"
  }) as unknown as Env;

const humanJwt = async (env: Env, role: UserRole = "manager"): Promise<string> => {
  const session = createSessionPayload({ userId: "MaxLiu", username: "MaxLiu", role });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

const startDevice = async (env: Env) => {
  const res = await agentRoutes.request(
    "/device/code",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_name: "Max MBP", agent_type: "claude_code" })
    },
    env
  );
  const body = (await res.json()) as {
    data: { user_code: string; device_code: string };
  };
  return body.data;
};

describe("GET /device/info", () => {
  it("returns device metadata for a logged-in human", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      `/device/info?user_code=${encodeURIComponent(user_code)}`,
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      user_code,
      device_name: "Max MBP",
      agent_type: "claude_code",
      status: "pending"
    });
  });

  it("404s for unknown user_code", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      "/device/info?user_code=ZZZZ-ZZZZ",
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(res.status).toBe(404);
  });

  it("403s for agent tokens (human-only consent surface)", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const res = await agentRoutes.request(
      `/device/info?user_code=${encodeURIComponent(user_code)}`,
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /device/deny", () => {
  it("marks the device denied and the poll reflects it", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code, device_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const res = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(res.status).toBe(200);
    const poll = await agentRoutes.request(
      "/device/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code })
      },
      env
    );
    const pollBody = (await poll.json()) as { data: { status: string } };
    expect(pollBody.data.status).toBe("denied");
  });

  it("400s when denying an already-resolved request", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const jwt = await humanJwt(env);
    const first = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(first.status).toBe(200);
    const second = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(second.status).toBe(400);
  });

  it("403s for agent tokens", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const env = fakeEnv(db, kv);
    const { user_code } = await startDevice(env);
    const { token } = await createAgentGrant(db, { wecomUserid: "MaxLiu", role: "manager" });
    const res = await agentRoutes.request(
      "/device/deny",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ user_code })
      },
      env
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/routes/agent-device-consent.test.ts`
Expected: FAIL（`/device/info` 404 无 body.data 匹配、deny 404 等——路由不存在）。

- [ ] **Step 3: 服务函数**（`packages/api/src/services/agent-device.ts` 末尾追加；`userCodeKey/deviceKey/DEVICE_TTL_SECONDS/DeviceCodeRecord` 该文件已有）

```typescript
export interface DeviceInfoView {
  user_code: string;
  device_name: string | null;
  agent_type: string | null;
  client_info: string | null;
  status: DeviceStatus;
}

export const getDeviceInfoByUserCode = async (
  kv: KVNamespace,
  userCode: string
): Promise<DeviceInfoView | null> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) return null;
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) return null;
  let record: DeviceCodeRecord;
  try {
    record = JSON.parse(raw) as DeviceCodeRecord;
  } catch (err) {
    console.error("agent device record parse failed", err);
    return null;
  }
  return {
    user_code: userCode,
    device_name: record.deviceName ?? null,
    agent_type: record.agentType ?? null,
    client_info: record.clientInfo ?? null,
    status: record.status
  };
};

export const denyDeviceByUserCode = async (
  kv: KVNamespace,
  userCode: string
): Promise<void> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) throw new Error("Unknown or expired user_code");
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) throw new Error("Unknown or expired user_code");
  const record = JSON.parse(raw) as DeviceCodeRecord;
  if (record.status !== "pending") throw new Error("Device request already resolved");
  const updated: DeviceCodeRecord = { ...record, status: "denied" };
  await kv.put(deviceKey(deviceCode), JSON.stringify(updated), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
};
```

`DeviceStatus` 若未从 `../types/agent` import，在文件头部现有 import 处补上。

- [ ] **Step 4: 路由**（`packages/api/src/routes/agent.ts`）

顶部 import 的 `agent-device` 一组里补 `denyDeviceByUserCode, getDeviceInfoByUserCode`。

`/device/info`、`/device/deny` 需 JWT：在现有 `agentRoutes.use("/setup/provision", authMiddleware);` 一组旁加：

```typescript
agentRoutes.use("/device/info", authMiddleware);
agentRoutes.use("/device/deny", authMiddleware);
```

注意：这两行必须放在对应路由定义**之前**（与现有 use/route 顺序一致即可）。路由（放在 `device/approve` 附近）：

```typescript
agentRoutes.get("/device/info", requireHumanSession, async (c) => {
  const userCode = c.req.query("user_code") ?? "";
  if (!userCode) return c.json(fail("user_code required"), 400);
  const info = await getDeviceInfoByUserCode(c.env.KV, userCode);
  if (!info) return c.json(fail("user_code invalid or expired"), 404);
  return c.json(ok(info));
});

agentRoutes.post("/device/deny", deviceRateLimit, requireHumanSession, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { user_code?: string };
  if (!body.user_code) return c.json(fail("user_code required"), 400);
  try {
    await denyDeviceByUserCode(c.env.KV, body.user_code);
  } catch (error) {
    return c.json(fail(error instanceof Error ? error.message : "deny failed"), 400);
  }
  return c.json(ok({ denied: true }));
});
```

- [ ] **Step 5: 运行，确认通过 + 全量回归 + typecheck**

Run: `cd packages/api && npm test -- src/routes/agent-device-consent.test.ts`
Expected: PASS（6 passed）。
Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/agent-device.ts packages/api/src/routes/agent.ts packages/api/src/routes/agent-device-consent.test.ts
git commit -m "feat(api): device-flow consent endpoints (info + deny) for authorize page"
```

---

## Task 2: web — loginRedirect 工具（TDD）

**Files:**
- Test: `packages/web/src/utils/loginRedirect.test.ts`（新建）
- Create: `packages/web/src/utils/loginRedirect.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/web/src/utils/loginRedirect.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { popRedirect, sanitizeRedirect, stashRedirect } from "./loginRedirect";

describe("sanitizeRedirect", () => {
  it("accepts in-app paths with query", () => {
    expect(sanitizeRedirect("/agent/authorize?user_code=ABCD-EFGH")).toBe(
      "/agent/authorize?user_code=ABCD-EFGH"
    );
    expect(sanitizeRedirect("/agent?next=https://x.com")).toBe("/agent?next=https://x.com");
  });

  it("rejects external / protocol-relative urls", () => {
    expect(sanitizeRedirect("https://evil.com/x")).toBeNull();
    expect(sanitizeRedirect("//evil.com/x")).toBeNull();
    expect(sanitizeRedirect("javascript:alert(1)")).toBeNull();
  });

  it("rejects non-strings, empty, and the login page itself", () => {
    expect(sanitizeRedirect(undefined)).toBeNull();
    expect(sanitizeRedirect(["/a", "/b"])).toBeNull();
    expect(sanitizeRedirect("")).toBeNull();
    expect(sanitizeRedirect("/login")).toBeNull();
    expect(sanitizeRedirect("/login?redirect=/x")).toBeNull();
  });
});

describe("stash/pop roundtrip (sessionStorage)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("pops what was stashed exactly once", () => {
    stashRedirect("/agent/authorize?user_code=AB12-CD34");
    expect(popRedirect()).toBe("/agent/authorize?user_code=AB12-CD34");
    expect(popRedirect()).toBeNull();
  });

  it("does not stash invalid values", () => {
    stashRedirect("https://evil.com");
    expect(popRedirect()).toBeNull();
  });

  it("does not clobber an existing stash with an invalid value", () => {
    stashRedirect("/agent/grants");
    stashRedirect(undefined);
    expect(popRedirect()).toBe("/agent/grants");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/web && pnpm test -- src/utils/loginRedirect.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// packages/web/src/utils/loginRedirect.ts
const STORAGE_KEY = "hybc-login-redirect";

/**
 * 登录后回跳地址白名单校验：只允许站内相对路径（防开放重定向），
 * 登录页自身不允许（防循环）。非法输入一律返回 null。
 */
export const sanitizeRedirect = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) {
    return null;
  }
  return raw;
};

/** 进入登录页时暂存目标地址（WeCom OAuth 往返会丢 hash，必须落 sessionStorage） */
export const stashRedirect = (raw: unknown): void => {
  const target = sanitizeRedirect(raw);
  if (!target) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, target);
  } catch {
    // sessionStorage 不可用时静默降级为默认首页跳转
  }
};

/** 登录成功后取出并清除暂存的回跳地址 */
export const popRedirect = (): string | null => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return sanitizeRedirect(raw);
  } catch {
    return null;
  }
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/web && pnpm test -- src/utils/loginRedirect.test.ts`
Expected: PASS（6 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/utils/loginRedirect.ts packages/web/src/utils/loginRedirect.test.ts
git commit -m "feat(web): login redirect sanitize/stash/pop util"
```

---

## Task 3: web — 守卫 + 登录页 redirect 贯通

**Files:**
- Modify: `packages/web/src/router/index.ts`（未登录分支，约 249–264 行）
- Modify: `packages/web/src/views/login/index.vue`（onMounted、loginByCode、passkey 成功两处）

- [ ] **Step 1: 守卫带上 redirect**

`src/router/index.ts` 未登录分支中找到：

```typescript
        removeToken();
        next({ path: "/login" });
```

改为：

```typescript
        removeToken();
        next({ path: "/login", query: { redirect: to.fullPath } });
```

- [ ] **Step 2: 登录页挂载时暂存**

`src/views/login/index.vue`：script 顶部（与其它 `@/utils/*` import 放一起）加：

```typescript
import { popRedirect, stashRedirect } from "@/utils/loginRedirect";
```

`onMounted(() => {` 的第一行（在读取 `code` 之前）插入：

```typescript
  stashRedirect(router.currentRoute.value.query.redirect);
```

（`router` 该文件已在用——`router.replace(...)`。OAuth 返回后 query 里只有 code、无 redirect，`stashRedirect(undefined)` 是 no-op、不会覆盖之前的暂存——Task 2 已有测试保证。）

> **勘误（执行中修正）**：Step 2 原文「stash 放 onMounted 第一行」有误——OAuth 返回趟守卫会注入默认 `redirect=/workspace/home`，无条件暂存会覆盖真正的深链。实际实现：先读 `code`，仅当无 code 时暂存（`stashRedirectFromLoginMount`，已加回归单测）。见 commit 4e0de04 / dbdacba。

- [ ] **Step 3: loginByCode 成功改为 pop 跳转**

找到：

```typescript
    await initRouter();
    const top = getTopMenu(true);
    await router.replace(top.path);
    message("登录成功", { type: "success" });
```

改为：

```typescript
    await initRouter();
    const target = popRedirect();
    await router.replace(target ?? getTopMenu(true).path);
    message("登录成功", { type: "success" });
```

- [ ] **Step 4: passkey 成功同样处理**

找到（passkey 分支）：

```typescript
    await initRouter();
    const top = getTopMenu(true);
    await router.replace(top.path);
    message("Passkey 登录成功", { type: "success" });
```

改为：

```typescript
    await initRouter();
    const target = popRedirect();
    await router.replace(target ?? getTopMenu(true).path);
    message("Passkey 登录成功", { type: "success" });
```

- [ ] **Step 5: 校验 + Commit**

Run: `cd packages/web && pnpm typecheck && pnpm test`
Expected: 全绿（现有测试 + Task 2 的 6 个）。

```bash
git add packages/web/src/router/index.ts packages/web/src/views/login/index.vue
git commit -m "feat(web): preserve original url through login (guard redirect + WeCom OAuth stash)"
```

---

## Task 4: web — API 包装 + 路由模块

**Files:**
- Create: `packages/web/src/api/agent.ts`
- Create: `packages/web/src/router/modules/agent.ts`

- [ ] **Step 1: API 包装**

```typescript
// packages/web/src/api/agent.ts
import { http } from "@/utils/http";

export type AgentGrant = {
  id: string;
  device_name: string | null;
  agent_type: string | null;
  token_prefix: string | null;
  status: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

export type AdminAgentGrant = AgentGrant & {
  wecom_userid: string;
  role_snapshot: string;
};

export type AgentProvisionResult = {
  boot_code: string;
  expires_in: number;
  install_sh: string;
  install_ps1: string;
};

export type AgentDeviceInfo = {
  user_code: string;
  device_name: string | null;
  agent_type: string | null;
  client_info: string | null;
  status: "pending" | "approved" | "denied";
};

export const provisionAgent = (data: { device_name: string; agent_type: string }) => {
  return http.request<{ success: boolean; data: AgentProvisionResult }>(
    "post",
    "/api/v1/agent/setup/provision",
    { data }
  );
};

export const getDeviceInfo = (userCode: string) => {
  return http.request<{ success: boolean; data: AgentDeviceInfo }>(
    "get",
    "/api/v1/agent/device/info",
    { params: { user_code: userCode } }
  );
};

export const approveDevice = (userCode: string) => {
  return http.request<{ success: boolean; data: { approved: boolean } }>(
    "post",
    "/api/v1/agent/device/approve",
    { data: { user_code: userCode } }
  );
};

export const denyDevice = (userCode: string) => {
  return http.request<{ success: boolean; data: { denied: boolean } }>(
    "post",
    "/api/v1/agent/device/deny",
    { data: { user_code: userCode } }
  );
};

export const listMyAgentGrants = () => {
  return http.request<{ success: boolean; data: AgentGrant[] }>(
    "get",
    "/api/v1/agent/grants"
  );
};

export const revokeMyAgentGrant = (id: string) => {
  return http.request<{ success: boolean; data: { revoked: boolean } }>(
    "post",
    `/api/v1/agent/grants/${id}/revoke`
  );
};

export const adminListAgentGrants = () => {
  return http.request<{ success: boolean; data: AdminAgentGrant[] }>(
    "get",
    "/api/v1/admin/agent/grants"
  );
};

export const adminRevokeAgentGrant = (id: string) => {
  return http.request<{ success: boolean; data: { revoked: boolean } }>(
    "post",
    `/api/v1/admin/agent/grants/${id}/revoke`
  );
};
```

- [ ] **Step 2: 路由模块**

```typescript
// packages/web/src/router/modules/agent.ts
const Layout = () => import("@/layout/index.vue");

export default {
  path: "/agent",
  name: "Agent",
  component: Layout,
  redirect: "/agent/setup",
  meta: {
    icon: "ep:cpu",
    title: "智能体接入",
    rank: 19
  },
  children: [
    {
      path: "/agent/setup",
      name: "AgentSetup",
      component: () => import("@/views/agent/setup.vue"),
      meta: {
        title: "接入配置",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/agent/grants",
      name: "AgentGrants",
      component: () => import("@/views/agent/grants.vue"),
      meta: {
        title: "设备授权",
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    },
    {
      path: "/agent/authorize",
      name: "AgentAuthorize",
      component: () => import("@/views/agent/authorize.vue"),
      meta: {
        title: "设备授权确认",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
```

> 注意：此时三个 view 文件还不存在，typecheck 会报 import 失败——Task 4 与 Task 5–7 同一批提交前先建占位没必要，**直接顺序做完 Task 5–7 再统一校验/提交**（见 Task 7 Step 4 的合并提交）。若需中途校验，可临时注释路由模块。

---

## Task 5: web — setup.vue（生成一键安装命令）

**Files:**
- Create: `packages/web/src/views/agent/setup.vue`

- [ ] **Step 1: 写页面**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { message } from "@/utils/message";
import { provisionAgent, type AgentProvisionResult } from "@/api/agent";

defineOptions({ name: "AgentSetup" });

const AGENT_OPTIONS = [
  { value: "claude_code", label: "Claude Code（推荐）" },
  { value: "codex", label: "Codex" },
  { value: "claude_desktop", label: "Claude Desktop" },
  { value: "other", label: "其它 Agent" }
];

const agentType = ref("claude_code");
const deviceName = ref("");
const generating = ref(false);
const result = ref<AgentProvisionResult | null>(null);

const onGenerate = async () => {
  if (!deviceName.value.trim()) {
    message("请先填写设备名称（如：张三的 MacBook）", { type: "warning" });
    return;
  }
  generating.value = true;
  try {
    const res = await provisionAgent({
      device_name: deviceName.value.trim(),
      agent_type: agentType.value
    });
    result.value = res.data;
    message("安装命令已生成，10 分钟内有效", { type: "success" });
  } catch {
    message("生成失败，请稍后再试", { type: "error" });
  } finally {
    generating.value = false;
  }
};

const copyText = async (value: string | undefined) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    message("已复制", { type: "success" });
  } catch {
    message("复制失败，请手动复制", { type: "warning" });
  }
};
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div>
          <span style="font-weight: 600">智能体接入配置</span>
          <div style="margin-top: 4px; font-size: 12px; color: #909399">
            为你的 AI 编程助手（如 Claude Code）开通公司系统只读访问。授权有效期 180
            天，可随时在「设备授权」页吊销。
          </div>
        </div>
      </template>

      <el-form label-width="88px" style="max-width: 560px">
        <el-form-item label="Agent 类型">
          <el-radio-group v-model="agentType">
            <el-radio-button
              v-for="opt in AGENT_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="设备名称">
          <el-input
            v-model="deviceName"
            placeholder="如：张三的 MacBook"
            maxlength="40"
            style="width: 320px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="generating" @click="onGenerate">
            生成安装命令
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="result" shadow="never" style="margin-top: 16px">
      <template #header>
        <span style="font-weight: 600">安装命令（一次性，10 分钟内有效）</span>
      </template>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="命令包含一次性授权码，请勿转发给他人；访问令牌不会显示在屏幕上。"
        style="margin-bottom: 12px"
      />
      <div class="cmd-block">
        <div class="cmd-label">macOS / Linux（终端执行）</div>
        <el-input :model-value="result.install_sh" readonly>
          <template #append>
            <el-button @click="copyText(result.install_sh)">复制</el-button>
          </template>
        </el-input>
      </div>
      <div class="cmd-block" style="margin-top: 12px">
        <div class="cmd-label">Windows（PowerShell 执行）</div>
        <el-input :model-value="result.install_ps1" readonly>
          <template #append>
            <el-button @click="copyText(result.install_ps1)">复制</el-button>
          </template>
        </el-input>
      </div>
      <div style="margin-top: 12px; font-size: 12px; color: #909399">
        执行后安装器会自动下载 MCP、完成授权并配置所选 Agent。完成后可在
        <router-link to="/agent/grants">设备授权</router-link> 页查看或吊销。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.cmd-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: #606266;
}
</style>
```

---

## Task 6: web — authorize.vue（设备流同意页）

**Files:**
- Create: `packages/web/src/views/agent/authorize.vue`

- [ ] **Step 1: 写页面**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import {
  approveDevice,
  denyDevice,
  getDeviceInfo,
  type AgentDeviceInfo
} from "@/api/agent";

defineOptions({ name: "AgentAuthorize" });

const route = useRoute();
const userCode = ref("");
const info = ref<AgentDeviceInfo | null>(null);
const loading = ref(false);
const acting = ref(false);
const decided = ref<"approved" | "denied" | null>(null);

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_desktop: "Claude Desktop"
};

const agentLabel = (value: string | null) =>
  (value && AGENT_LABELS[value]) || value || "未知 Agent";

const normalizeCode = (raw: string) => raw.trim().toUpperCase();

const loadInfo = async () => {
  const code = normalizeCode(userCode.value);
  if (!code) {
    message("请输入设备授权码（形如 ABCD-EFGH）", { type: "warning" });
    return;
  }
  loading.value = true;
  info.value = null;
  decided.value = null;
  try {
    const res = await getDeviceInfo(code);
    info.value = res.data;
    if (res.data.status !== "pending") {
      decided.value = res.data.status === "approved" ? "approved" : "denied";
    }
  } catch {
    message("授权码无效或已过期，请回到设备上重新发起", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const onApprove = async () => {
  acting.value = true;
  try {
    await approveDevice(normalizeCode(userCode.value));
    decided.value = "approved";
    message("已授权。请回到设备上继续，令牌将自动发放。", { type: "success" });
  } catch {
    message("授权失败，授权码可能已过期", { type: "error" });
  } finally {
    acting.value = false;
  }
};

const onDeny = async () => {
  acting.value = true;
  try {
    await denyDevice(normalizeCode(userCode.value));
    decided.value = "denied";
    message("已拒绝该设备的接入请求", { type: "success" });
  } catch {
    message("操作失败，授权码可能已过期", { type: "error" });
  } finally {
    acting.value = false;
  }
};

onMounted(() => {
  const q = route.query.user_code;
  if (typeof q === "string" && q) {
    userCode.value = q;
    void loadInfo();
  }
});
</script>

<template>
  <div class="p-4" style="max-width: 640px">
    <el-card shadow="never">
      <template #header>
        <span style="font-weight: 600">设备授权确认</span>
      </template>

      <el-form label-width="88px">
        <el-form-item label="授权码">
          <el-input
            v-model="userCode"
            placeholder="ABCD-EFGH"
            style="width: 220px"
            @keyup.enter="loadInfo"
          />
          <el-button style="margin-left: 8px" :loading="loading" @click="loadInfo">
            查询
          </el-button>
        </el-form-item>
      </el-form>

      <template v-if="info">
        <el-descriptions :column="1" border style="margin-top: 8px">
          <el-descriptions-item label="设备名称">
            {{ info.device_name || "未命名设备" }}
          </el-descriptions-item>
          <el-descriptions-item label="Agent">
            {{ agentLabel(info.agent_type) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="info.client_info" label="客户端">
            {{ info.client_info }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="!decided"
          type="warning"
          :closable="false"
          show-icon
          title="授权后，该设备上的 AI 助手将以你的身份【只读】访问公司系统（项目、付款、审批、合同、库房查询）。有效期 180 天，可随时吊销。"
          style="margin-top: 12px"
        />

        <el-result
          v-if="decided === 'approved'"
          icon="success"
          title="已授权"
          sub-title="请回到设备上继续，令牌将自动发放。可关闭本页。"
        />
        <el-result
          v-else-if="decided === 'denied'"
          icon="error"
          title="已拒绝"
          sub-title="该设备的接入请求已被拒绝。可关闭本页。"
        />

        <div v-if="!decided" style="margin-top: 16px">
          <el-button type="primary" :loading="acting" @click="onApprove">
            同意授权
          </el-button>
          <el-button type="danger" plain :loading="acting" @click="onDeny">
            拒绝
          </el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>
```

---

## Task 7: web — grants.vue（授权管理）+ 统一校验提交

**Files:**
- Create: `packages/web/src/views/agent/grants.vue`

- [ ] **Step 1: 写页面**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import {
  adminListAgentGrants,
  adminRevokeAgentGrant,
  listMyAgentGrants,
  revokeMyAgentGrant,
  type AdminAgentGrant,
  type AgentGrant
} from "@/api/agent";

defineOptions({ name: "AgentGrants" });

const userStore = useUserStoreHook();
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const viewAll = ref(false);
const loading = ref(false);
const acting = ref(false);
const list = ref<Array<AgentGrant | AdminAgentGrant>>([]);

const STATUS_LABELS: Record<AgentGrant["status"], string> = {
  active: "有效",
  revoked: "已吊销",
  expired: "已过期"
};
const STATUS_TYPES: Record<AgentGrant["status"], "success" | "danger" | "info"> = {
  active: "success",
  revoked: "danger",
  expired: "info"
};

const formatTime = (value: string | null) => {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "").slice(0, 16);
};

const ownerOf = (row: AgentGrant | AdminAgentGrant) =>
  "wecom_userid" in row ? row.wecom_userid : "";

const loadData = async () => {
  loading.value = true;
  try {
    const res = viewAll.value
      ? await adminListAgentGrants()
      : await listMyAgentGrants();
    list.value = res.data;
  } catch {
    message("加载授权列表失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const onToggleViewAll = async () => {
  await loadData();
};

const onRevoke = async (row: AgentGrant | AdminAgentGrant) => {
  const label = row.device_name || row.token_prefix || row.id.slice(0, 8);
  try {
    await ElMessageBox.confirm(
      `确认吊销「${label}」的访问授权吗？该设备上的 AI 助手将立即失去访问权限。`,
      "吊销授权",
      { type: "warning" }
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    if (viewAll.value) {
      await adminRevokeAgentGrant(row.id);
    } else {
      await revokeMyAgentGrant(row.id);
    }
    message("已吊销", { type: "success" });
    await loadData();
  } catch {
    message("吊销失败", { type: "error" });
  } finally {
    acting.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-weight: 600">设备授权</span>
          <el-switch
            v-if="isSuperAdmin"
            v-model="viewAll"
            active-text="查看全部员工"
            inactive-text="仅本人"
            @change="onToggleViewAll"
          />
        </div>
      </template>

      <el-table v-loading="loading" :data="list" size="default">
        <el-table-column
          v-if="viewAll"
          label="员工"
          width="120"
        >
          <template #default="scope">{{ ownerOf(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="设备" min-width="140">
          <template #default="scope">
            {{ scope.row.device_name || "未命名设备" }}
          </template>
        </el-table-column>
        <el-table-column prop="agent_type" label="Agent" width="130">
          <template #default="scope">{{ scope.row.agent_type || "—" }}</template>
        </el-table-column>
        <el-table-column prop="token_prefix" label="令牌前缀" width="170">
          <template #default="scope">
            <code>{{ scope.row.token_prefix || "—" }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="STATUS_TYPES[scope.row.status]" size="small">
              {{ STATUS_LABELS[scope.row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="scope">{{ formatTime(scope.row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="到期时间" width="150">
          <template #default="scope">{{ formatTime(scope.row.expires_at) }}</template>
        </el-table-column>
        <el-table-column label="最近使用" width="150">
          <template #default="scope">{{ formatTime(scope.row.last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="scope">
            <el-button
              v-if="scope.row.status === 'active'"
              link
              type="danger"
              :disabled="acting"
              @click="onRevoke(scope.row)"
            >
              吊销
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && list.length === 0"
        description="暂无授权设备。到「接入配置」页生成安装命令即可接入。"
      />
    </el-card>
  </div>
</template>
```

- [ ] **Step 2: 全量校验（web）**

Run: `cd packages/web && pnpm typecheck && pnpm test && pnpm lint:eslint`
Expected: 全绿（typecheck 覆盖三个新 SFC 与路由模块 import）。

- [ ] **Step 3: 构建冒烟**

Run: `cd packages/web && pnpm build`
Expected: 构建成功（vite build 无报错）。

- [ ] **Step 4: Commit（Task 4–7 一并）**

```bash
git add packages/web/src/api/agent.ts packages/web/src/router/modules/agent.ts packages/web/src/views/agent/
git commit -m "feat(web): agent setup/authorize/grants pages + api wrappers + routes"
```

---

## Task 8: 文档 + 本地端到端冒烟

- [ ] **Step 1: 本地端到端冒烟（设备流全链路，无需企业微信）**

前置：两个终端分别 `npm run dev:api`（8787，本地 APP_ENV=local 有免 code 登录旁路）、`npm run dev:web`（8849）。

1. 浏览器开 `http://localhost:8849`，用本地旁路登录。
2. `#/agent/setup`：选 Claude Code、填设备名 → 生成 → 出现两条命令、复制按钮可用（**boot_code 只校验生成，不必真装**）。
3. 模拟 CLI 发起设备流：
   ```bash
   curl -s -X POST http://localhost:8787/api/v1/agent/device/code \
     -H "content-type: application/json" \
     -d '{"device_name":"本地测试机","agent_type":"claude_code"}'
   ```
   记下返回的 `user_code`、`device_code`。
4. 开 `http://localhost:8849/#/agent/authorize?user_code=<user_code>`：应自动查询并显示"本地测试机 / Claude Code"；点「同意授权」。
5. 轮询验证发放：
   ```bash
   curl -s -X POST http://localhost:8787/api/v1/agent/device/token \
     -H "content-type: application/json" \
     -d '{"device_code":"<device_code>"}'
   ```
   Expected: `status:"granted"` 且带 `agent_token`。
6. 再发起一轮 device/code，本次在 authorize 页点「拒绝」→ 轮询应返回 `status:"denied"`。
7. `#/agent/grants`：看到步骤 5 产生的 grant（active）→ 点「吊销」→ 状态变已吊销。super_admin 账号打开「查看全部员工」开关验证 admin 列表。
8. **redirect 贯通**：登出后直接访问 `http://localhost:8849/#/agent/authorize?user_code=TEST-CODE`，应跳登录页；本地旁路登录后应回到 authorize 页（query 保留）。

- [ ] **Step 2: 更新文档**

- `doc/UI设计文档.md`：新增「智能体接入」章节——三页的用途、入口（菜单：接入配置/设备授权；authorize 由 CLI 链接进入）、关键交互（生成命令一次性 10 分钟、同意/拒绝、吊销即时生效、super_admin 全员视图）。
- `doc/开发记录.md`：追加 P1c 条目（日期、三页 + 两端点 + redirect 贯通、验证方式）。

- [ ] **Step 3: 最终校验 + Commit**

Run: `cd packages/api && npm test && npm run typecheck && cd ../web && pnpm typecheck && pnpm test`
Expected: 全绿。

```bash
git add doc/UI设计文档.md doc/开发记录.md
git commit -m "docs: P1c 智能体接入三页 UI 说明 + 开发记录"
```

---

## Self-Review 记录（对照 spec）

- **spec §3.2 `views/agent/setup.vue`（选 agent+命名→一键命令）** → Task 5 ✅（命令来自 provision 响应，含 `&agent=`；令牌不落屏）
- **spec §3.2 `views/agent/authorize.vue`（输码授权同意页）** → Task 6 ✅（展示设备名/Agent、同意/拒绝；spec §5.2 的"设备名+姓名"卡片——姓名即当前登录者本人，不需展示）
- **spec §3.2 `views/agent/grants.vue`（本人列表/吊销；super_admin 全部）** → Task 7 ✅
- **spec §5.2 拒绝路径** → `DeviceStatus.denied` 已在 P1a 类型/轮询中预留，Task 1 补 deny 端点闭环 ✅
- **同意页需要设备信息展示** → spec 端点清单缺口，Task 1 的 `GET /device/info` 补上（JWT+human-only，最小暴露）✅
- **未登录打开 authorize 链接** → Task 2/3 redirect 贯通（hash 丢失 → sessionStorage；白名单防开放重定向）✅
- **`views/agent/confirm.vue`** → P2 范围，不在本计划 ✅
- 类型一致性：`AgentGrant`/`AdminAgentGrant` 字段与 api `PublicGrantView`/`AdminGrantView` 逐字段对齐；`AgentDeviceInfo.status` 与 `DeviceStatus` 对齐；Task 4 wrappers 与 Task 5–7 的 import 名一致（`provisionAgent/getDeviceInfo/approveDevice/denyDevice/listMyAgentGrants/revokeMyAgentGrant/adminListAgentGrants/adminRevokeAgentGrant`）✅
- 占位扫描：无 TBD/TODO/"适当处理" ✅

## 开放问题 / 待评审确认

1. 菜单可见性：`/agent/setup`、`/agent/grants` 对全员显示（rank 19，账号安全 18 旁）。P2 前存在"运营性冻结"（不发放生产令牌）——**页面上线即全员可自助开通**，是否需要在合并/部署时暂时 `showLink:false` 或加角色限制？（建议：部署时全模块 `showLink:false`，P2 就绪后放开——一行改动）
2. `GET /device/info` 会暴露设备名/agent 类型给任何登录员工（知道 user_code 者）。user_code 8 字符随机、10 分钟 TTL，风险可接受；如需更严可后续加"仅拒绝重试限流"。
3. grants 列表无分页（与后端一致，员工设备数少；admin 全量列表数据量可控）。需要时后续加。
