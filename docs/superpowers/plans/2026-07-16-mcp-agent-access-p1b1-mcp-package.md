# MCP 智能体接入 — P1b-1：`@hybc/mcp` 客户端包 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 monorepo 包 `@hybc/mcp`：一个本地 stdio MCP server，含 `login`（设备授权码流程）、凭证存储、一批**只读**工具（项目/付款/审批/合同/库房），以及 agent 无关的 `instructions` + Claude Code 用的 `SKILL.md`。

**Architecture:** 纯 Node/TypeScript 包。`login` 走 P1a 的 `/api/v1/agent/device/code`+`/device/token` 设备流，把 6 个月令牌写入 `~/.hybc/credentials.json`(600)。stdio 模式下用该令牌作 `Bearer` 调 `https://api.hybcdg.com/api/v1/*` 只读端点，结果以 JSON 文本返回给智能体。工具处理器是纯函数（注入 `HybcApiClient`），可脱离 MCP SDK 单测。

**Tech Stack:** TypeScript 5（ESM）、`@modelcontextprotocol/sdk` v1.x（`McpServer`/`registerTool`/`StdioServerTransport`）、`zod` v3（工具入参 schema）、vitest（复用仓库测试约定，mock 全局 `fetch`）、Node ≥18（内置 `fetch`）。

> **⚠️ 包内导入约定（NodeNext，实现期发现，必须遵守）**：本包 `tsconfig` 用 `module/moduleResolution: NodeNext`。因此**所有非测试源文件（`.ts`，非 `.test.ts`）里的相对导入必须带显式 `.js` 后缀**——例如 `from "./config.js"`、`from "../api-client.js"`、`from "./types.js"`、`from "./tools/index.js"`。下文各 Task 的代码块为可读性写成了无后缀相对导入（如 `from "./config"`），**实现时一律补上 `.js`**，否则 `tsc` 报 TS2835。**测试文件（`*.test.ts`）保持无后缀**即可（被 `tsc` exclude，vitest/esbuild 运行时能解析）。`@modelcontextprotocol/sdk/server/mcp.js` 这类已经带 `.js` 的第三方子路径导入保持原样。

> **范围**：仅 `@hybc/mcp` 包（客户端 + 只读工具）。分发（R2 bundle、真实 install.sh/ps1、构建发布脚本）见 **P1b-2**。写工具 + 高危微信闸门见 **P2**。
> **只读约束（对齐运营性冻结）**：本包**只暴露 GET/只读工具**。写操作（付款/审批/建单）留到 P2 且需微信闸门。这与 P1a erratum、spec §13 一致。

---

## 端点契约参考（P1a 已落地，实现按此对齐）

- Base：`https://api.hybcdg.com`，前缀 `/api/v1`。鉴权头 `Authorization: Bearer <token>`（agent 令牌形如 `hybc_agent_*`）。
- 成功信封：`{ success:true, data:<T> }`；列表附**同级** `pagination:{page,pageSize,total}`。错误：`{ success:false, error:{ message } }`。
- 分页参数：`page`（默认1）、`pageSize`（默认20，项目上限100）。
- 设备流：`POST /agent/device/code` → `{device_code,user_code,verification_uri,verification_uri_complete,expires_in,interval}`；`POST /agent/device/token` body `{device_code}` → `data.status ∈ {authorization_pending, denied, expired, granted}`，granted 时含 `{agent_token, wecom_userid, role}`（一次性）。
- 只读端点（工具用，均需有效令牌；角色门见 P1a recon）：
  - `GET /project`（q: keyword,status,project_kind,page,pageSize）、`GET /project/:id`、`GET /project/:id/financial-summary`
  - `GET /payment`（q: status,project_id,contract_id,keyword,mine,date_from,date_to,page,pageSize）、`GET /payment/:id`
  - `GET /approval`（q: biz_type,status,initiator,keyword,page,pageSize）、`GET /approval/pending`、`GET /approval/:id`
  - `GET /contract`（q: direction,project_id,status,keyword,date_from,date_to,page,pageSize）、`GET /contract/:id`
  - `GET /warehouse/inventory`（q: warehouse_id,asset_type_id）、`GET /warehouse/inventory/alert`、`GET /warehouse/stock-order`（q: status,order_type）

---

## 文件结构

**新建包 `packages/mcp/`**
- `package.json` — `@hybc/mcp`，ESM，deps: `@modelcontextprotocol/sdk`、`zod`；scripts: build/typecheck/lint/test
- `tsconfig.json` — ESM、`nodenext`、strict
- `src/config.ts` — 解析 base URL + 凭证路径（支持 env 覆盖便于测试）
- `src/credentials.ts` — 读/写/清 `~/.hybc/credentials.json`(600)
- `src/api-client.ts` — `buildUrl`、`HybcApiClient`（get/post，信封解包，`ApiError`）
- `src/device-login.ts` — `runLogin`（设备流状态机；注入 sleep/now/openBrowser 便于测试）
- `src/tools/types.ts` — `ToolDef`、`textResult`、`QueryParams` 复用
- `src/tools/projects.ts` / `payments.ts` / `contracts.ts` / `approvals.ts` / `warehouse.ts` — 各域只读工具
- `src/tools/index.ts` — `allToolDefs(client)`、`registerAllTools(server, client)`
- `src/instructions.ts` — MCP `instructions` 文本（agent 无关指引）
- `src/server.ts` — `buildServer(client)`：`McpServer` + 注册工具 + instructions
- `src/cli.ts` — `runCli(argv, deps)` 分发 login/logout/whoami/serve + 真入口
- `SKILL.md` — Claude Code 增强指引
- 各 `*.test.ts` 与源文件同目录

**修改**
- 根 `package.json` — workspaces 已是 `packages/*`，无需改；如需便捷脚本可加 `dev:mcp`（可选，非必须）

---

## Task 1: 包脚手架 + 依赖安装

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/.gitignore`

- [ ] **Step 1: 写 `packages/mcp/package.json`**

```json
{
  "name": "@hybc/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "hybc-mcp": "./dist/cli.js"
  },
  "main": "./dist/server.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.3",
    "vitest": "^3.2.4"
  }
}
```

> 注：`@modelcontextprotocol/sdk` 必须用 **1.x 稳定线**（`McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`、`registerTool` 用 zod raw-shape `inputSchema`）。不要用 2.x-alpha（导入路径不同）。

- [ ] **Step 2: 写 `packages/mcp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: 写 `packages/mcp/.gitignore`**

```
dist/
node_modules/
```

- [ ] **Step 4: 安装依赖（在仓库根，workspace 感知）**

Run: `cd /Users/zihaoliu/Documents/Code/hybc_core && npm install`
Expected: `@hybc/mcp` 被纳入 workspace，`@modelcontextprotocol/sdk` 与 `zod` 安装成功，无错误。记下实际安装的 sdk 版本。

- [ ] **Step 5: 冒烟——确认包被识别**

Run: `npm ls @hybc/mcp -w @hybc/mcp 2>/dev/null || ls packages/mcp`
Expected: 能看到 `@hybc/mcp` 包目录。

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/.gitignore package-lock.json
git commit -m "chore(mcp): scaffold @hybc/mcp package"
```

---

## Task 2: `config.ts`（TDD）

**Files:**
- Create: `packages/mcp/src/config.ts`
- Test: `packages/mcp/src/config.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// config.test.ts
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_BASE_URL, resolveBaseUrl, resolveCredentialsPath } from "./config";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("config", () => {
  it("prefers HYBC_API_BASE_URL env, then stored, then default", () => {
    delete process.env.HYBC_API_BASE_URL;
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl("https://stored.example")).toBe("https://stored.example");
    process.env.HYBC_API_BASE_URL = "https://env.example";
    expect(resolveBaseUrl("https://stored.example")).toBe("https://env.example");
  });

  it("credentials path honors HYBC_CREDENTIALS_PATH override", () => {
    delete process.env.HYBC_CREDENTIALS_PATH;
    expect(resolveCredentialsPath().endsWith("/.hybc/credentials.json")).toBe(true);
    process.env.HYBC_CREDENTIALS_PATH = "/tmp/creds.json";
    expect(resolveCredentialsPath()).toBe("/tmp/creds.json");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/config.test.ts`
Expected: FAIL（`Cannot find module './config'`）。

- [ ] **Step 3: 实现**

```typescript
// config.ts
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.hybcdg.com";

export const resolveBaseUrl = (stored?: string): string =>
  process.env.HYBC_API_BASE_URL?.trim() || stored?.trim() || DEFAULT_BASE_URL;

export const resolveCredentialsPath = (): string =>
  process.env.HYBC_CREDENTIALS_PATH?.trim() || join(homedir(), ".hybc", "credentials.json");
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/config.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/config.ts packages/mcp/src/config.test.ts
git commit -m "feat(mcp): add config (base url + credentials path resolution)"
```

---

## Task 3: `credentials.ts`（TDD）

**Files:**
- Create: `packages/mcp/src/credentials.ts`
- Test: `packages/mcp/src/credentials.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// credentials.test.ts
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCredentials, readCredentials, saveCredentials } from "./credentials";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hybc-mcp-"));
  path = join(dir, "credentials.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("credentials", () => {
  it("returns null when file is absent", async () => {
    expect(await readCredentials(path)).toBeNull();
  });

  it("round-trips and writes 0600 perms", async () => {
    const creds = {
      baseUrl: "https://api.hybcdg.com",
      token: "hybc_agent_abc",
      wecomUserid: "MaxLiu",
      role: "finance",
      savedAt: "2026-07-16T00:00:00.000Z"
    };
    await saveCredentials(creds, path);
    const back = await readCredentials(path);
    expect(back).toEqual(creds);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clear removes the file (idempotent)", async () => {
    await saveCredentials(
      {
        baseUrl: "b",
        token: "t",
        wecomUserid: "u",
        role: "operator",
        savedAt: "s"
      },
      path
    );
    await clearCredentials(path);
    expect(await readCredentials(path)).toBeNull();
    await clearCredentials(path); // no throw on missing
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/credentials.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// credentials.ts
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveCredentialsPath } from "./config";

export interface StoredCredentials {
  baseUrl: string;
  token: string;
  wecomUserid: string;
  role: string;
  savedAt: string;
}

export const readCredentials = async (
  path: string = resolveCredentialsPath()
): Promise<StoredCredentials | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
};

export const saveCredentials = async (
  creds: StoredCredentials,
  path: string = resolveCredentialsPath()
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
};

export const clearCredentials = async (
  path: string = resolveCredentialsPath()
): Promise<void> => {
  await rm(path, { force: true });
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/credentials.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/credentials.ts packages/mcp/src/credentials.test.ts
git commit -m "feat(mcp): add credential store (~/.hybc/credentials.json, 0600)"
```

---

## Task 4: `api-client.ts`（TDD）

**Files:**
- Create: `packages/mcp/src/api-client.ts`
- Test: `packages/mcp/src/api-client.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// api-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, buildUrl, HybcApiClient } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

describe("buildUrl", () => {
  it("joins base + path and appends non-empty query", () => {
    const url = buildUrl("https://api.hybcdg.com", "/api/v1/project", {
      keyword: "road",
      page: 2,
      status: undefined,
      empty: ""
    });
    expect(url).toBe("https://api.hybcdg.com/api/v1/project?keyword=road&page=2");
  });
});

describe("HybcApiClient", () => {
  it("GET unwraps {data, pagination} and sends Bearer token", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://api.hybcdg.com/api/v1/project?page=1");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer hybc_agent_x"
      );
      return jsonResponse({
        success: true,
        data: [{ id: 1 }],
        pagination: { page: 1, pageSize: 20, total: 1 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HybcApiClient("https://api.hybcdg.com", "hybc_agent_x");
    const res = await client.get<Array<{ id: number }>>("/project", { page: 1 });
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });

  it("throws ApiError with server message on {success:false}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, error: { message: "Forbidden" } }, 403)
      )
    );
    const client = new HybcApiClient("https://api.hybcdg.com", "t");
    await expect(client.get("/payment/console-summary")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Forbidden"
    });
  });

  it("POST sends JSON body and works without a token", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ device_code: "d1" });
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
      return jsonResponse({ success: true, data: { status: "authorization_pending" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HybcApiClient("https://api.hybcdg.com", null);
    const res = await client.post<{ status: string }>("/agent/device/token", {
      device_code: "d1"
    });
    expect(res.data.status).toBe("authorization_pending");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/api-client.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// api-client.ts
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface Envelope<T> {
  data: T;
  pagination?: Pagination;
}

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export const buildUrl = (
  baseUrl: string,
  path: string,
  query?: QueryParams
): string => {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + p);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

interface RawEnvelope {
  success?: boolean;
  data?: unknown;
  pagination?: Pagination;
  error?: { message?: string };
}

export class HybcApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async get<T>(path: string, query?: QueryParams): Promise<Envelope<T>> {
    return this.request<T>("GET", path, query);
  }

  async post<T>(path: string, body?: unknown, query?: QueryParams): Promise<Envelope<T>> {
    return this.request<T>("POST", path, query, body ?? {});
  }

  private async request<T>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown
  ): Promise<Envelope<T>> {
    const fullPath = path.startsWith("/api/") ? path : `/api/v1${path}`;
    const url = buildUrl(this.baseUrl, fullPath, query);
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let json: RawEnvelope | null = null;
    try {
      json = (await res.json()) as RawEnvelope;
    } catch {
      json = null;
    }

    if (!res.ok || json?.success === false) {
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      throw new ApiError(message, res.status);
    }

    return { data: json?.data as T, pagination: json?.pagination };
  }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/api-client.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/api-client.ts packages/mcp/src/api-client.test.ts
git commit -m "feat(mcp): add HybcApiClient (envelope unwrap, bearer, ApiError)"
```

---

## Task 5: `device-login.ts`（TDD）

**Files:**
- Create: `packages/mcp/src/device-login.ts`
- Test: `packages/mcp/src/device-login.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// device-login.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { runLogin } from "./device-login";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

describe("runLogin", () => {
  it("starts device code, polls until granted, returns token", async () => {
    const responses = [
      // POST /agent/device/code
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "https://web.hybcdg.com/agent/authorize",
          verification_uri_complete:
            "https://web.hybcdg.com/agent/authorize?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      }),
      // poll 1 -> pending
      jsonResponse({ success: true, data: { status: "authorization_pending" } }),
      // poll 2 -> granted
      jsonResponse({
        success: true,
        data: {
          status: "granted",
          agent_token: "hybc_agent_new",
          wecom_userid: "MaxLiu",
          role: "manager"
        }
      })
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);

    const logs: string[] = [];
    const result = await runLogin({
      baseUrl: "https://api.hybcdg.com",
      deviceName: "Max MacBook",
      agentType: "claude_code",
      sleep: async () => undefined,
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
      openBrowser: () => undefined,
      log: (m) => logs.push(m)
    });

    expect(result).toEqual({
      token: "hybc_agent_new",
      wecomUserid: "MaxLiu",
      role: "manager"
    });
    expect(logs.join("\n")).toContain("ABCD-2345");
    // 1 start + 2 polls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws on denied", async () => {
    const responses = [
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "x",
          verification_uri_complete: "x?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      }),
      jsonResponse({ success: true, data: { status: "denied" } })
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    await expect(
      runLogin({
        baseUrl: "https://api.hybcdg.com",
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => (t += 1000);
        })(),
        openBrowser: () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/拒绝|denied/i);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/device-login.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**

```typescript
// device-login.ts
import { HybcApiClient } from "./api-client";

export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "authorization_pending" | "denied" | "expired" }
  | { status: "granted"; agent_token: string; wecom_userid: string; role: string };

export interface LoginOptions {
  baseUrl: string;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  openBrowser?: (url: string) => void;
  log?: (message: string) => void;
}

export interface LoginResult {
  token: string;
  wecomUserid: string;
  role: string;
}

export const runLogin = async (opts: LoginOptions): Promise<LoginResult> => {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));

  const client = new HybcApiClient(opts.baseUrl, null);
  const start = (
    await client.post<DeviceCodeResult>("/agent/device/code", {
      device_name: opts.deviceName,
      agent_type: opts.agentType,
      client_info: opts.clientInfo
    })
  ).data;

  log(
    `请在浏览器打开并用企业微信登录授权：\n  ${start.verification_uri_complete}\n设备码：${start.user_code}（${Math.round(
      start.expires_in / 60
    )} 分钟内有效）`
  );
  opts.openBrowser?.(start.verification_uri_complete);

  const deadline = now() + start.expires_in * 1000;
  const intervalMs = start.interval * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    const poll = (
      await client.post<PollResult>("/agent/device/token", {
        device_code: start.device_code
      })
    ).data;
    if (poll.status === "granted") {
      return {
        token: poll.agent_token,
        wecomUserid: poll.wecom_userid,
        role: poll.role
      };
    }
    if (poll.status === "denied") throw new Error("授权被拒绝（denied）");
    if (poll.status === "expired") throw new Error("设备码已过期，请重新登录");
    // authorization_pending -> keep polling
  }
  throw new Error("授权超时，请重新登录");
};
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/device-login.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/device-login.ts packages/mcp/src/device-login.test.ts
git commit -m "feat(mcp): add device-authorization login flow"
```

---

## Task 6: 工具基座 + 项目工具（TDD，确立模式）

**Files:**
- Create: `packages/mcp/src/tools/types.ts`
- Create: `packages/mcp/src/tools/projects.ts`
- Test: `packages/mcp/src/tools/projects.test.ts`

- [ ] **Step 1: 写工具基座 `tools/types.ts`（无 TDD，被后续复用）**

```typescript
// tools/types.ts
import type { z } from "zod";

import type { HybcApiClient } from "../api-client";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (
    args: Record<string, unknown>
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export const textResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
});

export type ToolFactory = (client: HybcApiClient) => ToolDef[];
```

- [ ] **Step 2: 写失败测试 `tools/projects.test.ts`**

```typescript
// tools/projects.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { projectTools } from "./projects";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);

const byName = (client: HybcApiClient, name: string) =>
  projectTools(client).find((t) => t.name === name)!;

describe("projectTools", () => {
  it("search_projects calls GET /project with filters and returns items+pagination", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, project_name: "road" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    const tool = byName(fakeClient(get), "search_projects");
    const res = await tool.handler({ keyword: "road", page: 1 });
    expect(get).toHaveBeenCalledWith("/project", { keyword: "road", page: 1 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.pagination.total).toBe(1);
  });

  it("get_project calls GET /project/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 7, project_name: "x" } }));
    const tool = byName(fakeClient(get), "get_project");
    const res = await tool.handler({ id: 7 });
    expect(get).toHaveBeenCalledWith("/project/7");
    expect(JSON.parse(res.content[0].text).id).toBe(7);
  });

  it("exposes exactly the expected project tools", () => {
    const names = projectTools(fakeClient(vi.fn())).map((t) => t.name).sort();
    expect(names).toEqual(
      ["get_project", "get_project_financial_summary", "search_projects"].sort()
    );
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/tools/projects.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 4: 实现 `tools/projects.ts`**

```typescript
// tools/projects.ts
import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client";
import { textResult, type ToolDef } from "./types";

export const projectTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "search_projects",
    title: "搜索项目",
    description:
      "分页搜索项目列表。可按关键词(项目名/编号)、状态、类型(internal/external)、地点过滤。返回 items + pagination。",
    inputSchema: {
      keyword: z.string().optional().describe("项目名或编号关键词"),
      status: z.string().optional().describe("项目状态，如 active/planning/archived"),
      project_kind: z.enum(["internal", "external"]).optional(),
      location: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/project", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_project",
    title: "项目详情",
    description: "按数字 id 获取单个项目的完整详情。",
    inputSchema: { id: z.number().int().describe("项目 id") },
    handler: async (args) => {
      const env = await client.get(`/project/${args.id as number}`);
      return textResult(env.data);
    }
  },
  {
    name: "get_project_financial_summary",
    title: "项目财务概览",
    description:
      "获取某项目的财务汇总：对外已付、对内已收/已开票、报销额、收据数。",
    inputSchema: { id: z.number().int().describe("项目 id") },
    handler: async (args) => {
      const env = await client.get(`/project/${args.id as number}/financial-summary`);
      return textResult(env.data);
    }
  }
];
```

- [ ] **Step 5: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/tools/projects.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/types.ts packages/mcp/src/tools/projects.ts packages/mcp/src/tools/projects.test.ts
git commit -m "feat(mcp): add tool base + project read tools"
```

---

## Task 7: 付款 + 合同工具（TDD）

**Files:**
- Create: `packages/mcp/src/tools/payments.ts`
- Create: `packages/mcp/src/tools/contracts.ts`
- Test: `packages/mcp/src/tools/payments.test.ts`
- Test: `packages/mcp/src/tools/contracts.test.ts`

- [ ] **Step 1: 写失败测试 `tools/payments.test.ts`**

```typescript
// tools/payments.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { paymentTools } from "./payments";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  paymentTools(c).find((t) => t.name === n)!;

describe("paymentTools", () => {
  it("list_payments passes filters to GET /payment", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, serial_no: "PT-1" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    const res = await byName(fakeClient(get), "list_payments").handler({
      status: "pending_approval",
      project_id: 5,
      mine: true
    });
    expect(get).toHaveBeenCalledWith("/payment", {
      status: "pending_approval",
      project_id: 5,
      mine: true
    });
    expect(JSON.parse(res.content[0].text).items[0].serial_no).toBe("PT-1");
  });

  it("get_payment calls GET /payment/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 9 } }));
    await byName(fakeClient(get), "get_payment").handler({ id: 9 });
    expect(get).toHaveBeenCalledWith("/payment/9");
  });

  it("exposes list_payments + get_payment", () => {
    expect(paymentTools(fakeClient(vi.fn())).map((t) => t.name).sort()).toEqual([
      "get_payment",
      "list_payments"
    ]);
  });
});
```

- [ ] **Step 2: 写失败测试 `tools/contracts.test.ts`**

```typescript
// tools/contracts.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { contractTools } from "./contracts";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  contractTools(c).find((t) => t.name === n)!;

describe("contractTools", () => {
  it("list_contracts passes direction/project filters to GET /contract", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1, contract_no: "C-1" }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    await byName(fakeClient(get), "list_contracts").handler({
      direction: "outbound",
      project_id: 5
    });
    expect(get).toHaveBeenCalledWith("/contract", {
      direction: "outbound",
      project_id: 5
    });
  });

  it("get_contract calls GET /contract/:id", async () => {
    const get = vi.fn(async () => ({ data: { id: 3 } }));
    await byName(fakeClient(get), "get_contract").handler({ id: 3 });
    expect(get).toHaveBeenCalledWith("/contract/3");
  });
});
```

- [ ] **Step 3: 运行，确认两个测试都失败**

Run: `cd packages/mcp && npm test -- src/tools/payments.test.ts src/tools/contracts.test.ts`
Expected: FAIL（modules not found）。

- [ ] **Step 4: 实现 `tools/payments.ts`**

```typescript
// tools/payments.ts
import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client";
import { textResult, type ToolDef } from "./types";

export const paymentTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_payments",
    title: "付款申请列表",
    description:
      "分页查询付款申请。可按状态、项目、合同、关键词(编号/内容)、是否本人(mine)、日期区间过滤。默认排除已取消。",
    inputSchema: {
      status: z.string().optional().describe("draft/pending_approval/approved/paid/rejected"),
      project_id: z.number().int().optional(),
      contract_id: z.number().int().optional(),
      keyword: z.string().optional(),
      mine: z.boolean().optional().describe("仅本人发起的"),
      date_from: z.string().optional().describe("预计付款日起(YYYY-MM-DD)"),
      date_to: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).optional()
    },
    handler: async (args) => {
      const env = await client.get("/payment", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_payment",
    title: "付款申请详情",
    description: "按 id 获取付款申请详情（含合同、收款方摘要）。",
    inputSchema: { id: z.number().int().describe("付款申请 id") },
    handler: async (args) => {
      const env = await client.get(`/payment/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
```

- [ ] **Step 5: 实现 `tools/contracts.ts`**

```typescript
// tools/contracts.ts
import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client";
import { textResult, type ToolDef } from "./types";

export const contractTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_contracts",
    title: "合同列表",
    description:
      "分页查询合同。可按方向(outbound/inbound)、项目、实体、状态、关键词(编号/对方/备注)、日期区间过滤。已删除的不返回。",
    inputSchema: {
      direction: z.enum(["outbound", "inbound"]).optional(),
      project_id: z.number().int().optional(),
      entity_id: z.number().int().optional(),
      status: z.string().optional(),
      keyword: z.string().optional(),
      date_from: z.string().optional().describe("合同日期起(YYYY-MM-DD)"),
      date_to: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).optional()
    },
    handler: async (args) => {
      const env = await client.get("/contract", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_contract",
    title: "合同详情",
    description: "按 id 获取合同详情（含金额变更记录、关联付款）。",
    inputSchema: { id: z.number().int().describe("合同 id") },
    handler: async (args) => {
      const env = await client.get(`/contract/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
```

- [ ] **Step 6: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/tools/payments.test.ts src/tools/contracts.test.ts`
Expected: PASS（payments 3 passed、contracts 2 passed）。

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/tools/payments.ts packages/mcp/src/tools/contracts.ts packages/mcp/src/tools/payments.test.ts packages/mcp/src/tools/contracts.test.ts
git commit -m "feat(mcp): add payment + contract read tools"
```

---

## Task 8: 审批 + 库房工具（TDD）

**Files:**
- Create: `packages/mcp/src/tools/approvals.ts`
- Create: `packages/mcp/src/tools/warehouse.ts`
- Test: `packages/mcp/src/tools/approvals.test.ts`
- Test: `packages/mcp/src/tools/warehouse.test.ts`

- [ ] **Step 1: 写失败测试 `tools/approvals.test.ts`**

```typescript
// tools/approvals.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { approvalTools } from "./approvals";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  approvalTools(c).find((t) => t.name === n)!;

describe("approvalTools", () => {
  it("list_my_approvals hits GET /approval with filters", async () => {
    const get = vi.fn(async () => ({
      data: [{ id: 1 }],
      pagination: { page: 1, pageSize: 20, total: 1 }
    }));
    await byName(fakeClient(get), "list_my_approvals").handler({
      biz_type: "payment",
      initiator: "me"
    });
    expect(get).toHaveBeenCalledWith("/approval", {
      biz_type: "payment",
      initiator: "me"
    });
  });

  it("list_pending_approvals hits GET /approval/pending", async () => {
    const get = vi.fn(async () => ({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0 }
    }));
    await byName(fakeClient(get), "list_pending_approvals").handler({});
    expect(get).toHaveBeenCalledWith("/approval/pending", {});
  });

  it("get_approval hits GET /approval/:id", async () => {
    const get = vi.fn(async () => ({ data: { instance: { id: 4 } } }));
    await byName(fakeClient(get), "get_approval").handler({ id: 4 });
    expect(get).toHaveBeenCalledWith("/approval/4");
  });
});
```

- [ ] **Step 2: 写失败测试 `tools/warehouse.test.ts`**

```typescript
// tools/warehouse.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "../api-client";
import { warehouseTools } from "./warehouse";

const fakeClient = (get: ReturnType<typeof vi.fn>) =>
  ({ get } as unknown as HybcApiClient);
const byName = (c: HybcApiClient, n: string) =>
  warehouseTools(c).find((t) => t.name === n)!;

describe("warehouseTools", () => {
  it("warehouse_inventory hits GET /warehouse/inventory with filters", async () => {
    const get = vi.fn(async () => ({ data: [{ id: 1, quantity: 3 }] }));
    const res = await byName(fakeClient(get), "warehouse_inventory").handler({
      warehouse_id: 2
    });
    expect(get).toHaveBeenCalledWith("/warehouse/inventory", { warehouse_id: 2 });
    // 非分页端点：直接返回数组
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: 1, quantity: 3 }]);
  });

  it("warehouse_low_stock hits GET /warehouse/inventory/alert", async () => {
    const get = vi.fn(async () => ({ data: [] }));
    await byName(fakeClient(get), "warehouse_low_stock").handler({});
    expect(get).toHaveBeenCalledWith("/warehouse/inventory/alert", {});
  });

  it("list_stock_orders hits GET /warehouse/stock-order", async () => {
    const get = vi.fn(async () => ({ data: [] }));
    await byName(fakeClient(get), "list_stock_orders").handler({ status: "pending" });
    expect(get).toHaveBeenCalledWith("/warehouse/stock-order", { status: "pending" });
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/tools/approvals.test.ts src/tools/warehouse.test.ts`
Expected: FAIL（modules not found）。

- [ ] **Step 4: 实现 `tools/approvals.ts`**

```typescript
// tools/approvals.ts
import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client";
import { textResult, type ToolDef } from "./types";

export const approvalTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_my_approvals",
    title: "我相关的审批",
    description:
      "分页查询与我相关(发起或待我处理)的审批实例。可按业务类型、状态、发起人(me)、关键词过滤。",
    inputSchema: {
      biz_type: z.string().optional().describe("如 payment/contract/reimbursement"),
      status: z.string().optional(),
      initiator: z.string().optional().describe('传 "me" 只看我发起的'),
      keyword: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).optional()
    },
    handler: async (args) => {
      const env = await client.get("/approval", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "list_pending_approvals",
    title: "待我审批",
    description: "分页查询当前待我处理(pending)的审批任务。",
    inputSchema: {
      biz_type: z.string().optional(),
      keyword: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).optional()
    },
    handler: async (args) => {
      const env = await client.get("/approval/pending", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_approval",
    title: "审批详情",
    description:
      "按审批实例 id 获取完整详情（实例、模板、各节点、任务、转办、AI 门评审、可用动作）。",
    inputSchema: { id: z.number().int().describe("审批实例 id") },
    handler: async (args) => {
      const env = await client.get(`/approval/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
```

- [ ] **Step 5: 实现 `tools/warehouse.ts`**

```typescript
// tools/warehouse.ts
import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client";
import { textResult, type ToolDef } from "./types";

export const warehouseTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "warehouse_inventory",
    title: "库存查询",
    description: "查询库存（可按库房、资产类型过滤）。返回库存行数组（非分页）。",
    inputSchema: {
      warehouse_id: z.number().int().optional(),
      asset_type_id: z.number().int().optional()
    },
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "warehouse_low_stock",
    title: "低库存告警",
    description: "查询低于最小库存阈值的库存行。",
    inputSchema: {},
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory/alert", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "list_stock_orders",
    title: "出入库单列表",
    description: "查询出入库/调拨单。可按状态、单据类型过滤。返回数组（非分页）。",
    inputSchema: {
      status: z.string().optional(),
      order_type: z.string().optional()
    },
    handler: async (args) => {
      const env = await client.get("/warehouse/stock-order", args as QueryParams);
      return textResult(env.data);
    }
  }
];
```

- [ ] **Step 6: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/tools/approvals.test.ts src/tools/warehouse.test.ts`
Expected: PASS（approvals 3 passed、warehouse 3 passed）。

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/tools/approvals.ts packages/mcp/src/tools/warehouse.ts packages/mcp/src/tools/approvals.test.ts packages/mcp/src/tools/warehouse.test.ts
git commit -m "feat(mcp): add approval + warehouse read tools"
```

---

## Task 9: 指引 + server 装配（TDD）

**Files:**
- Create: `packages/mcp/src/instructions.ts`
- Create: `packages/mcp/src/tools/index.ts`
- Create: `packages/mcp/src/server.ts`
- Test: `packages/mcp/src/server.test.ts`

- [ ] **Step 1: 写 `instructions.ts`（无 TDD，数据）**

```typescript
// instructions.ts
export const INSTRUCTIONS = [
  "你正通过恒越百川(HYBC)MCP 以某位员工的身份访问公司后台系统。",
  "当前版本只提供【只读】工具：项目、付款、审批、合同、库房查询。没有写操作。",
  "使用要点：",
  "- 金额单位为元；付款/合同状态、审批状态请原样呈现给用户，不要臆测。",
  "- 列表工具返回 { items, pagination }；需要更多结果时用 page/pageSize 翻页，不要假设已全部返回。",
  "- 你能看到的数据受该员工 RBAC 角色限制；遇到 403 说明其角色无权访问该数据，如实告知用户，不要重试绕过。",
  "- 未登录或令牌过期时工具会报错，提示用户在终端运行 `hybc-mcp login` 重新授权(有效期约 6 个月)。",
  "- 涉及资金/审批的写操作尚未开放(后续版本将要求本人微信确认)；用户要求执行写操作时，说明当前只读并引导其在网页端完成。"
].join("\n");
```

- [ ] **Step 2: 写 `tools/index.ts`（无 TDD，装配）**

```typescript
// tools/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { HybcApiClient } from "../api-client";
import { approvalTools } from "./approvals";
import { contractTools } from "./contracts";
import { paymentTools } from "./payments";
import { projectTools } from "./projects";
import type { ToolDef } from "./types";
import { warehouseTools } from "./warehouse";

export const allToolDefs = (client: HybcApiClient): ToolDef[] => [
  ...projectTools(client),
  ...paymentTools(client),
  ...contractTools(client),
  ...approvalTools(client),
  ...warehouseTools(client)
];

export const registerAllTools = (server: McpServer, client: HybcApiClient): void => {
  for (const def of allToolDefs(client)) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema
      },
      def.handler
    );
  }
};
```

- [ ] **Step 3: 写失败测试 `server.test.ts`**

```typescript
// server.test.ts
import { describe, expect, it, vi } from "vitest";

import type { HybcApiClient } from "./api-client";
import { allToolDefs } from "./tools/index";
import { buildServer } from "./server";

const fakeClient = () => ({ get: vi.fn() } as unknown as HybcApiClient);

describe("server wiring", () => {
  it("allToolDefs exposes a curated, unique, non-empty tool set", () => {
    const defs = allToolDefs(fakeClient());
    const names = defs.map((d) => d.name);
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(new Set(names).size).toBe(names.length); // no dup names
    for (const d of defs) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it("buildServer constructs an McpServer without throwing", () => {
    const server = buildServer(fakeClient());
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 4: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/server.test.ts`
Expected: FAIL（`./server` not found）。

- [ ] **Step 5: 实现 `server.ts`**

```typescript
// server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { HybcApiClient } from "./api-client";
import { INSTRUCTIONS } from "./instructions";
import { registerAllTools } from "./tools/index";

export const buildServer = (client: HybcApiClient): McpServer => {
  const server = new McpServer(
    { name: "hybc", version: "0.1.0" },
    { instructions: INSTRUCTIONS }
  );
  registerAllTools(server, client);
  return server;
};
```

- [ ] **Step 6: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/server.test.ts`
Expected: PASS（2 passed）。

**若报错，按类型对症：**
- **运行时报 `registerTool is not a function` / 方法名不对**：SDK 版本签名不同。运行 `node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.log(Object.getOwnPropertyNames(m.McpServer.prototype)))"` 确认方法名（1.x 应有 `registerTool`），据实调整 `registerAllTools`。
- **typecheck 报 `def.handler` 入参类型与 `ToolCallback` 不匹配**（泛型 raw-shape 推断问题）：这是唯一预期的类型摩擦点。定点修复——把 `tools/types.ts` 里 `ToolDef.handler` 的入参从 `Record<string, unknown>` 保持不变，但在 `registerAllTools` 里对 `inputSchema` 用**具名局部变量**并让 handler 走同一 `ToolDef` 契约即可；若仍不过，最小改动是让每个域导出 `registerXxxTools(server, client)` 在内部对每个工具**内联** `server.registerTool(...)`（此时 TS 能逐工具推断 schema→handler 入参），`allToolDefs` 仅保留给测试用。不要用 `as any`。

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/instructions.ts packages/mcp/src/tools/index.ts packages/mcp/src/server.ts packages/mcp/src/server.test.ts
git commit -m "feat(mcp): wire McpServer with instructions + all read tools"
```

---

## Task 10: CLI 分发（TDD）

**Files:**
- Create: `packages/mcp/src/cli.ts`
- Test: `packages/mcp/src/cli.test.ts`

CLI 把可测试的分发逻辑抽成 `runCli(argv, deps)`，真入口只注入真实 deps。

- [ ] **Step 1: 写失败测试**

```typescript
// cli.test.ts
import { describe, expect, it, vi } from "vitest";

import { runCli, type CliDeps } from "./cli";

const baseDeps = (over: Partial<CliDeps> = {}): CliDeps => ({
  readCredentials: vi.fn(async () => null),
  saveCredentials: vi.fn(async () => undefined),
  clearCredentials: vi.fn(async () => undefined),
  runLogin: vi.fn(async () => ({
    token: "hybc_agent_x",
    wecomUserid: "MaxLiu",
    role: "finance"
  })),
  serve: vi.fn(async () => undefined),
  now: () => "2026-07-16T00:00:00.000Z",
  log: vi.fn(),
  ...over
});

describe("runCli", () => {
  it("login runs device flow and saves credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["login"], deps);
    expect(code).toBe(0);
    expect(deps.runLogin).toHaveBeenCalled();
    expect(deps.saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ token: "hybc_agent_x", wecomUserid: "MaxLiu" })
    );
  });

  it("logout clears credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["logout"], deps);
    expect(code).toBe(0);
    expect(deps.clearCredentials).toHaveBeenCalled();
  });

  it("whoami reports not-logged-in as exit 1", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli(["whoami"], deps);
    expect(code).toBe(1);
  });

  it("serve without credentials exits 1 and does not start server", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli([], deps);
    expect(code).toBe(1);
    expect(deps.serve).not.toHaveBeenCalled();
  });

  it("serve with credentials starts the server", async () => {
    const deps = baseDeps({
      readCredentials: vi.fn(async () => ({
        baseUrl: "https://api.hybcdg.com",
        token: "hybc_agent_x",
        wecomUserid: "MaxLiu",
        role: "finance",
        savedAt: "s"
      }))
    });
    const code = await runCli(["serve"], deps);
    expect(code).toBe(0);
    expect(deps.serve).toHaveBeenCalledWith("https://api.hybcdg.com", "hybc_agent_x");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/mcp && npm test -- src/cli.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现 `cli.ts`**

```typescript
// cli.ts
import { spawn } from "node:child_process";

import { HybcApiClient } from "./api-client";
import { resolveBaseUrl } from "./config";
import {
  clearCredentials,
  readCredentials,
  saveCredentials,
  type StoredCredentials
} from "./credentials";
import { runLogin, type LoginResult } from "./device-login";
import { buildServer } from "./server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export interface CliDeps {
  readCredentials: () => Promise<StoredCredentials | null>;
  saveCredentials: (creds: StoredCredentials) => Promise<void>;
  clearCredentials: () => Promise<void>;
  runLogin: (baseUrl: string) => Promise<LoginResult>;
  serve: (baseUrl: string, token: string) => Promise<void>;
  now: () => string;
  log: (message: string) => void;
}

export const runCli = async (argv: string[], deps: CliDeps): Promise<number> => {
  const cmd = argv[0] ?? "serve";

  if (cmd === "login") {
    const baseUrl = resolveBaseUrl((await deps.readCredentials())?.baseUrl);
    const result = await deps.runLogin(baseUrl);
    await deps.saveCredentials({
      baseUrl,
      token: result.token,
      wecomUserid: result.wecomUserid,
      role: result.role,
      savedAt: deps.now()
    });
    deps.log(`已登录：${result.wecomUserid}（${result.role}）。凭证已保存。`);
    return 0;
  }

  if (cmd === "logout") {
    await deps.clearCredentials();
    deps.log("已登出，凭证已清除。");
    return 0;
  }

  if (cmd === "whoami") {
    const creds = await deps.readCredentials();
    if (!creds) {
      deps.log("未登录。运行 `hybc-mcp login` 进行授权。");
      return 1;
    }
    deps.log(`${creds.wecomUserid}（${creds.role}）@ ${creds.baseUrl}`);
    return 0;
  }

  // serve (default)
  const creds = await deps.readCredentials();
  if (!creds) {
    deps.log("未登录，无法启动 MCP。请先运行 `hybc-mcp login`。");
    return 1;
  }
  await deps.serve(resolveBaseUrl(creds.baseUrl), creds.token);
  return 0;
};

const openBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // best effort; the URL is already printed to stderr
  }
};

const realServe = async (baseUrl: string, token: string): Promise<void> => {
  const client = new HybcApiClient(baseUrl, token);
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const realDeps: CliDeps = {
  readCredentials: () => readCredentials(),
  saveCredentials: (c) => saveCredentials(c),
  clearCredentials: () => clearCredentials(),
  runLogin: (baseUrl) =>
    runLogin({
      baseUrl,
      deviceName: `${process.env.USER ?? "user"}@${process.platform}`,
      agentType: process.env.HYBC_AGENT_TYPE ?? "unknown",
      openBrowser
    }),
  serve: realServe,
  now: () => new Date().toISOString(),
  log: (m) => process.stderr.write(`${m}\n`)
};

// 真入口：仅在被直接执行时运行（不影响单测 import）
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runCli(process.argv.slice(2), realDeps)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
```

> 说明：`serve` 用 stderr 打印日志，stdout 专供 MCP stdio 协议。真入口用 `import.meta.url` 判定是否被直接执行，避免单测 `import` 触发 `process.exit`。

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/mcp && npm test -- src/cli.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/cli.ts packages/mcp/src/cli.test.ts
git commit -m "feat(mcp): add CLI (login/logout/whoami/serve dispatch)"
```

---

## Task 11: SKILL.md + 全量校验 + 本地冒烟

**Files:**
- Create: `packages/mcp/SKILL.md`

- [ ] **Step 1: 写 `packages/mcp/SKILL.md`**

```markdown
---
name: hybc-backend
description: 通过恒越百川(HYBC)MCP 只读查询公司后台——项目、付款、审批、合同、库房。需先用 `hybc-mcp login` 授权。
---

# 恒越百川后台（只读）

本 skill 配合 `@hybc/mcp` 使用：以你的员工身份只读查询公司后台系统。

## 首次使用
1. 在终端运行 `hybc-mcp login`，浏览器会打开授权页，用企业微信登录并点“授权”（有效期约 6 个月）。
2. 授权后凭证存于 `~/.hybc/credentials.json`（仅本机可读）。
3. 之后智能体即可调用下列工具。

## 可用工具（只读）
- 项目：`search_projects`、`get_project`、`get_project_financial_summary`
- 付款：`list_payments`、`get_payment`
- 合同：`list_contracts`、`get_contract`
- 审批：`list_my_approvals`、`list_pending_approvals`、`get_approval`
- 库房：`warehouse_inventory`、`warehouse_low_stock`、`list_stock_orders`

## 规范
- 列表工具返回 `{ items, pagination }`；结果可能分页，需要更多用 `page`/`pageSize`。
- 金额单位为元；状态字段原样呈现，不要臆测。
- 遇到 403 说明你的角色无权访问该数据，如实告知用户。
- 当前**没有写操作**（付款/审批/建单等）；用户要写时，说明只读并引导其在网页端完成。后续版本的写操作将要求本人微信确认。
- 报“未登录/令牌过期”时，提示用户重跑 `hybc-mcp login`。
```

- [ ] **Step 2: 构建 + 全量测试**

Run: `cd packages/mcp && npm run build && npm test`
Expected: `tsc` 无错误产出 `dist/`；vitest 全绿（config 2 + credentials 3 + api-client 4 + device-login 2 + projects 3 + payments 3 + contracts 2 + approvals 3 + warehouse 3 + server 2 + cli 5 = 32 passed）。

- [ ] **Step 3: 全量类型 + lint**

Run: `cd packages/mcp && npm run typecheck`
Expected: PASS。
（若仓库根 eslint 覆盖到该包则 `npm run lint`；如包内暂无 eslint 配置，此步可跳过并在报告中说明——lint 配置留待 P1b-2 分发前统一接入。）

- [ ] **Step 4: 本地冒烟（手动，可选但推荐）**

先在另一终端起本地 API（`cd packages/api && npm run dev`，注意本地需有 agent_grant 表：`npm run db:migrate:local`）。然后：
```bash
cd packages/mcp && npm run build
HYBC_API_BASE_URL="http://localhost:8787" HYBC_CREDENTIALS_PATH="/tmp/hybc-smoke.json" node dist/cli.js whoami
```
Expected: 打印“未登录”。（完整 login 冒烟需要企业微信 OAuth，放到集成环境；此处仅验证 CLI 可运行、能读配置。）

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/SKILL.md
git commit -m "docs(mcp): add SKILL.md for Claude Code + P1b-1 verify"
```

---

## Self-Review 记录（对照 spec §6/§10）

- **本地 stdio MCP（spec §3/§10）** → Task 9/10：`buildServer` + `StdioServerTransport` ✅
- **`login` 设备流 + 凭证落盘 6 月令牌（spec §5.2/§10.1）** → Task 5/10：`runLogin` + `saveCredentials`(600) ✅
- **只读工具，分域(项目/付款/审批/合同/库房)（spec §10.1，运营性冻结=只读）** → Task 6/7/8：12+ 只读工具 ✅
- **写工具遇确认循环** → **不在本计划**（P2；本包无写工具，符合只读约束）
- **指引经 MCP `instructions`(agent 无关) + SKILL.md(Claude Code)（spec §6.4/§10.2）** → Task 9/11 ✅
- **base URL 可配置、令牌作 Bearer、信封解包（spec §7 对齐）** → Task 2/4 ✅
- **令牌只落本地文件(600)、不入日志** → Task 3；`serve` 用 stderr、不打印令牌 ✅

**已知延后 / 交接 P1b-2**：R2 bundle 服务端点 + 真实 `install.sh`/`install.ps1`（拉 bundle、兑换 boot、写 agent 配置、放 skill）+ 构建发布脚本（esbuild 打包 → `wrangler r2 object put`）+ 各 agent(Claude Code/Codex/Claude Desktop)配置写入。包内 eslint 配置若未接入，一并在 P1b-2 统一。

## 开放问题 / 待评审确认

1. 首批工具集是否合适（当前 13 个只读工具覆盖 5 域）。可增删。
2. `bin` 名 `hybc-mcp` 是否 OK。
3. Node 版本基线（计划假设 ≥18 内置 `fetch`；若需支持更低版本要加 `undici`）。
