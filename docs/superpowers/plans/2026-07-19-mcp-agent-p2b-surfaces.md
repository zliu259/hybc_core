# MCP 智能体接入 — P2b：确认页 + MCP 写工具 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 P2a 的人在环闭环真正可用——员工能在网页确认页看清「将要执行什么」并确认/拒绝，agent 能通过 MCP 写工具发起并轮询结果。

**Architecture:** 纯消费 P2a 已部署的 4 个端点，不动后端。web 侧加一个 `confirm.vue`（hash 路由，未登录经 P1c redirect 贯通回来）+ 3 个 api 包装；mcp 侧加 2 个写工具 + 1 个查询工具，并改写 `instructions`/`SKILL.md` 中「只读」的断言。

**Tech Stack:** Vue 3 `<script setup>` + Element Plus（pnpm）、vitest(happy-dom)；`@hybc/mcp`（npm）+ zod + MCP SDK。

**上游：** 设计 `docs/superpowers/specs/2026-07-17-mcp-agent-p2-design.md` §6/§7；P2a 引擎已合并部署（`1618b08`）。

---

## 依赖与既有事实（recon 已确认，直接采信）

### P2a 已部署的端点契约

| 方法 路径 | 鉴权 | 返回 |
|---|---|---|
| `GET /api/v1/agent/pending/by-token/:token` | JWT + human + 本人 | `ok(PendingPublicView)`；非本人/不存在 → **404** |
| `GET /api/v1/agent/pending/:id` | agent 令牌(本 grant) 或 human(本人) | `ok(PendingPublicView)`；否则 404 |
| `POST /api/v1/agent/pending/:id/confirm` | JWT + human + 本人 | `ok(PendingPublicView)`；非本人 → 403；密钥不可用 → **503 且不认领**（行留 `confirmed`，可重试） |
| `POST /api/v1/agent/pending/:id/reject` | JWT + human + 本人 | `ok({ ...PendingPublicView, rejected: boolean })`——`rejected:false` 表示动作已被他路结算 |

`PendingPublicView`（`packages/api/src/types/agent.ts`）：
```typescript
{
  id: string; action_kind: string; summary: string;
  status: "pending"|"confirmed"|"executing"|"done"|"failed"|"rejected"|"expired";
  detail: PendingActionDetail | null;   // 历史行/损坏 JSON 为 null
  created_at: string; expires_at: string;
  confirmed_at: string | null; executed_at: string | null;
  result: unknown | null;
}
```
`PendingActionDetail`（`packages/api/src/services/agent-action-detail.ts:73`）：
```typescript
{
  action_kind: string;
  verb: string | null;              // 未登记的 action_kind 为 null，绝不兜底成「批准」
  target: string;                   // 如「审批单 #42」
  approval: {                       // 查不到为 null
    instance_no: string; biz_type: string; biz_summary: string; initiator_userid: string;
  } | null;
  agent_comment: string | null;     // 【智能体填写的、将以员工名义入库的意见】已消毒
}
```

**park 时 agent 收到的 202 体**：`ok({ pending_action_id, status:"awaiting_confirmation", summary, expires_at, action_kind, ... })`。
**超额时**：`429`，`error.message` 与 `data.reason` 都带原因（`too_many_outstanding` / 滚动预算）。

### 前端（packages/web，pnpm）
- 路由模块 `src/router/modules/agent.ts` 已存在，父级带 `showLink:false`（P2 冻结期隐藏），子路由 `setup`/`grants`/`authorize`。
- `src/api/agent.ts` 已有 8 个包装 + `AGENT_TYPE_LABELS`/`agentTypeLabel`。约定：`http.request<{success;data}>("get"|"post", "/api/v1/...", { params }|{ data })`。
- 页面约定：`message()` 来自 `@/utils/message`（不用裸 ElMessage）；`ElMessageBox.confirm` 做二次确认；**不用 el-form `:rules`**；时间用 `dayjs(v).format("YYYY-MM-DD HH:mm")`（本地时区）。
- **hash 路由**：确认页必须能从 `/#/agent/confirm?token=` 进入；未登录时 P1c 的 redirect 贯通会带回原 URL。
- 测试：vitest + happy-dom + @vue/test-utils，colocated；`pnpm test`。

### MCP（packages/mcp，npm）
- `ToolDef { name, title, description, inputSchema: Record<string, z.ZodTypeAny>, handler }`（`src/tools/types.ts`），`textResult(payload)` 包装返回。
- 注册：`src/tools/index.ts` 的 `allToolDefs(client)` 汇总各域数组。
- `HybcApiClient`（`src/api-client.ts`）：`get`/`post` 都返回 `Envelope<T> = { data, pagination? }`；**HTTP 状态码被丢弃**；`!res.ok || json.success===false` → 抛 `ApiError(json?.error?.message || "HTTP {status}", status)`（`ApiError.status` 可读）。
- `src/instructions.ts:3` 现断言「只提供【只读】工具…没有写操作」，`:9` 说写操作尚未开放 —— **本计划必须改写**。

**流程约束：** 分支 `feat/mcp-agent-p2b`（已建）。web 用 **pnpm**、mcp 用 **npm**。合并 push main 即部署。**KV flag `agent:highrisk:config` 生产仍为关；本计划不翻开关**（翻开关是 P2b 冒烟通过后的独立运营动作）。

---

## 文件结构

**修改 `packages/web/`**
- `src/api/agent.ts` — 加 `PendingActionDetail`/`PendingPublicView` 类型 + 4 个包装
- `src/router/modules/agent.ts` — 加 `/agent/confirm` 子路由（`showLink:false`）
- `src/views/agent/confirm.vue` — 新建确认页
- `src/views/agent/confirm.spec.ts` — 组件测试

**修改 `packages/mcp/`**
- `src/tools/approvals-write.ts` — 新建：`approve_task`/`reject_task`/`check_pending`
- `src/tools/approvals-write.test.ts` — 新建
- `src/tools/index.ts` — 注册
- `src/instructions.ts` — 改写只读断言
- `SKILL.md` — 同步

**文档**：`doc/UI设计文档.md`（确认页）、`doc/开发记录.md`（追加）

---

## Task 1: web api 包装（TDD 可选，类型为主）

**Files:** Modify `packages/web/src/api/agent.ts`

- [ ] **Step 1: 加类型与包装**（追加到文件末尾，风格照既有包装）

```typescript
export type PendingApprovalContext = {
  instance_no: string;
  biz_type: string;
  biz_summary: string;
  initiator_userid: string;
};

export type PendingActionDetail = {
  action_kind: string;
  /** 未登记的动作类型为 null —— 页面必须显式处理，绝不兜底成「批准」 */
  verb: string | null;
  target: string;
  approval: PendingApprovalContext | null;
  /** 智能体填写、将以员工名义入库的意见 */
  agent_comment: string | null;
};

export type PendingStatus =
  | "pending" | "confirmed" | "executing" | "done" | "failed" | "rejected" | "expired";

export type PendingPublicView = {
  id: string;
  action_kind: string;
  summary: string;
  status: PendingStatus;
  detail: PendingActionDetail | null;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  result: unknown | null;
};

/** 确认页首屏：用卡片链接里的一次性 token 定位待确认动作（仅本人可见，否则 404）。 */
export const getPendingByToken = (token: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "get",
    `/api/v1/agent/pending/by-token/${encodeURIComponent(token)}`
  );
};

export const getPendingAction = (id: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "get",
    `/api/v1/agent/pending/${id}`
  );
};

export const confirmPendingAction = (id: string) => {
  return http.request<{ success: boolean; data: PendingPublicView }>(
    "post",
    `/api/v1/agent/pending/${id}/confirm`
  );
};

export const rejectPendingAction = (id: string) => {
  return http.request<{ success: boolean; data: PendingPublicView & { rejected: boolean } }>(
    "post",
    `/api/v1/agent/pending/${id}/reject`
  );
};
```

- [ ] **Step 2: typecheck + Commit**

Run: `cd packages/web && pnpm typecheck`
```bash
git add packages/web/src/api/agent.ts
git commit -m "feat(web): pending 确认相关 api 包装与类型"
```

---

## Task 2: 确认页 confirm.vue（含组件测试）

**Files:** Create `packages/web/src/views/agent/confirm.vue`、`confirm.spec.ts`；Modify `src/router/modules/agent.ts`

> 这一页是**人在环的唯一人类界面**。设计要点：先让人看清「谁的哪个设备、要以我的名义做什么、agent 写了什么意见」，再给不可逆的两个按钮。

- [ ] **Step 1: 写失败测试** `packages/web/src/views/agent/confirm.spec.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  getPendingByToken: vi.fn(),
  confirmPendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  message: vi.fn()
}));

vi.mock("@/api/agent", () => ({
  getPendingByToken: mocks.getPendingByToken,
  confirmPendingAction: mocks.confirmPendingAction,
  rejectPendingAction: mocks.rejectPendingAction
}));
vi.mock("@/utils/message", () => ({ message: mocks.message }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { token: "tok-1" } })
}));

import Confirm from "./confirm.vue";

const view = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  action_kind: "approval.approve",
  summary: "批准审批单 #42",
  status: "pending",
  detail: {
    action_kind: "approval.approve",
    verb: "批准",
    target: "审批单 #42",
    approval: {
      instance_no: "SP-20260719-001",
      biz_type: "payment",
      biz_summary: "PT-001 | 某某公司 | ￥120,000",
      initiator_userid: "ZhangSan"
    },
    agent_comment: "金额与合同一致，建议批准"
  },
  created_at: "2026-07-19T02:00:00.000Z",
  expires_at: "2026-07-19T02:10:00.000Z",
  confirmed_at: null,
  executed_at: null,
  result: null,
  ...over
});

const mountPage = async (data: unknown) => {
  mocks.getPendingByToken.mockResolvedValue({ success: true, data });
  const w = mount(Confirm, { global: { stubs: { "el-button": { template: "<button @click=\"$emit('click')\"><slot/></button>" } } } });
  await flushPromises();
  return w;
};

beforeEach(() => vi.clearAllMocks());

describe("confirm.vue 展示", () => {
  it("渲染动作、目标、业务上下文与 agent 意见", async () => {
    const w = await mountPage(view());
    const text = w.text();
    expect(text).toContain("批准");
    expect(text).toContain("审批单 #42");
    expect(text).toContain("SP-20260719-001");
    expect(text).toContain("￥120,000");
    expect(text).toContain("金额与合同一致，建议批准");
  });

  it("把 agent 意见明确标注为智能体填写、将以本人名义入库", async () => {
    const w = await mountPage(view());
    expect(w.text()).toContain("智能体填写");
    expect(w.text()).toContain("你的名义");
  });

  it("verb 为 null 时不臆造动词，改为提示动作类型未登记", async () => {
    const w = await mountPage(view({ detail: { ...(view().detail as object), verb: null } }));
    expect(w.text()).not.toContain("批准审批单 #42（");
    expect(w.text()).toContain("approval.approve");
  });

  it("detail 为 null（历史行）时降级为 summary，仍可操作", async () => {
    const w = await mountPage(view({ detail: null }));
    expect(w.text()).toContain("批准审批单 #42");
  });

  it("token 无效时提示且不渲染操作按钮", async () => {
    mocks.getPendingByToken.mockRejectedValue(new Error("404"));
    const w = mount(Confirm);
    await flushPromises();
    expect(w.text()).toContain("无法打开");
    expect(w.text()).not.toContain("确认执行");
  });
});

describe("confirm.vue 操作", () => {
  it("确认成功后展示终态，不再显示操作按钮", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockResolvedValue({ success: true, data: view({ status: "done" }) });
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();
    expect(mocks.confirmPendingAction).toHaveBeenCalledWith("p1");
    expect(w.text()).toContain("已执行");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
  });

  it("密钥未配置(503)时提示可稍后重试，且不把动作显示为失败", async () => {
    const w = await mountPage(view());
    const err = Object.assign(new Error("配置"), { response: { status: 503 } });
    mocks.confirmPendingAction.mockRejectedValue(err);
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();
    expect(mocks.message).toHaveBeenCalled();
    // 仍停留在可确认状态，供稍后重试
    expect(w.find("button.confirm-btn").exists()).toBe(true);
  });

  it("拒绝后展示已拒绝", async () => {
    const w = await mountPage(view());
    mocks.rejectPendingAction.mockResolvedValue({
      success: true,
      data: { ...view({ status: "rejected" }), rejected: true }
    });
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已拒绝");
  });

  it("rejected:false（已被他路结算）时如实展示当前状态而非谎报成功", async () => {
    const w = await mountPage(view());
    mocks.rejectPendingAction.mockResolvedValue({
      success: true,
      data: { ...view({ status: "done" }), rejected: false }
    });
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已执行");
  });

  it("已过期时不显示操作按钮", async () => {
    const w = await mountPage(view({ status: "expired" }));
    expect(w.find("button.confirm-btn").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && pnpm test -- src/views/agent/confirm.spec.ts`
Expected: FAIL（confirm.vue 不存在）。

- [ ] **Step 3: 实现 `confirm.vue`**

要求（实现者按这些约束写，样式照 `views/agent/authorize.vue` 的卡片风格）：
- `onMounted` 读 `route.query.token`；缺失或请求失败 → 展示「无法打开此确认链接」并**不渲染操作按钮**。
- 主体按顺序展示：**动作**（`detail.verb ?? 未登记动作类型` + `detail.target`）、**业务上下文**（`approval.instance_no` / `biz_summary` / `initiator_userid`，为 null 则整块省略）、**智能体意见**（`agent_comment`，用 `el-alert` 或独立块，文案须含「智能体填写」与「将以你的名义记入审批意见」；为 null 则显示「智能体未填写意见」）。
- `detail` 为 null 时降级用 `summary`，仍允许操作。
- 仅当 `status === "pending"` 时渲染「确认执行」(`class="confirm-btn"`) 与「拒绝」(`class="reject-btn"`)；其余状态渲染 `el-result` 终态（`done`→已执行 / `failed`→执行失败 / `rejected`→已拒绝 / `expired`→已过期 / `confirmed`|`executing`→处理中）。
- 确认前用 `ElMessageBox.confirm` 二次确认，文案复述动作与目标。
- 确认/拒绝后用返回的 view 覆盖本地状态（**以服务端返回为准**，不本地臆测）。
- 503 分支：`error?.response?.status === 503` → `message("系统尚未完成配置，请稍后重试或联系管理员", { type: "warning" })`，**保持可重试**（不改状态）。
- 其余错误 → `message(...)` 提示，保持当前状态。
- 时间用 `dayjs` 本地时区展示 `expires_at`。

- [ ] **Step 4: 加路由**（`src/router/modules/agent.ts` 的 `children` 末尾）

```typescript
    {
      path: "/agent/confirm",
      name: "AgentConfirm",
      component: () => import("@/views/agent/confirm.vue"),
      meta: {
        title: "高危操作确认",
        showLink: false,
        roles: ["super_admin", "manager", "site_manager", "finance", "operator"]
      }
    }
```

- [ ] **Step 5: 校验 + Commit**

Run: `cd packages/web && pnpm test -- src/views/agent/confirm.spec.ts` → PASS
Run: `cd packages/web && pnpm test && pnpm typecheck && pnpm build`
```bash
git add packages/web/src/views/agent/confirm.vue packages/web/src/views/agent/confirm.spec.ts packages/web/src/router/modules/agent.ts
git commit -m "feat(web): 高危操作确认页（展示将执行什么 + agent 意见）"
```

---

## Task 3: MCP 写工具（TDD）

**Files:** Create `packages/mcp/src/tools/approvals-write.ts`、`approvals-write.test.ts`；Modify `src/tools/index.ts`

> **关键约束**：`HybcApiClient` 丢弃 HTTP 状态码，`!res.ok` 会抛 `ApiError(message, status)`。park 返回的是 **202 + success:true**，所以**不会抛**，走正常返回；判定依据是 `data.status === "awaiting_confirmation"`，**不是**状态码。

- [ ] **Step 1: 写失败测试** `packages/mcp/src/tools/approvals-write.test.ts`

```typescript
import { describe, expect, it, vi } from "vitest";

import { approvalWriteTools } from "./approvals-write";

const clientWith = (post: unknown, get?: unknown) =>
  ({ post: post as never, get: (get ?? vi.fn()) as never }) as never;

const toolOf = (name: string, client: unknown) =>
  approvalWriteTools(client as never).find((t) => t.name === name)!;

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe("approve_task", () => {
  it("把 202 awaiting_confirmation 如实透传，并要求用户去微信确认", async () => {
    const post = vi.fn(async () => ({
      data: {
        pending_action_id: "p1",
        status: "awaiting_confirmation",
        summary: "批准审批单 #42",
        expires_at: "2026-07-19T02:10:00.000Z"
      }
    }));
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 42, comment: "同意" }));
    expect(post).toHaveBeenCalledWith("/approval/42/approve", { comment: "同意" });
    expect(out.status).toBe("awaiting_confirmation");
    expect(out.pending_action_id).toBe("p1");
    expect(JSON.stringify(out)).toContain("微信");
  });

  it("超额(429)时把原因如实交回，不重试", async () => {
    const { ApiError } = await import("../api-client.js");
    const post = vi.fn(async () => {
      throw new ApiError("待确认动作过多，请先处理", 429);
    });
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 42 }));
    expect(out.error).toContain("待确认动作过多");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("高危写未开放(403)时说明并引导网页端操作", async () => {
    const { ApiError } = await import("../api-client.js");
    const post = vi.fn(async () => {
      throw new ApiError("智能体令牌为只读，禁止写操作", 403);
    });
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 1 }));
    expect(out.error).toBeTruthy();
    expect(JSON.stringify(out)).toContain("网页");
  });

  it("comment 省略时不发送该字段", async () => {
    const post = vi.fn(async () => ({ data: { status: "awaiting_confirmation", pending_action_id: "p" } }));
    const t = toolOf("approve_task", clientWith(post));
    await t.handler({ id: 7 });
    expect(post).toHaveBeenCalledWith("/approval/7/approve", {});
  });
});

describe("reject_task", () => {
  it("打到 reject 端点", async () => {
    const post = vi.fn(async () => ({ data: { status: "awaiting_confirmation", pending_action_id: "p" } }));
    const t = toolOf("reject_task", clientWith(post));
    await t.handler({ id: 9, comment: "不同意" });
    expect(post).toHaveBeenCalledWith("/approval/9/reject", { comment: "不同意" });
  });
});

describe("check_pending", () => {
  it("查询待确认动作状态", async () => {
    const get = vi.fn(async () => ({ data: { id: "p1", status: "done", result: { status: 200 } } }));
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    const out = parse(await t.handler({ pending_action_id: "p1" }));
    expect(get).toHaveBeenCalledWith("/agent/pending/p1");
    expect(out.status).toBe("done");
  });

  it("找不到时如实报错而非假装还在等待", async () => {
    const { ApiError } = await import("../api-client.js");
    const get = vi.fn(async () => {
      throw new ApiError("not found", 404);
    });
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    const out = parse(await t.handler({ pending_action_id: "nope" }));
    expect(out.error).toBeTruthy();
  });
});

describe("工具描述", () => {
  it("三个工具都在，且写工具的描述写明需本人微信确认", () => {
    const defs = approvalWriteTools(clientWith(vi.fn()));
    expect(defs.map((d) => d.name).sort()).toEqual(["approve_task", "check_pending", "reject_task"]);
    const approve = defs.find((d) => d.name === "approve_task")!;
    expect(approve.description).toContain("确认");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/mcp && npm test -- src/tools/approvals-write.test.ts` → FAIL（module not found）。

- [ ] **Step 3: 实现 `packages/mcp/src/tools/approvals-write.ts`**

要求：
- 导出 `approvalWriteTools(client: HybcApiClient): ToolDef[]`，含 `approve_task`、`reject_task`、`check_pending`。
- `approve_task`/`reject_task` 入参 `{ id: z.number().int(), comment: z.string().optional() }`；body 仅在 `comment` 存在时带该字段。
- **收到 `data.status === "awaiting_confirmation"` 时**：返回体必须包含 `pending_action_id`、`summary`、`expires_at`，以及一句给 agent 看的行动指引，明确要求**提示用户去企业微信确认**、**不得代替用户确认**、可用 `check_pending` 查询。
- 所有 `ApiError` 一律捕获，返回 `{ error: <message>, status: <ApiError.status>, hint: ... }`——**如实交回，不重试、不吞掉**。403 的 hint 引导用户去网页端操作；429 的 hint 说明待确认过多需先处理。
- `check_pending` 入参 `{ pending_action_id: z.string() }` → `GET /agent/pending/{id}`，原样返回。
- 文件头注释说明：这些工具**只能发起**，真正落库由员工在微信确认后由服务端重放完成。

- [ ] **Step 4: 注册**（`src/tools/index.ts`）

import `approvalWriteTools` 并加入 `allToolDefs` 数组末尾。

- [ ] **Step 5: 校验 + Commit**

Run: `cd packages/mcp && npm test -- src/tools/approvals-write.test.ts` → PASS
Run: `cd packages/mcp && npm test && npm run typecheck && npm run build`
```bash
git add packages/mcp/src/tools/approvals-write.ts packages/mcp/src/tools/approvals-write.test.ts packages/mcp/src/tools/index.ts
git commit -m "feat(mcp): 审批写工具（发起→微信确认→轮询）"
```

---

## Task 4: 改写 instructions 与 SKILL.md

**Files:** Modify `packages/mcp/src/instructions.ts`、`packages/mcp/SKILL.md`

> 当前 `instructions.ts:3` 断言「只提供【只读】工具…没有写操作」，`:9` 说写操作尚未开放——上线写工具后这两句就是**谎报**，agent 会据此拒绝用户的合理请求。

- [ ] **Step 1: 改写 instructions.ts**

把只读断言改为如实描述：查询工具 + **两个需本人微信确认的写工具**。必须写明：
- `approve_task`/`reject_task` **不会立即生效**，服务端会 park 并推送企业微信卡片给本人；
- 收到 `awaiting_confirmation` 时**必须提示用户去企业微信确认**，**绝不能代替用户确认**，也不要反复重试同一动作（会撞待确认上限）；
- 可用 `check_pending(pending_action_id)` 查询终态；
- 亮出单号/金额等关键信息给用户看；
- 若返回 403「只读」，说明该能力当前未开放，引导用户在网页端完成。

- [ ] **Step 2: SKILL.md 同步**

同样把「只读」表述改为「查询 + 需本人确认的审批写」，并补一段典型工作流（发起 → 提示用户看微信 → check_pending → 报告结果）。

- [ ] **Step 3: 校验 + Commit**

Run: `cd packages/mcp && npm test && npm run typecheck`
```bash
git add packages/mcp/src/instructions.ts packages/mcp/SKILL.md
git commit -m "docs(mcp): 指引改为「查询 + 需本人微信确认的写」，禁止代替用户确认"
```

---

## Task 5: 本地端到端 + 文档

- [ ] **Step 1: 本地闭环冒烟**

前置：`cd packages/api && npm run dev`（8787，`APP_ENV=local` → flag 默认开）；另开 `cd packages/web && pnpm dev`（8849）。

1. 本地登录拿 JWT → provision + redeem 拿 agent_token（步骤同 P2a 冒烟）。
2. agent 令牌 `POST /api/v1/approval/1/approve` → 202 `awaiting_confirmation`，记下 `pending_action_id`。
3. 从 D1 取该行的 `confirm_token_hash` 对应的明文 token——**明文只在 park 时返回过一次**，本地可改从 `GET /api/v1/agent/pending/<id>`（用 agent 令牌）确认状态，然后**直接用 id 走确认页的 fallback**：浏览器开 `http://localhost:8849/#/agent/confirm?token=<从企微卡片日志里拿到的 token>`。若本地企微推送失败拿不到 token，则改用 `POST /api/v1/agent/pending/<id>/confirm` 验证后端，并在报告中注明确认页的 token 入口未能本地端到端验证。
4. 确认页应展示：动作、目标、业务上下文、**agent 填写的意见**；点「确认执行」→ 终态。
5. MCP 侧：用 `packages/mcp` 的工具（可直接调 `approvalWriteTools` 的 handler，或跑 stdio）验证 202 透传与 `check_pending`。

**如实报告哪一步无法本地闭环**，不要粉饰。

- [ ] **Step 2: 文档**

- `doc/UI设计文档.md`：在「智能体接入」章节补确认页（入口=企微卡片、展示内容、两个按钮、各终态、非本人 404）。
- `doc/开发记录.md`：追加 P2b 条目（确认页 + 写工具 + 指引改写；强调工具只能发起、落库由确认后重放完成）。

- [ ] **Step 3: 最终校验 + Commit**

Run: `cd packages/web && pnpm test && pnpm typecheck && pnpm build`
Run: `cd packages/mcp && npm test && npm run typecheck && npm run build`
```bash
git add doc/UI设计文档.md doc/开发记录.md
git commit -m "docs: P2b 确认页与 MCP 写工具"
```

---

## Self-Review 记录（对照 spec §6/§7）

- **§6 confirm.vue（token 入口、身份校验、展示全貌、确认/拒绝）** → Task 2 ✅（身份校验在后端 by-token 做，非本人 404；页面据此提示）
- **§6 路由 + api 包装** → Task 1、Task 2 Step 4 ✅
- **§7 写工具 + 202 处理 + check_pending** → Task 3 ✅（依据 `data.status` 而非状态码——契约已核实）
- **§7 instructions/SKILL 改写** → Task 4 ✅
- **P2a 新增的 detail 投影** → Task 2 展示 agent_comment，兑现「让员工看清将要执行什么」✅
- **不在本计划**：翻开 KV flag（运营动作）、取消 `/agent` 菜单 `showLink:false`、付款/报销写工具（P3）

**类型一致性**：web 的 `PendingPublicView`/`PendingActionDetail` 与 api 的同名类型逐字段对齐；`rejected` 仅在 reject 返回上；MCP 工具名 `approve_task`/`reject_task`/`check_pending` 在测试、实现、注册、instructions 四处一致。

**占位符扫描**：无 TBD；每个改代码的步骤给了代码或可执行的约束清单。

## 开放问题

1. 确认页目前不做轮询——`confirmed`/`executing` 属瞬时中间态，确认请求本身是同步返回终态的。若将来重放改异步，需加轮询。
2. 本地冒烟拿不到明文 confirm token（只在 park 时返回一次、企微推送本地会失败）。已在 Task 5 给出降级验证路径并要求如实标注。
