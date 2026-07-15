# HYBC MCP 智能体接入 — 设计文档

- **日期**：2026-07-16
- **状态**：设计待评审
- **作者**：Max + Claude
- **关联**：`packages/api`（鉴权/授权/审计）、`packages/web`（授权与安装页）、新包 `@hybc/mcp`

---

## 1. 背景与目标

让公司员工能通过自己的 AI 智能体（Claude Code / Codex / Claude Desktop / 其他支持 MCP 的客户端）**直接访问并操作恒越百川后台系统**（HYBC Core）。

系统当前鉴权：JWT(HS256) access(2h)+refresh(30d)、KV 记录会话、WeCom OAuth 人工登录、WeCom `userid` 为规范身份、5 角色 RBAC。机器鉴权目前仅有 task-runner 的共享 `x-api-key`。本设计新增"以员工身份运行的智能体"这一类主体。

### 目标
1. 员工通过网页登录完成鉴权与授权，签发**有效期 6 个月**的长期令牌。
2. 智能体**以员工身份、实时镜像其 RBAC 角色**全量访问/操作系统。
3. **高危写操作**（审批、提交付款、变更合同金额等）强制"人在环"——微信推送本人确认后才落地。
4. 全量审计；授权可即时吊销。
5. Agent 无关：本地 stdio MCP，任何支持 MCP 的客户端都能接。

### 非目标
- 不做远程托管 MCP / claude.ai connector（已否决：仅服务 Claude 生态、必须远程）。
- 不重构现有 Web/miniapp 登录。
- 首期不追求 1:1 包装全部 20+ 路由，工具集分期扩展。

---

## 2. 关键决策（已确认）

| 决策 | 选择 | 理由 |
|---|---|---|
| 部署形态 | **本地 stdio MCP + 6 个月长期令牌** | Agent 无关（含 Codex）、离线可用、公司掌控 |
| 权限范围 | **以员工身份、实时镜像其当前 RBAC 全量** | 复用现有 `authMiddleware`/`rbac`，所有路由零改动生效 |
| 高危闸门 | **微信推送人在环（服务端延迟执行 + 轮询）** | 最稳：MCP 断开也能落地；执行权全在服务端 |
| 网页→令牌 | **OAuth 设备授权码流程（Device Grant）** | 无需绑本地端口、穿透防火墙、可手机授权 |
| 分发形式 | **自托管一键脚本 + R2 bundle** | 代码不上公共 npm、公司掌控、无需代码签名 |

---

## 3. 架构总览

三个交付物：

1. **`packages/api` 新增**
   - `routes/agent.ts`（挂 `/api/v1/agent`）：设备流、bootstrap 授权、令牌兑换、分发脚本、授权管理、高危确认
   - `middleware/agent-auth.ts`：`hybc_agent_` 令牌鉴权分支
   - `middleware/agent-high-risk.ts`：高危延迟执行闸门
   - `services/agent-grant.ts`：签发/校验/吊销/身份解析
   - `services/agent-pending.ts`：高危待确认动作的落库/确认/重放执行
   - `services/agent-confirm-push.ts`：微信确认卡片（复用现有 WeCom 发送基础设施）
   - 迁移 `0058_mcp_agent_grant.sql`

2. **`packages/web` 新增**
   - `views/agent/setup.vue`（`/agent/setup`）：登录后选 agent+命名设备→生成一键安装命令
   - `views/agent/authorize.vue`（`/agent/authorize?user_code=`）：CLI 设备流的"输码授权"同意页
   - `views/agent/confirm.vue`（`/agent/confirm?token=`）：高危操作微信卡片跳转的确认页
   - `views/agent/grants.vue`：本人授权设备列表/吊销；super_admin 管理全部

3. **`@hybc/mcp` 新包**
   - stdio MCP server（`@modelcontextprotocol/sdk`）
   - `login` 命令（设备流）+ 凭证存储
   - 工具集（查询 + 写操作，写操作自动处理"待微信确认→轮询"）
   - MCP `instructions`/`prompts` 内置指引（Agent 无关）
   - `SKILL.md`（Claude Code 专用增强）

---

## 4. 数据模型（迁移 `0058_mcp_agent_grant.sql`）

### `agent_grant`（长期授权）
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | uuid |
| `wecom_userid` | TEXT NOT NULL | 规范身份 |
| `device_name` | TEXT | "Max 的 MacBook" |
| `client_info` | TEXT | agent 名称/版本/UA |
| `agent_type` | TEXT | claude_code / codex / claude_desktop / other |
| `token_hash` | TEXT NOT NULL UNIQUE | 令牌 SHA-256 |
| `token_prefix` | TEXT | 展示用前缀，如 `hybc_agent_ab12…` |
| `role_snapshot` | TEXT | 授权时角色（兜底） |
| `status` | TEXT | active / revoked / expired |
| `created_at` | TEXT | ISO |
| `expires_at` | TEXT | = created + 180 天 |
| `last_used_at` | TEXT | 节流更新 |
| `revoked_at` / `revoked_by` | TEXT | 吊销信息 |

索引：`idx_agent_grant_wecom_userid`、`idx_agent_grant_token_hash`、`idx_agent_grant_status`。

### `agent_pending_action`（高危待确认）
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | uuid |
| `grant_id` | TEXT | FK → agent_grant |
| `wecom_userid` | TEXT | 冗余，便于查询/推送 |
| `action_kind` | TEXT | 如 `approval.approve`、`payment.submit` |
| `request_snapshot` | TEXT(JSON) | method / path / 关键 headers / body |
| `risk_reason` | TEXT | 命中的高危规则 |
| `summary` | TEXT | 推送给员工的人读摘要（含金额/单号） |
| `status` | TEXT | pending / confirmed / executing / done / failed / rejected / expired |
| `result_snapshot` | TEXT(JSON) | 执行后回传给 MCP 的响应 |
| `confirm_token_hash` | TEXT | 卡片链接内一次性令牌的 hash |
| `created_at` / `expires_at` | TEXT | expires ≈ 创建 +10 分钟 |
| `confirmed_at` / `executed_at` | TEXT | |

索引：`idx_agent_pending_wecom_userid_status`、`idx_agent_pending_grant`。

### KV（临时态）
- `agent:device:{device_code}` → `{ user_code, wecom_userid?, status, agent_token?, agent_type, created_at }`，TTL 600s
- `agent:usercode:{user_code}` → `device_code`（授权页反查）
- `agent:boot:{boot_code}` → `{ device_code }`（setup 页 bootstrap 兑换，TTL 600s，一次性）
- `agent:identity:{wecom_userid}` → 解析后的角色/权限缓存，短 TTL（如 60s）
- 令牌**有效性不缓存**（每请求查 D1 一行，保证秒级吊销）

---

## 5. 授权流程

两条路径共用同一套 grant 机制。

### 5.1 主路径：Web setup 页（已登录，免输码）
员工进入 `web.hybcdg.com/agent/setup` 时已持有 Web 会话（身份已验明），因此**跳过设备流的"手输短码"**：

```
1. 选 agent 类型 + 填设备名
2. 点“生成安装命令”
   → POST /api/v1/agent/setup/provision (JWT)
     · 建 agent_grant(expires = now+180d)、生成 hybc_agent_<random>、存 hash
     · 建一次性 boot_code(KV, 600s) 映射到该令牌
   → 返回 { boot_code, install_sh_url, install_ps1_url }
3. 页面展示一行命令：
   curl -fsSL "https://api.hybcdg.com/api/v1/agent/install.sh?boot=XXXX" | sh
   （另附“下载安装器”按钮，双击即可，供非技术同事）
```
令牌全程不显示在屏幕/URL；`boot_code` 仅一次性、10 分钟、用于本地安装器兑换真正令牌。

### 5.2 备用路径：CLI 设备流（重装/6 月后续期）
已装好 MCP 后 `hybc-mcp login`，或令牌过期需续期：

```
1. POST /api/v1/agent/device/code {client_name, device_name}
   → { device_code, user_code, verification_uri, verification_uri_complete, expires_in:600, interval:5 }
2. CLI 打印并尝试打开 verification_uri_complete；员工在任意设备（含手机）打开
   → 未登录先走现有 WeCom OAuth → /agent/authorize?user_code=XXXX
   → 同意卡片（设备名+姓名+“有效期6个月，高危仍需微信确认”）→ 授权/拒绝
   → POST /api/v1/agent/device/approve {user_code} (JWT)：建 grant、标记 KV approved
3. CLI 轮询 POST /api/v1/agent/device/token {device_code}
   → authorization_pending / { agent_token, expires_at, wecom_userid, role }（一次性后即删 KV）
```

### 5.3 端点清单
| 方法 路径 | 鉴权 | 用途 |
|---|---|---|
| `POST /agent/device/code` | 免 | CLI 发起设备流 |
| `POST /agent/setup/provision` | JWT | Web setup 页直接建 grant + boot_code |
| `POST /agent/device/approve` | JWT | 授权同意页输码批准 |
| `POST /agent/device/token` | 免 | MCP/安装器轮询兑换（`device_code` 或 `boot_code`） |
| `GET /agent/install.sh` / `.ps1` | 免（可带 `?boot=`） | 安装脚本文本 |
| `GET /agent/dist/latest/bundle.tgz` | 免 | 从 R2(`FILES`) 取 MCP bundle |
| `GET /agent/grants` | JWT | 本人授权列表 |
| `POST /agent/grants/:id/revoke` | JWT | 吊销本人授权 |
| `GET /admin/agent/grants` | JWT+super_admin | 全部授权 |
| `POST /admin/agent/grants/:id/revoke` | JWT+super_admin | 吊销任意授权 |
| `GET /agent/pending/:id` | agent token | 查高危待确认状态/结果 |
| `POST /agent/pending/:id/confirm` | confirm_token 或 JWT | 员工确认 |
| `POST /agent/pending/:id/reject` | confirm_token 或 JWT | 员工拒绝 |

设备/令牌/脚本端点全部套 `rate-limit` 中间件。

---

## 6. 分发与安装（自托管一键脚本 + R2）

### 6.1 制品
- MCP 打成 **Node bundle**（单目录/单文件 JS + 依赖），版本化后传 **R2**，经 `GET /agent/dist/*` 提供。
- 代码**不上公共 npm**、公司掌控；因是 Node 脚本（非原生二进制）**无需代码签名**。
- 前提：员工机器有 Node（用 Claude Code/Codex 的基本都有）。脚本会检测缺失并给出安装指引。

### 6.2 安装器（`install.sh` / `install.ps1`）做什么
1. 检测 Node；缺失则提示。
2. 从 R2 拉 MCP bundle 到 `~/.hybc/mcp/`。
3. 若带 `?boot=`：用 boot_code 兑换长期令牌 → 写 `~/.hybc/credentials.json`(chmod 600)。
4. **写目标 agent 的 MCP 配置**（见 6.3）。
5. 放置 skill 指引（见 6.4）。
6. 打印完成与自检命令。

### 6.3 各 agent 的配置落点（安装器按 `agent_type` 自动写；未知则打印片段）
| agent | 配置 | 方式 |
|---|---|---|
| Claude Code | `claude mcp add --scope user hybc -- node ~/.hybc/mcp/server.js` | 优先调 CLI；否则写 `~/.claude.json` |
| Codex | `~/.codex/config.toml` 追加 `[mcp_servers.hybc]` | 幂等追加 |
| Claude Desktop | `claude_desktop_config.json`（mac: `~/Library/Application Support/Claude/`） | 合并 JSON |
| 其他 | — | 打印标准 stdio 配置片段 |

### 6.4 skill 的跨 agent 分发（重要）
`SKILL.md` 是 Claude/Claude Code 约定，**Codex 无同款 skill 系统**。因此指引分两层：
- **Agent 无关**：核心指引放进 MCP server 的 `instructions` 字段与若干 `prompts`（MCP 协议原生，任何客户端初始化即可获取）。
- **Claude Code 增强**：额外放 `~/.claude/skills/hybc/SKILL.md`。
- **Codex**：可选在项目 `AGENTS.md` 追加一段简短说明（安装器提示，不强制）。

---

## 7. 运行时鉴权（agent-token 分支）

`middleware/agent-auth.ts`（在 `authMiddleware` 之前判定 token 类型，或由其内部分派）：
- token 以 `hybc_agent_` 开头 → agent 分支：
  1. SHA-256 后按 `token_hash` 查 `agent_grant`（**每请求查 D1 一行，索引命中**）。
  2. 校验 `status=active` 且 `expires_at > now`；过期则置 `expired` 并 401。
  3. 节流更新 `last_used_at`。
  4. **实时解析该 `wecom_userid` 当前角色/权限**（复用登录时的 WeCom tag→role 逻辑；结果按 `agent:identity:{userid}` 短 TTL 缓存；解析失败用 `role_snapshot` 兜底）。
  5. 构造与现有一致的 `auth` 上下文：`auth_method:"mcp_agent"`、`via:"mcp"`、`sub:wecom_userid`、`grant_id`、roles/permissions。
  6. `c.set("auth", ...)` → 下游 `rbac` 与所有 `/api/v1` 路由**零改动**生效。
- 否则走现有 JWT 分支，行为不变。

**吊销即时**：不缓存令牌有效性，只缓存"贵"的身份解析；吊销后下一次请求即 401。

---

## 8. 高危延迟执行（人在环）

### 8.1 高危匹配表（声明式）
`services/agent-high-risk.ts` 维护 `(method + path 模式) → 风险分类` 列表，例如：
- `POST /approval/:id/approve`、`POST /approval/:id/reject`
- 付款提交：`POST /payment`、`POST /payment/:id/submit`
- 报销打款：`POST /reimbursement/*/payout`
- 合同金额变更相关端点
- （清单在实现时对齐现有路由，集中维护、单元测试覆盖）

### 8.2 时序
`middleware/agent-high-risk.ts`（鉴权后、handler 前，仅当 `via==="mcp"`）：
1. 命中高危且无有效确认 → 落 `agent_pending_action`（存整段请求）+ 生成 `summary`（含金额/单号）。
2. 生成一次性 `confirm_token`（存 hash），构造微信卡片链接 `web.hybcdg.com/agent/confirm?token=…`。
3. `services/agent-confirm-push.ts` 向 `wecom_userid` 推确认卡片（复用现有 WeCom 发送基础设施）：
   > 智能体请求：批准付款单 PT-20260716-003 ￥120,000。是你本人操作吗？ [确认] [拒绝]
4. 返回 MCP：`202 { pending_action_id, status:"awaiting_confirmation", poll_after:3 }`。
5. 员工点确认 → `POST /agent/pending/:id/confirm` → 标记 `confirmed`。
6. **服务端重放**：executor 依 `request_snapshot` 用 Hono `app.fetch()` 重建原请求，附**不可伪造的内部标记**（由服务端密钥 + pending 记录派生，绝不取自客户端 header）让高危闸门放行、`auth` 由 grant 重建 → 业务逻辑单一代码路径执行 → 存 `result_snapshot`。
7. MCP 轮询 `GET /agent/pending/:id` → done 时拿回与 Web 一致的响应 JSON。
8. 拒绝/超时（≈10 分钟）→ MCP 得 `rejected`/`expired`。

---

## 9. 审计与授权管理

- 每个 agent 请求 → `writeAuditLog`：`actorUserId=wecom_userid`、`action`、`targetType/targetId`、`detail={ via:"mcp_agent", grant_id, tool, params 摘要 }`。
- 高危三段全记：发起（pending 创建）、确认（谁/何时）、执行（结果/失败）。
- 员工自助：`/agent/grants` 查看/吊销本人设备授权。
- super_admin：`routes/admin.ts` + `views/agent/grants.vue` 管理全部授权、即时吊销。

---

## 10. `@hybc/mcp` 内容

### 10.1 工具集（分域、分期）
- **查询工具**（P1）：`search_projects`、`get_project`、`list_payments`、`get_payment`、`list_approvals`、`get_approval`、`list_contracts`、`warehouse_stock` 等 → 映射现有 GET 端点。
- **写工具**（P2）：`create_*`、`submit_approval`、`approve`/`reject` 等；遇 `202 awaiting_confirmation` 自动进入"已推微信确认 → 轮询 pending"循环，并把状态透传给用户。
- 首期不 1:1 包装全部路由；按价值分期扩展。

### 10.2 指引（`instructions` / `prompts` / `SKILL.md`）
统一说明：如何 `login`；有哪些工具；**遇 `awaiting_confirmation` 必须提示用户去微信点确认**；常见工作流；安全规范（**不得替用户自动确认高危、必须亮出金额与单号**）。

---

## 11. 安全考量

- 令牌：≥32 字节随机不透明；仅存 SHA-256；文件 `chmod 600`；仅前缀展示；明文绝不入日志。
- 6 个月硬过期，服务端强制；过期须重新登录。
- 即时吊销（每请求 D1 校验有效性）。
- `boot_code`/`confirm_token`/`user_code` 均一次性 + 短 TTL；设备/令牌/脚本端点限流。
- 高危内部重放标记不可伪造（服务端派生，不取自客户端）。
- 同意页与确认卡片必须清晰展示设备、身份、金额/单号、6 月有效期。
- WeCom 登录重新验明身份并写 `wecom_verified_at`。

---

## 12. 测试策略（复用现有 `*.test.ts` 模式）

- 单元：设备流状态机、boot 兑换一次性、令牌 hash、grant 过期/吊销、身份解析兜底、高危匹配器、重放守卫不可伪造。
- 集成：完整设备流（code→approve→token）、setup bootstrap 路径、agent 鉴权命中受保护路由、高危闸门 → pending → confirm → execute、拒绝/超时、吊销后即时 401。
- 目标覆盖率 ≥80%。

---

## 13. 分期

- **P1**：迁移 + 设备流/bootstrap + agent 鉴权 + 读工具 + 授权列表/吊销 + 审计 + 安装脚本/R2 分发 + setup 页。（可交付价值，风险最低）
- **P2**：高危延迟执行 + 微信确认 + 写工具 + confirm 页。
- **P3**：admin 管理 UI 完善、更多工具。

---

## 14. 已确认事项

1. **首批工具覆盖业务域**：项目、付款、审批、合同、库房。
2. **高危匹配表**：完整清单在实现时逐条对齐现有路由（集中维护 + 单元测试覆盖）。
3. **包位置**：`@hybc/mcp` 放入 monorepo `packages/mcp`，与现有工作区一致。
4. Claude Code plugin 打包壳：**不做**。
