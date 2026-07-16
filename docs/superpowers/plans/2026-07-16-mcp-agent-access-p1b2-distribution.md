# MCP 智能体接入 — P1b-2：分发（R2 bundle + 真实安装器） 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让员工能"一行命令装好并授权"`@hybc/mcp`：esbuild 把包打成**单文件 bundle** 传 R2；api 提供 `GET /agent/dist/*` 分发端点 + 真实 `install.sh`/`install.ps1`（下载 bundle → 兑换 boot 授权 → 写 agent 配置 → 放 skill）。

**Architecture:** `@hybc/mcp` 经 esbuild 打成自带依赖的单文件 `hybc-mcp.mjs`（保留 shebang），连同 `SKILL.md` 上传到 R2(`FILES`) 的 `agent-dist/` 前缀。api 新增 `GET /api/v1/agent/dist/:file` 从 R2 流式返回；`GET /api/v1/agent/install.sh?boot=&agent=` 把**内嵌的脚本模板**里的 `__HYBC_API__/__HYBC_BOOT__/__HYBC_AGENT__` 用校验过的值替换后返回（替换 P1a 的占位实现）。安装脚本用 Node（员工机器已有）下载 bundle、`POST /agent/setup/redeem` 兑换令牌写 `~/.hybc/credentials.json`、按 agent 类型写 MCP 配置。

**Tech Stack:** esbuild（打包）、Cloudflare R2(`FILES`)、Hono、vitest、wrangler（R2 上传）。

> **测试边界（重要）**：安装脚本是 bash/PowerShell，**其运行时无法在 Worker 的 vitest 里单测**。本计划 TDD 覆盖：esbuild 产物可运行、`dist` 端点从 R2 取件、`install.sh` 路由的**令牌替换与校验**。安装脚本的**端到端运行**（下载→兑换→写配置）由**真机手动冒烟**验证（需浏览器+企业微信+目标 agent，属 owner 手动步骤）。
> **只读约束延续**：分发的仍是 P1b-1 的只读包；不改变只读性质。

---

## 依赖与既有事实（recon 确认）

- R2 绑定 `FILES`（bucket `hybcdg-prod-files`），env.ts 已有 `FILES: R2Bucket`。
- R2 取件返回模式（见 `routes/upload.ts:137`）：`const o = await c.env.FILES.get(key); if(!o||!o.body) 404; const h=new Headers(); o.writeHttpMetadata(h); h.set("etag",o.httpEtag); return new Response(o.body,{headers:h});`
- P1a 已有 `GET /agent/install.sh`/`install.ps1` 占位路由 + `safeBoot`（`/^[0-9a-f-]{36}$/i`）+ `POST /agent/setup/redeem`（返回 `{agent_token,wecom_userid,role}`）+ `POST /agent/setup/provision`（返回 `install_sh`/`install_ps1` 命令串）。
- P1b-1 的 `cli.ts` 有 shebang，入口守卫用 realpath 比较；`resolveBaseUrl` 支持 `HYBC_API_BASE_URL` env 覆盖。

---

## 文件结构

**修改 `packages/mcp/`**
- `package.json` — 加 `esbuild` devDep + `build:bundle` 脚本
- `scripts/publish-dist.mjs` — 打 bundle + 上传 bundle/SKILL.md 到 R2（wrangler）
- `src/install/install.sh.ts` — 内嵌 bash 模板（带 `__TOKEN__`）导出为字符串常量（放 mcp 包便于与脚本同源维护）——**改为放 api 包**（见下）

**新建/修改 `packages/api/`**
- `src/services/agent-install-template.ts` — 内嵌 `install.sh` / `install.ps1` 模板字符串（带 `__HYBC_API__/__HYBC_BOOT__/__HYBC_AGENT__`）+ `renderInstallScript(template, {apiBase, boot, agent})`（做校验替换）
- `src/services/agent-install-template.test.ts`
- `src/routes/agent.ts` — 替换 `install.sh`/`install.ps1` 占位为真实渲染；新增 `GET /agent/dist/:file`（R2）；`setup/provision` 的命令串加 `&agent=`
- `src/routes/agent-dist.test.ts` — dist 端点 + install 渲染的路由级测试

**新建 `packages/mcp/install/`**（真实脚本文件，便于阅读/shellcheck；构建时其内容成为 api 模板的来源，或直接手动同步——本计划采用 api 内嵌常量，`install/*` 作为可读副本 + shellcheck 目标）
- `packages/mcp/install/install.sh`
- `packages/mcp/install/install.ps1`

> 决策：安装脚本**内嵌在 api worker**（TS 常量），不走 R2——脚本小、且省一次 R2 往返，且 provision 后立即可用。只有 **bundle** 和 **SKILL.md** 走 R2。`packages/mcp/install/*.sh` 保留一份可读/可 shellcheck 的同源副本，api 常量与之保持一致（Task 3 会加一个一致性测试）。

---

## Task 1: esbuild 单文件 bundle

**Files:**
- Modify: `packages/mcp/package.json`

- [ ] **Step 1: 加 esbuild devDep + bundle 脚本**

在 `packages/mcp/package.json` 的 `devDependencies` 加 `"esbuild": "^0.24.0"`；`scripts` 加：

```json
    "build:bundle": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist/hybc-mcp.mjs"
```

- [ ] **Step 2: 安装依赖**

Run: `cd /Users/zihaoliu/Documents/Code/hybc_core && npm install --workspace=@hybc/mcp`
Expected: esbuild 安装成功。

- [ ] **Step 3: 打 bundle 并验证可运行**

Run: `cd packages/mcp && npm run build:bundle && head -1 dist/hybc-mcp.mjs && HYBC_CREDENTIALS_PATH="/tmp/hybc-bundle-$$.json" node dist/hybc-mcp.mjs whoami`
Expected: `dist/hybc-mcp.mjs` 第一行是 `#!/usr/bin/env node`（esbuild 保留入口 shebang）；`whoami` 打印"未登录"（exit 1 OK）。这证明**单文件、自带依赖、无需 npm install** 即可运行。

- [ ] **Step 4: 验证依赖已内联（不是 external）**

Run: `cd packages/mcp && grep -c "from \"zod\"\|require(\"zod\")" dist/hybc-mcp.mjs || echo 0`
Expected: `0`（zod 已被打进 bundle，不再有裸 import；若非 0 说明 esbuild 没 bundle 依赖，检查 `--bundle`）。

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/package.json package-lock.json
git commit -m "build(mcp): add esbuild single-file bundle (build:bundle)"
```

---

## Task 2: 安装脚本模板（可读副本 + shellcheck）

**Files:**
- Create: `packages/mcp/install/install.sh`
- Create: `packages/mcp/install/install.ps1`

> 这两份是**可读、可 shellcheck 的真实脚本**，含 `__HYBC_API__/__HYBC_BOOT__/__HYBC_AGENT__` 占位。Task 3 会把等价内容作为 api 内嵌常量，并加一致性测试。

- [ ] **Step 1: 写 `packages/mcp/install/install.sh`**

```sh
#!/bin/sh
set -eu
HYBC_API="__HYBC_API__"
HYBC_BOOT="__HYBC_BOOT__"
HYBC_AGENT="__HYBC_AGENT__"
export HYBC_API HYBC_BOOT HYBC_AGENT

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js (>=18)。请先安装 https://nodejs.org 再重试。" >&2
  exit 1
fi

MCP_DIR="$HOME/.hybc/mcp"
mkdir -p "$MCP_DIR"

echo "下载 MCP..." >&2
curl -fsSL "$HYBC_API/api/v1/agent/dist/hybc-mcp.mjs" -o "$MCP_DIR/hybc-mcp.mjs"
curl -fsSL "$HYBC_API/api/v1/agent/dist/SKILL.md" -o "$MCP_DIR/SKILL.md" || true

echo "兑换授权..." >&2
RESP=$(curl -fsSL -X POST "$HYBC_API/api/v1/agent/setup/redeem" \
  -H "content-type: application/json" -d "{\"boot_code\":\"$HYBC_BOOT\"}")

printf '%s' "$RESP" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch(e){console.error("兑换响应解析失败");process.exit(1)}
  if(!j.success){console.error((j.error&&j.error.message)||"兑换失败");process.exit(1)}
  const d=j.data,fs=require("fs"),os=require("os"),path=require("path");
  const p=path.join(os.homedir(),".hybc","credentials.json");
  fs.writeFileSync(p,JSON.stringify({baseUrl:process.env.HYBC_API,token:d.agent_token,wecomUserid:d.wecom_userid,role:d.role,savedAt:new Date().toISOString()},null,2),{mode:0o600});
  fs.chmodSync(p,0o600);
  console.error("已保存凭证："+d.wecom_userid+"（"+d.role+"）");
});'

case "$HYBC_AGENT" in
  claude_code)
    if command -v claude >/dev/null 2>&1; then
      claude mcp add --scope user hybc -- node "$MCP_DIR/hybc-mcp.mjs" serve >/dev/null 2>&1 || true
    fi
    SKILL_DIR="$HOME/.claude/skills/hybc"; mkdir -p "$SKILL_DIR"
    cp "$MCP_DIR/SKILL.md" "$SKILL_DIR/SKILL.md" 2>/dev/null || true
    echo "已配置 Claude Code。" >&2 ;;
  codex)
    mkdir -p "$HOME/.codex"; CFG="$HOME/.codex/config.toml"
    if ! grep -q "\[mcp_servers.hybc\]" "$CFG" 2>/dev/null; then
      printf '\n[mcp_servers.hybc]\ncommand = "node"\nargs = ["%s", "serve"]\n' "$MCP_DIR/hybc-mcp.mjs" >> "$CFG"
    fi
    echo "已配置 Codex。" >&2 ;;
  *)
    echo "请在你的 agent 里手动配置 MCP：command=node，args=[\"$MCP_DIR/hybc-mcp.mjs\",\"serve\"]" >&2 ;;
esac

echo "完成。可在 agent 中使用恒越百川只读工具了。" >&2
```

- [ ] **Step 2: 写 `packages/mcp/install/install.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$HYBC_API = "__HYBC_API__"
$HYBC_BOOT = "__HYBC_BOOT__"
$HYBC_AGENT = "__HYBC_AGENT__"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "需要 Node.js (>=18)。请先安装 https://nodejs.org 再重试。"; exit 1
}

$McpDir = Join-Path $HOME ".hybc/mcp"
New-Item -ItemType Directory -Force -Path $McpDir | Out-Null

Write-Host "下载 MCP..."
Invoke-WebRequest -UseBasicParsing "$HYBC_API/api/v1/agent/dist/hybc-mcp.mjs" -OutFile (Join-Path $McpDir "hybc-mcp.mjs")
try { Invoke-WebRequest -UseBasicParsing "$HYBC_API/api/v1/agent/dist/SKILL.md" -OutFile (Join-Path $McpDir "SKILL.md") } catch {}

Write-Host "兑换授权..."
$resp = Invoke-RestMethod -Method Post "$HYBC_API/api/v1/agent/setup/redeem" -ContentType "application/json" -Body (@{ boot_code = $HYBC_BOOT } | ConvertTo-Json)
if (-not $resp.success) { Write-Error ($resp.error.message); exit 1 }
$d = $resp.data
$cred = @{ baseUrl = $HYBC_API; token = $d.agent_token; wecomUserid = $d.wecom_userid; role = $d.role; savedAt = (Get-Date).ToUniversalTime().ToString("o") }
$credPath = Join-Path $HOME ".hybc/credentials.json"
$cred | ConvertTo-Json | Set-Content -Path $credPath -Encoding utf8
Write-Host "已保存凭证：$($d.wecom_userid)（$($d.role)）"

$mjs = Join-Path $McpDir "hybc-mcp.mjs"
switch ($HYBC_AGENT) {
  "claude_code" {
    if (Get-Command claude -ErrorAction SilentlyContinue) { claude mcp add --scope user hybc -- node "$mjs" serve 2>$null }
    $skillDir = Join-Path $HOME ".claude/skills/hybc"; New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
    Copy-Item (Join-Path $McpDir "SKILL.md") (Join-Path $skillDir "SKILL.md") -ErrorAction SilentlyContinue
    Write-Host "已配置 Claude Code。"
  }
  "codex" {
    $codex = Join-Path $HOME ".codex"; New-Item -ItemType Directory -Force -Path $codex | Out-Null
    $cfg = Join-Path $codex "config.toml"
    if (-not (Select-String -Path $cfg -Pattern "\[mcp_servers.hybc\]" -ErrorAction SilentlyContinue)) {
      Add-Content -Path $cfg -Value "`n[mcp_servers.hybc]`ncommand = `"node`"`nargs = [`"$mjs`", `"serve`"]`n"
    }
    Write-Host "已配置 Codex。"
  }
  default { Write-Host "请手动配置 MCP：command=node，args=[`"$mjs`",`"serve`"]" }
}
Write-Host "完成。"
```

- [ ] **Step 3: shellcheck（若可用）**

Run: `command -v shellcheck >/dev/null 2>&1 && shellcheck packages/mcp/install/install.sh || echo "shellcheck 不可用，跳过（手动检查语法）"`
Expected: 无 error（占位 `__HYBC_*__` 是普通字符串，shellcheck 不会报错）。若不可用则跳过并在报告注明。

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/install/install.sh packages/mcp/install/install.ps1
git commit -m "feat(mcp): add install.sh/install.ps1 templates"
```

---

## Task 3: api 安装脚本渲染服务（TDD）

> **设计（已修订）**：不再把脚本内嵌进 TS（避免 JS 模板字符串对 bash `\n`/PowerShell 反引号的转义地狱）。`renderInstallScript` 只做**纯校验替换**：入参是从 R2 取来的模板文本 + `{apiBase, boot, agent}`。模板本体（Task 2 的 `install.sh`/`install.ps1`）随 bundle 一起发布到 R2（Task 5），install 路由从 R2 取模板再渲染（Task 4）。

**Files:**
- Create: `packages/api/src/services/agent-install-template.ts`
- Test: `packages/api/src/services/agent-install-template.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// agent-install-template.test.ts
import { describe, expect, it } from "vitest";

import { renderInstallScript } from "./agent-install-template";

const SAMPLE = [
  'HYBC_API="__HYBC_API__"',
  'HYBC_BOOT="__HYBC_BOOT__"',
  'HYBC_AGENT="__HYBC_AGENT__"',
  'curl "__HYBC_API__/api/v1/agent/setup/redeem"'
].join("\n");

describe("renderInstallScript", () => {
  it("substitutes api/boot/agent and strips trailing slash on api", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com/",
      boot: "123e4567-e89b-12d3-a456-426614174000",
      agent: "claude_code"
    });
    expect(out).toContain('HYBC_API="https://api.hybcdg.com"');
    expect(out).toContain('HYBC_BOOT="123e4567-e89b-12d3-a456-426614174000"');
    expect(out).toContain('HYBC_AGENT="claude_code"');
    expect(out).not.toContain("__HYBC_");
  });

  it("rejects a non-UUID boot (empty boot, never injects)", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com",
      boot: 'x"; rm -rf ~ ; "',
      agent: "claude_code"
    });
    expect(out).toContain('HYBC_BOOT=""');
    expect(out).not.toContain("rm -rf");
  });

  it("whitelists agent (unknown -> 'other')", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com",
      boot: "123e4567-e89b-12d3-a456-426614174000",
      agent: 'evil"; curl x'
    });
    expect(out).toContain('HYBC_AGENT="other"');
    expect(out).not.toContain("curl x");
  });

  it("accepts the whitelisted agents", () => {
    for (const a of ["claude_code", "codex", "claude_desktop"]) {
      const out = renderInstallScript(SAMPLE, {
        apiBase: "https://api.hybcdg.com",
        boot: "123e4567-e89b-12d3-a456-426614174000",
        agent: a
      });
      expect(out).toContain(`HYBC_AGENT="${a}"`);
    }
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/services/agent-install-template.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: 实现**（纯函数，无内嵌脚本）

```typescript
// agent-install-template.ts
const BOOT_CODE_RE = /^[0-9a-f-]{36}$/i;
const AGENTS = new Set(["claude_code", "codex", "claude_desktop"]);

export const safeBoot = (raw: string): string => (BOOT_CODE_RE.test(raw) ? raw : "");
export const safeAgent = (raw: string): string => (AGENTS.has(raw) ? raw : "other");

export interface RenderInput {
  apiBase: string;
  boot: string;
  agent: string;
}

/**
 * 把从 R2 取来的安装脚本模板里的 __HYBC_*__ 占位替换为校验过的值。
 * boot 必须是 UUID 形态（否则空串，杜绝 shell 注入）；agent 必须白名单。
 */
export const renderInstallScript = (template: string, input: RenderInput): string =>
  template
    .replaceAll("__HYBC_API__", input.apiBase.replace(/\/+$/, ""))
    .replaceAll("__HYBC_BOOT__", safeBoot(input.boot))
    .replaceAll("__HYBC_AGENT__", safeAgent(input.agent));
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd packages/api && npm test -- src/services/agent-install-template.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: typecheck + Commit**

Run: `cd packages/api && npm run typecheck`
```bash
git add packages/api/src/services/agent-install-template.ts packages/api/src/services/agent-install-template.test.ts
git commit -m "feat(api): add install-script render service (validated token substitution)"
```

---

## Task 4: api `GET /agent/dist/:file`（R2）+ 真实 install 路由（TDD）

**Files:**
- Modify: `packages/api/src/routes/agent.ts`
- Test: `packages/api/src/routes/agent-dist.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// agent-dist.test.ts
import { describe, expect, it, vi } from "vitest";

import { agentRoutes } from "./agent";
import type { Env } from "../types/env";

const fakeR2 = (files: Record<string, string>) =>
  ({
    async get(key: string) {
      if (!(key in files)) return null;
      return {
        body: files[key],
        httpEtag: '"etag"',
        writeHttpMetadata: (_h: Headers) => undefined,
        async text() {
          return files[key];
        }
      };
    }
  }) as unknown as Env["FILES"];

const fakeEnv = (over: Partial<Env> = {}): Env =>
  ({
    AGENT_API_BASE_URL: "https://api.hybcdg.com",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    FILES: fakeR2({ "agent-dist/hybc-mcp.mjs": "#!/usr/bin/env node\nconsole.log(1)" }),
    DB: {} as unknown as Env["DB"],
    KV: {} as unknown as Env["KV"],
    ...over
  }) as unknown as Env;

describe("agent dist + install routes", () => {
  it("GET /dist/hybc-mcp.mjs streams the R2 object", async () => {
    const res = await agentRoutes.request("/dist/hybc-mcp.mjs", {}, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("#!/usr/bin/env node");
  });

  it("GET /dist/:file 404s for a missing object", async () => {
    const res = await agentRoutes.request("/dist/nope.txt", {}, fakeEnv());
    expect(res.status).toBe(404);
  });

  it("GET /dist/:file rejects path traversal / unknown names", async () => {
    const res = await agentRoutes.request("/dist/..%2f..%2fsecret", {}, fakeEnv());
    expect([400, 404]).toContain(res.status);
  });

  it("GET /install.sh renders the R2 template with validated boot", async () => {
    const env = fakeEnv({
      FILES: fakeR2({
        "agent-dist/install.sh":
          'HYBC_API="__HYBC_API__"\nHYBC_BOOT="__HYBC_BOOT__"\nHYBC_AGENT="__HYBC_AGENT__"\ncurl "__HYBC_API__/api/v1/agent/setup/redeem"\n'
      })
    });
    const res = await agentRoutes.request(
      "/install.sh?boot=123e4567-e89b-12d3-a456-426614174000&agent=claude_code",
      {},
      env
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('HYBC_BOOT="123e4567-e89b-12d3-a456-426614174000"');
    expect(body).toContain("/api/v1/agent/setup/redeem");
    expect(body).not.toContain("__HYBC_");
  });

  it("GET /install.sh with a malicious boot yields empty boot (no injection)", async () => {
    const env = fakeEnv({
      FILES: fakeR2({
        "agent-dist/install.sh": 'HYBC_BOOT="__HYBC_BOOT__"\n'
      })
    });
    const res = await agentRoutes.request(
      "/install.sh?boot=x%22%3B%20rm%20-rf%20~%20%3B%20%22",
      {},
      env
    );
    const body = await res.text();
    expect(body).toContain('HYBC_BOOT=""');
    expect(body).not.toContain("rm -rf");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd packages/api && npm test -- src/routes/agent-dist.test.ts`
Expected: FAIL（新路由未实现 → dist 404 或 install 仍是占位）。

- [ ] **Step 3: 修改 `routes/agent.ts`**

顶部 import 加：
```typescript
import { renderInstallScript } from "../services/agent-install-template";
```

新增 dist 路由（放在免鉴权 GET 区，`install.sh` 附近）；`ALLOWED_DIST` 白名单防遍历：
```typescript
const ALLOWED_DIST = new Set(["hybc-mcp.mjs", "SKILL.md"]);

agentRoutes.get("/dist/:file", async (c) => {
  const file = c.req.param("file");
  if (!ALLOWED_DIST.has(file)) {
    return c.json(fail("not found"), 404);
  }
  const object = await c.env.FILES.get(`agent-dist/${file}`);
  if (!object || !object.body) {
    return c.json(fail("not found"), 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (file.endsWith(".mjs")) headers.set("content-type", "text/javascript; charset=utf-8");
  return new Response(object.body, { headers });
});
```

替换现有 `install.sh`/`install.ps1` 占位路由为**从 R2 取模板 + 渲染**：
```typescript
const renderInstallFromR2 = async (
  c: { env: Env; req: { query: (k: string) => string | undefined } },
  key: string,
  contentType: string
): Promise<Response> => {
  const object = await c.env.FILES.get(`agent-dist/${key}`);
  if (!object) {
    return new Response("install template not published", { status: 404 });
  }
  const template = await object.text();
  const apiBase = (c.env.AGENT_API_BASE_URL ?? "https://api.hybcdg.com").replace(/\/$/, "");
  const script = renderInstallScript(template, {
    apiBase,
    boot: c.req.query("boot") ?? "",
    agent: c.req.query("agent") ?? "other"
  });
  return new Response(script, {
    status: 200,
    headers: { "content-type": contentType }
  });
};

agentRoutes.get("/install.sh", (c) =>
  renderInstallFromR2(c, "install.sh", "text/x-shellscript; charset=utf-8")
);
agentRoutes.get("/install.ps1", (c) =>
  renderInstallFromR2(c, "install.ps1", "text/plain; charset=utf-8")
);
```

（删除旧的 P1a 内嵌占位 `install.sh`/`install.ps1` 路由与其内嵌 `safeBoot`/脚本数组——`safeBoot` 逻辑已移入 `agent-install-template.ts`；确认删除后 agent.ts 无其它地方引用旧 `safeBoot`。R2 fake 的 `get()` 需返回带 `.text()` 的对象——见测试 `fakeR2` 补 `text()`。）

> **测试补充**：Task 4 测试里的 `fakeR2` 的返回对象要加 `async text(){ return files[key]; }`（install 路由用 `object.text()`）。dist 路由用 `object.body`+`writeHttpMetadata`，install 路由用 `object.text()`——两者 fake 都要支持。

- [ ] **Step 4: `setup/provision` 命令串加 `&agent=`**

把 provision 返回里的 `install_sh`/`install_ps1` 改为带 agent（agent 来自请求体 `agent_type`）：
```typescript
      install_sh: `curl -fsSL "${apiBase}/api/v1/agent/install.sh?boot=${prov.boot_code}&agent=${encodeURIComponent(body.agent_type ?? "other")}" | sh`,
      install_ps1: `irm "${apiBase}/api/v1/agent/install.ps1?boot=${prov.boot_code}&agent=${encodeURIComponent(body.agent_type ?? "other")}" | iex`
```

- [ ] **Step 5: 运行，确认通过 + 全量回归**

Run: `cd packages/api && npm test -- src/routes/agent-dist.test.ts`
Expected: PASS（5 passed）。
Run: `cd packages/api && npm test`
Expected: 全绿（含 P1a 的 agent 路由测试；注意旧 `install.sh` 占位测试若断言"占位"文案需更新为真实脚本断言）。

- [ ] **Step 6: typecheck + Commit**

Run: `cd packages/api && npm run typecheck`
```bash
git add packages/api/src/routes/agent.ts packages/api/src/routes/agent-dist.test.ts
git commit -m "feat(api): serve MCP bundle from R2 + render real install scripts"
```

---

## Task 5: 发布脚本（bundle + SKILL.md → R2）

**Files:**
- Create: `packages/mcp/scripts/publish-dist.mjs`

- [ ] **Step 1: 写发布脚本**

```javascript
// publish-dist.mjs — 打 bundle 并上传到 R2 (agent-dist/)。owner 手动运行。
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const mcpDir = resolve(process.argv[2] ?? ".");
const bundle = resolve(mcpDir, "dist/hybc-mcp.mjs");
const skill = resolve(mcpDir, "SKILL.md");
const installSh = resolve(mcpDir, "install/install.sh");
const installPs1 = resolve(mcpDir, "install/install.ps1");
const bucket = "hybcdg-prod-files";
const dryRun = process.argv.includes("--dry-run");

run(`cd ${mcpDir} && npm run build:bundle`);
if (!existsSync(bundle)) {
  console.error("bundle 未生成:", bundle);
  process.exit(1);
}

const put = (localPath, key) => {
  if (!existsSync(localPath)) {
    console.error("缺少文件:", localPath);
    process.exit(1);
  }
  const cmd = `npx wrangler r2 object put "${bucket}/${key}" --file "${localPath}" --remote`;
  if (dryRun) {
    console.log("[dry-run]", cmd);
  } else {
    run(cmd);
  }
};

put(bundle, "agent-dist/hybc-mcp.mjs");
put(skill, "agent-dist/SKILL.md");
put(installSh, "agent-dist/install.sh");
put(installPs1, "agent-dist/install.ps1");
console.log(dryRun ? "dry-run 完成" : "已发布到 R2 agent-dist/");
```

在 `packages/mcp/package.json` scripts 加：`"publish:dist": "node scripts/publish-dist.mjs ."`

- [ ] **Step 2: dry-run 验证脚本逻辑（不真上传）**

Run: `cd packages/mcp && node scripts/publish-dist.mjs . --dry-run`
Expected: 先跑 `build:bundle` 生成 `dist/hybc-mcp.mjs`，然后打印两条 `[dry-run] npx wrangler r2 object put ...`（bundle + SKILL.md），不真正上传。确认命令拼接正确。

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/scripts/publish-dist.mjs packages/mcp/package.json
git commit -m "build(mcp): add publish-dist script (bundle -> R2)"
```

---

## Task 6: 全量校验 + 手动冒烟说明

- [ ] **Step 1: 全量测试 + typecheck（api & mcp）**

Run: `cd packages/api && npm test && npm run typecheck`
Run: `cd packages/mcp && npm test && npm run typecheck && npm run build`
Expected: 全绿。

- [ ] **Step 2: 记录手动冒烟步骤**（写入报告，不在此自动执行——需真机+企业微信）

真机端到端冒烟（owner 部署后执行）：
1. 发布 bundle：`cd packages/mcp && npm run publish:dist`（真上传 R2）。
2. 应用远程 D1 迁移（若尚未）+ push main 部署 api。
3. 浏览器进 setup 页（P1c；或临时用 provision 端点）拿到 `install_sh` 命令。
4. 在测试机跑该 `curl ... | sh`，确认：下载 bundle、兑换令牌写 `~/.hybc/credentials.json`(600)、按 agent 写好配置。
5. 在 agent 里验证 `hybc-mcp` 工具可用（`node ~/.hybc/mcp/hybc-mcp.mjs whoami` 显示已登录；调一个只读工具）。

- [ ] **Step 3: Commit（若有收尾改动）**

```bash
git add -A && git commit -m "chore(mcp): P1b-2 distribution verify" || echo "无改动"
```

---

## Self-Review 记录（对照 spec §6）

- **自托管一键脚本（spec §6.1/§6.2）** → Task 3/4：真实 install.sh/ps1 路由 + 校验替换 ✅
- **R2 bundle 分发（spec §6.1）** → Task 1/4/5：esbuild 单文件 + `GET /dist/:file` + 发布脚本 ✅
- **安装器写各 agent 配置（spec §6.3）** → Task 2：claude_code/codex 自动、其它打印片段 ✅
- **skill 跨 agent（spec §6.4）** → MCP `instructions`（P1b-1 已内嵌）+ SKILL.md 随 bundle 下发 ✅
- **注入安全（P1a erratum）** → Task 3：boot 校验 UUID、agent 白名单、dist 文件名白名单防遍历 ✅

**测试边界**：安装脚本运行时经真机手动冒烟（Task 6 Step 2），非自动化——已在计划顶部与 Task 6 显式说明。

## 开放问题 / 待评审确认

1. bundle 版本化：当前只发 `agent-dist/hybc-mcp.mjs`（latest 覆盖）。是否需要版本化 + 客户端自检更新？（建议 P2/后续）
2. 自动配置的 agent 范围：首期 claude_code + codex 自动，claude_desktop/其它打印片段。是否够？
3. 安装脚本内嵌在 api 常量 vs 走 R2：本计划选内嵌（provision 后即用、少一跳）。认可否？
