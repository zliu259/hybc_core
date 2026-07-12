# 报销信封通道切换（办公室）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 办公室（super_admin/finance）可在报销单草稿/未登记/待签收状态下切换电子↔实体通道，切换后自动重跑 AI 核验。

**Architecture:** 新增专用端点 `POST /api/v1/reimbursement/:id/switch-channel`，准入规则抽成纯函数 `decideChannelSwitch`（仿 `reimbursement-create-policy.ts` 模式）；单条带乐观锁的 UPDATE 保证 D1 无事务下的原子性；切换后复用 `enqueueEnvelopeAiAudit(forceRerun: true)` 重跑核验。前端仅改 detail.vue（工作台各入口均经详情抽屉复用它）。

**Tech Stack:** Hono (CF Workers) + D1、vitest、Vue 3 + Element Plus。

**Spec:** `docs/superpowers/specs/2026-07-12-reimbursement-channel-switch-design.md`

## 文件清单

| 动作 | 路径 | 职责 |
|---|---|---|
| Create | `packages/api/src/routes/reimbursement-channel-switch-policy.ts` | 纯函数准入决策 |
| Create | `packages/api/src/routes/reimbursement-channel-switch-policy.test.ts` | 决策函数单测 |
| Create | `packages/api/src/routes/reimbursement-channel-switch.test.ts` | 路由级测试 |
| Modify | `packages/api/src/services/event-bus.ts` | 注册新事件类型 |
| Modify | `packages/api/src/routes/reimbursement.ts` | 新端点（插在 rebind-uuid 端点之后） |
| Modify | `packages/web/src/api/reimbursement.ts` | `switchReimbursementChannel` 封装 |
| Modify | `packages/web/src/views/finance/reimbursement/detail.vue` | 切换按钮 + 禁用编辑态通道下拉 |

## 背景速览（给零上下文工程师）

- 报销信封表 `reimbursement_envelope`：`channel` ∈ `physical`/`electronic`，`status` 流转 `draft/unregistered → submitted(待签收) → received → …`。库存空白信封的 `applicant_userid` 为 `"__UNASSIGNED__"`（`reimbursement.ts` 中常量 `UNASSIGNED_APPLICANT`）。
- 现状：`PUT /:id` 显式拒绝改通道（`"Envelope channel cannot be changed after creation"`，约 4500 行）——**这个不变式保持不动**，切换只走新端点。
- AI 核验入口：`enqueueEnvelopeAiAudit(env, id, options)`（`reimbursement.ts` 约 807 行，模块内函数、未导出）。它创建 `reimbursement_anomaly` 任务（payload 的 `review_strategy` 随 channel 不同）并把 `precheck_status` 置 `pending`；`forceRerun: true` 会开新一轮发票复核。
- 生产 D1 不支持事务（`runInTransaction` 静默降级），多步写必须"单条 UPDATE 原子 + WHERE 乐观锁"。
- 测试：vitest。纯函数测试仿 `reimbursement-create-policy.test.ts`；路由测试仿 `reimbursement-detail-status-guard.test.ts`（mock `../services/auth` 的 `verifyToken` + 手写 D1 mock 类捕获 SQL）。
- `publishEvent` 的事件类型是 `event-bus.ts` 里 `domainEventTypes` 封闭联合类型，新事件必须先注册否则编译失败。

---

### Task 1: 纯函数决策 `decideChannelSwitch`

**Files:**
- Test: `packages/api/src/routes/reimbursement-channel-switch-policy.test.ts`
- Create: `packages/api/src/routes/reimbursement-channel-switch-policy.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/api/src/routes/reimbursement-channel-switch-policy.test.ts`：

```typescript
import { describe, expect, it } from "vitest";

import { decideChannelSwitch } from "./reimbursement-channel-switch-policy";

const baseEnvelope = {
  status: "draft",
  channel: "physical" as const,
  applicant_userid: "operator.a"
};

const baseInput = {
  requestedChannel: "electronic",
  envelope: baseEnvelope,
  unassignedApplicant: "__UNASSIGNED__"
};

describe("decideChannelSwitch", () => {
  it("returns 404 error when envelope is missing", () => {
    const result = decideChannelSwitch({ ...baseInput, envelope: undefined });
    expect(result).toEqual({
      kind: "error",
      status: 404,
      message: "Envelope not found"
    });
  });

  it("rejects invalid channel value", () => {
    const result = decideChannelSwitch({
      ...baseInput,
      requestedChannel: "paper"
    });
    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: "Invalid reimbursement channel"
    });
  });

  it.each(["draft", "unregistered", "submitted"])(
    "allows switch from %s status",
    status => {
      const result = decideChannelSwitch({
        ...baseInput,
        envelope: { ...baseEnvelope, status }
      });
      expect(result).toEqual({
        kind: "switch",
        fromChannel: "physical",
        toChannel: "electronic"
      });
    }
  );

  it.each([
    "received",
    "batched",
    "pending_approval",
    "approved",
    "paid",
    "cancelled"
  ])("rejects switch from %s status", status => {
    const result = decideChannelSwitch({
      ...baseInput,
      envelope: { ...baseEnvelope, status }
    });
    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: `Envelope in status ${status} cannot switch channel`
    });
  });

  it("rejects unassigned inventory envelope", () => {
    const result = decideChannelSwitch({
      ...baseInput,
      envelope: { ...baseEnvelope, applicant_userid: "__UNASSIGNED__" }
    });
    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: "Unassigned inventory envelope cannot switch channel"
    });
  });

  it("returns noop when target channel equals current channel", () => {
    const result = decideChannelSwitch({
      ...baseInput,
      requestedChannel: "physical"
    });
    expect(result).toEqual({ kind: "noop", channel: "physical" });
  });

  it("allows electronic to physical direction as well", () => {
    const result = decideChannelSwitch({
      ...baseInput,
      requestedChannel: "physical",
      envelope: { ...baseEnvelope, channel: "electronic" as const }
    });
    expect(result).toEqual({
      kind: "switch",
      fromChannel: "electronic",
      toChannel: "physical"
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-channel-switch-policy.test.ts`
Expected: FAIL——`Cannot find module './reimbursement-channel-switch-policy'`（或等价的解析错误）

- [ ] **Step 3: 写最小实现**

创建 `packages/api/src/routes/reimbursement-channel-switch-policy.ts`：

```typescript
import type { ReimbursementChannel } from "../types/reimbursement";

export type ChannelSwitchDecisionInput = {
  requestedChannel: string;
  envelope?: {
    status: string;
    channel: ReimbursementChannel;
    applicant_userid: string;
  };
  unassignedApplicant: string;
};

export type ChannelSwitchDecision =
  | { kind: "error"; status: 400 | 404; message: string }
  | { kind: "noop"; channel: ReimbursementChannel }
  | {
      kind: "switch";
      fromChannel: ReimbursementChannel;
      toChannel: ReimbursementChannel;
    };

const switchableStatusSet = new Set<string>(["draft", "unregistered", "submitted"]);
const validChannels = new Set<string>(["physical", "electronic"]);

export const decideChannelSwitch = (
  input: ChannelSwitchDecisionInput
): ChannelSwitchDecision => {
  if (!input.envelope) {
    return { kind: "error", status: 404, message: "Envelope not found" };
  }

  if (!validChannels.has(input.requestedChannel)) {
    return {
      kind: "error",
      status: 400,
      message: "Invalid reimbursement channel"
    };
  }

  if (!switchableStatusSet.has(input.envelope.status)) {
    return {
      kind: "error",
      status: 400,
      message: `Envelope in status ${input.envelope.status} cannot switch channel`
    };
  }

  if (input.envelope.applicant_userid === input.unassignedApplicant) {
    return {
      kind: "error",
      status: 400,
      message: "Unassigned inventory envelope cannot switch channel"
    };
  }

  const requested = input.requestedChannel as ReimbursementChannel;

  if (input.envelope.channel === requested) {
    return { kind: "noop", channel: input.envelope.channel };
  }

  return {
    kind: "switch",
    fromChannel: input.envelope.channel,
    toChannel: requested
  };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-channel-switch-policy.test.ts`
Expected: PASS（14 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/reimbursement-channel-switch-policy.ts packages/api/src/routes/reimbursement-channel-switch-policy.test.ts
git commit -m "feat(api): 报销通道切换准入决策纯函数"
```

---

### Task 2: 路由端点 + 事件类型 + 路由级测试

**Files:**
- Test: `packages/api/src/routes/reimbursement-channel-switch.test.ts`
- Modify: `packages/api/src/services/event-bus.ts`（domainEventTypes 数组）
- Modify: `packages/api/src/routes/reimbursement.ts`（import 区 + rebind-uuid 端点之后插入新端点）

- [ ] **Step 1: 写失败的路由测试**

创建 `packages/api/src/routes/reimbursement-channel-switch.test.ts`：

```typescript
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes } from "./reimbursement";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
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

const createTaskMock = vi.hoisted(() => vi.fn());
vi.mock("../services/ai-slot", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/ai-slot")>()),
  createTask: createTaskMock
}));

const publishEventMock = vi.hoisted(() => vi.fn());
vi.mock("../services/event-bus", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/event-bus")>()),
  publishEvent: publishEventMock
}));

const writeAuditLogMock = vi.hoisted(() => vi.fn());
vi.mock("../services/audit-log", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/audit-log")>()),
  writeAuditLog: writeAuditLogMock
}));

type CapturedStatement = { sql: string; args: unknown[] };

class SwitchStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: SwitchDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ?")) {
      return this.db.envelopeRow as T;
    }
    if (
      this.sql.includes("FROM envelope_attachment") &&
      this.sql.includes("LIMIT 1")
    ) {
      return this.db.attachmentHeadRow as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    if (this.sql.includes("SET channel = ?")) {
      if (this.db.channelUpdateChanges > 0 && this.db.envelopeRow) {
        // 模拟真实 DB：UPDATE 生效后，后续 SELECT 读到新通道
        this.db.envelopeRow = {
          ...this.db.envelopeRow,
          channel: this.args[0]
        };
      }
      return { meta: { last_row_id: 1, changes: this.db.channelUpdateChanges } };
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class SwitchDb {
  executed: CapturedStatement[] = [];
  envelopeRow: Record<string, unknown> | null = null;
  attachmentHeadRow: Record<string, unknown> | null = null;
  channelUpdateChanges = 1;

  prepare(sql: string) {
    return new SwitchStatement(this, sql);
  }
}

const buildEnvelope = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 123,
  envelope_no: "uuid-envelope-123",
  envelope_uuid: "uuid-envelope-123",
  project_id: 7,
  applicant_userid: "operator.a",
  channel: "physical",
  status: "submitted",
  precheck_status: "none",
  invoice_unique_no: null,
  invoice_no: null,
  expense_date: null,
  amount: 100,
  category: null,
  description: null,
  batch_id: null,
  ...overrides
});

const createEnv = (db: SwitchDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestSwitch = (db: SwitchDb, body: Record<string, unknown>) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/123/switch-channel",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

const channelUpdates = (db: SwitchDb) =>
  db.executed.filter(item => item.sql.includes("SET channel = ?"));

describe("POST /reimbursement/:id/switch-channel", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["finance"] };
    createTaskMock.mockReset();
    publishEventMock.mockReset();
    writeAuditLogMock.mockReset();
  });

  it("rejects non-office roles with 403", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope();

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(403);
    expect(channelUpdates(db)).toHaveLength(0);
  });

  it("returns 404 when envelope is missing", async () => {
    const db = new SwitchDb();
    db.envelopeRow = null;

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(404);
  });

  it("rejects switch when status is received", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope({ status: "received" });

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(400);
    expect(channelUpdates(db)).toHaveLength(0);
  });

  it("rejects unassigned inventory envelope", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope({ applicant_userid: "__UNASSIGNED__" });

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(400);
  });

  it("rejects invalid channel value", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope();

    const response = await requestSwitch(db, { channel: "paper" });
    expect(response.status).toBe(400);
  });

  it("no-ops when target channel equals current channel", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope();

    const response = await requestSwitch(db, { channel: "physical" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { changed: boolean; ai_audit_triggered: boolean };
    };
    expect(payload.data.changed).toBe(false);
    expect(payload.data.ai_audit_triggered).toBe(false);
    expect(channelUpdates(db)).toHaveLength(0);
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("returns 409 when optimistic lock hits concurrent change", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope();
    db.channelUpdateChanges = 0;

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(409);
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("switches physical to electronic and reruns AI audit when attachments exist", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope();
    db.attachmentHeadRow = { id: 10 };

    const response = await requestSwitch(db, {
      channel: "electronic",
      reason: "员工误投实体信封"
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { channel: string; changed: boolean; ai_audit_triggered: boolean };
    };
    expect(payload.data.changed).toBe(true);
    expect(payload.data.channel).toBe("electronic");
    expect(payload.data.ai_audit_triggered).toBe(true);

    const updates = channelUpdates(db);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain(
      "status IN ('draft', 'unregistered', 'submitted')"
    );
    expect(updates[0].args[0]).toBe("electronic");
    expect(updates[0].args[3]).toBe("physical");

    // AI 核验以新通道策略整轮重跑
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        task_type: "reimbursement_anomaly",
        payload: expect.objectContaining({
          channel: "electronic",
          review_strategy: "electronic_qr_first_duplicate_by_invoice_no_date",
          rerun: true,
          review_reason: "channel_switch_to_electronic"
        })
      })
    );

    expect(publishEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED",
      "reimbursement_envelope",
      expect.objectContaining({
        envelope_id: 123,
        from_channel: "physical",
        to_channel: "electronic",
        reason: "员工误投实体信封",
        switched_by: "finance-a"
      })
    );

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "reimbursement.envelope.switch_channel",
        targetId: 123,
        detail: expect.objectContaining({
          from_channel: "physical",
          to_channel: "electronic"
        })
      })
    );
  });

  it("switches without AI audit when no active attachments", async () => {
    const db = new SwitchDb();
    db.envelopeRow = buildEnvelope({ status: "draft" });
    db.attachmentHeadRow = null;

    const response = await requestSwitch(db, { channel: "electronic" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { changed: boolean; ai_audit_triggered: boolean };
    };
    expect(payload.data.changed).toBe(true);
    expect(payload.data.ai_audit_triggered).toBe(false);
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(publishEventMock).toHaveBeenCalled();
    expect(writeAuditLogMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-channel-switch.test.ts`
Expected: FAIL——多数用例收到 404（端点不存在，Hono 落到 not found）

- [ ] **Step 3: 注册事件类型**

修改 `packages/api/src/services/event-bus.ts` 的 `domainEventTypes` 数组，在 `"REIMBURSEMENT_ENVELOPE_UUID_REBOUND",` 之后插入一行：

```typescript
  "REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED",
```

- [ ] **Step 4: 实现端点**

修改 `packages/api/src/routes/reimbursement.ts`：

(a) import 区，在 `import { decideCreateRouteBranch } from "./reimbursement-create-policy";` 之前加：

```typescript
import { decideChannelSwitch } from "./reimbursement-channel-switch-policy";
```

(b) 找到 `/:id/rebind-uuid` 端点的结束位置（搜 `swapped_placeholder_id: swappedPlaceholderId`，其所在 `return c.json({...})` 后的 `  }\n);` 即端点结尾，约 4233 行），在其后插入：

```typescript
reimbursementRoutes.post(
  "/:id/switch-channel",
  requireRoles(["super_admin", "finance"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as {
      channel?: unknown;
      reason?: unknown;
    };

    const envelope = await c.env.DB.prepare(
      "SELECT * FROM reimbursement_envelope WHERE id = ? AND status != 'deleted'"
    )
      .bind(id)
      .first<ReimbursementEnvelope>();

    const decision = decideChannelSwitch({
      requestedChannel: typeof body.channel === "string" ? body.channel : "",
      envelope: envelope
        ? {
            status: envelope.status,
            channel: envelope.channel,
            applicant_userid: envelope.applicant_userid
          }
        : undefined,
      unassignedApplicant: UNASSIGNED_APPLICANT
    });

    if (decision.kind === "error") {
      return c.json(
        { success: false, error: { message: decision.message } },
        decision.status
      );
    }

    if (decision.kind === "noop") {
      return c.json({
        success: true,
        data: {
          id,
          channel: decision.channel,
          changed: false,
          ai_audit_triggered: false
        }
      });
    }

    // 单条 UPDATE 原子生效；WHERE 携带旧通道与合法状态集作乐观锁，
    // 防止 SELECT 与 UPDATE 之间信封被并发提交/签收/切换。
    const now = nowIso();
    const result = await c.env.DB.prepare(
      `UPDATE reimbursement_envelope SET channel = ?, updated_at = ?
        WHERE id = ? AND channel = ? AND status IN ('draft', 'unregistered', 'submitted')`
    )
      .bind(decision.toChannel, now, id, decision.fromChannel)
      .run();

    if ((result.meta.changes ?? 0) === 0) {
      return c.json(
        {
          success: false,
          error: { message: "Envelope changed concurrently; please refresh and retry" }
        },
        409
      );
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

    const activeAttachment = await c.env.DB.prepare(
      "SELECT id FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' LIMIT 1"
    )
      .bind(id)
      .first<{ id: number }>();

    let aiAuditTriggered = false;
    if (activeAttachment) {
      await enqueueEnvelopeAiAudit(c.env, id, {
        forceRerun: true,
        triggeredBy: auth.sub,
        reason: `channel_switch_to_${decision.toChannel}`
      });
      aiAuditTriggered = true;
    }

    await publishEvent(
      c.env,
      "REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED",
      "reimbursement_envelope",
      {
        envelope_id: id,
        from_channel: decision.fromChannel,
        to_channel: decision.toChannel,
        reason,
        switched_by: auth.sub
      }
    );

    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "reimbursement.envelope.switch_channel",
      targetType: "reimbursement_envelope",
      targetId: id,
      detail: {
        from_channel: decision.fromChannel,
        to_channel: decision.toChannel,
        reason
      }
    });

    return c.json({
      success: true,
      data: {
        id,
        channel: decision.toChannel,
        changed: true,
        ai_audit_triggered: aiAuditTriggered
      }
    });
  }
);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/api && npx vitest run src/routes/reimbursement-channel-switch.test.ts`
Expected: PASS（9 个用例全绿）

- [ ] **Step 6: 跑 API 全量测试与类型检查**

Run: `cd packages/api && npm test && npm run typecheck`
Expected: 全部 PASS、tsc 无错误（确认没破坏既有用例）

- [ ] **Step 7: 提交**

```bash
git add packages/api/src/routes/reimbursement.ts packages/api/src/routes/reimbursement-channel-switch.test.ts packages/api/src/services/event-bus.ts
git commit -m "feat(api): 办公室报销信封通道切换端点，切换后自动重跑AI核验"
```

---

### Task 3: 前端 API 封装 + detail.vue 切换入口

**Files:**
- Modify: `packages/web/src/api/reimbursement.ts`
- Modify: `packages/web/src/views/finance/reimbursement/detail.vue`

- [ ] **Step 1: 加 API 封装**

在 `packages/web/src/api/reimbursement.ts` 中，紧跟 `rebindReimbursementEnvelopeUuid`（约 142 行）之后加：

```typescript
export const switchReimbursementChannel = (
  id: number,
  data: { channel: "physical" | "electronic"; reason?: string }
) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      channel: "physical" | "electronic";
      changed: boolean;
      ai_audit_triggered: boolean;
    };
  }>("post", `/api/v1/reimbursement/${id}/switch-channel`, { data });
};
```

- [ ] **Step 2: detail.vue 引入封装**

`packages/web/src/views/finance/reimbursement/detail.vue` 的 `@/api/reimbursement` import 列表中，在 `submitReimbursementEnvelope,` 之后按字母序插入：

```typescript
  switchReimbursementChannel,
```

- [ ] **Step 3: detail.vue 加状态与处理函数**

在 `submitRebindEnvelopeUuid` 函数定义结束之后（约 704 行 `};` 之后）插入：

```typescript
const SWITCHABLE_CHANNEL_STATUSES = new Set([
  "draft",
  "unregistered",
  "submitted"
]);

const canSwitchChannel = computed(() => {
  if (isCreate.value || !detail.value) return false;
  if (!roleSet.value.has("super_admin") && !roleSet.value.has("finance")) {
    return false;
  }
  return SWITCHABLE_CHANNEL_STATUSES.has(detail.value.status);
});

const switchingChannel = ref(false);

const onSwitchChannel = async () => {
  if (!detail.value || switchingChannel.value) return;
  const target =
    detail.value.channel === "physical" ? "electronic" : "physical";
  const targetLabel = target === "electronic" ? "电子发票" : "实物信封";
  let reason = "";
  try {
    const promptResult = (await ElMessageBox.prompt(
      `确认切换为「${targetLabel}」通道？切换后系统将自动重新进行 AI 核验。`,
      "切换报销通道",
      {
        confirmButtonText: "确认切换",
        cancelButtonText: "取消",
        inputPlaceholder: "切换原因（选填）"
      }
    )) as MessageBoxInputData;
    reason = (promptResult.value ?? "").trim();
  } catch {
    return;
  }
  switchingChannel.value = true;
  try {
    const result = await switchReimbursementChannel(detail.value.id, {
      channel: target,
      reason: reason || undefined
    });
    message(
      result.data.ai_audit_triggered
        ? `已切换为${targetLabel}通道，AI 核验已自动触发`
        : `已切换为${targetLabel}通道`,
      { type: "success" }
    );
    await loadDetail();
    notifyChanged();
  } catch (error) {
    message(resolveApiErrorMessage(error, "通道切换失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    switchingChannel.value = false;
  }
};
```

- [ ] **Step 4: detail.vue 模板改造**

把「通道」表单项（约 1313 行）从：

```vue
            <el-form-item label="通道">
              <el-select
                v-model="form.channel"
                style="width: 200px"
                :disabled="!canEdit"
              >
                <el-option label="实物信封" value="physical" />
                <el-option label="电子发票" value="electronic" />
              </el-select>
            </el-form-item>
```

改为（编辑态一律禁用下拉——现状是看似可改、保存必被后端 400 的陷阱；切换只走新按钮）：

```vue
            <el-form-item label="通道">
              <el-select
                v-model="form.channel"
                style="width: 200px"
                :disabled="!isCreate"
              >
                <el-option label="实物信封" value="physical" />
                <el-option label="电子发票" value="electronic" />
              </el-select>
              <el-button
                v-if="canSwitchChannel"
                type="warning"
                plain
                :loading="switchingChannel"
                style="margin-left: 8px"
                @click="onSwitchChannel"
                >切换通道</el-button
              >
              <span
                v-if="!isCreate && !canSwitchChannel"
                class="channel-locked-hint"
                >通道创建后不可修改</span
              >
            </el-form-item>
```

- [ ] **Step 5: 加提示样式**

在 detail.vue 底部 `<style scoped>` 内追加：

```css
.channel-locked-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
```

- [ ] **Step 6: 类型检查与 lint**

Run: `cd packages/web && npm run typecheck && npx eslint src/views/finance/reimbursement/detail.vue src/api/reimbursement.ts`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add packages/web/src/api/reimbursement.ts packages/web/src/views/finance/reimbursement/detail.vue
git commit -m "feat(web): 报销详情办公室切换通道入口，编辑态锁定通道下拉"
```

---

### Task 4: 全量验证与开发记录

**Files:**
- Modify: `doc/开发记录.md`（追加一条记录，遵守"单文件追加、不新建日志"约定）

- [ ] **Step 1: 全量验证**

Run: `cd packages/api && npm test && npm run typecheck && cd ../web && npm run typecheck`
Expected: 全部通过

- [ ] **Step 2: 追加开发记录**

在 `doc/开发记录.md` 末尾追加（日期用当天，格式沿用文件既有条目风格）：

```markdown
## 2026-07-12 报销信封通道切换（办公室）

- 新端点 `POST /api/v1/reimbursement/:id/switch-channel`（super_admin/finance），草稿/未登记/待签收状态下电子↔实体自由切换，UUID/信封号不变。
- 切换成功且有活跃附件时自动 `enqueueEnvelopeAiAudit(forceRerun)` 整轮重跑 AI 核验（复核轮策略与新通道一致）；无附件只切通道。
- 单条 UPDATE + WHERE 旧通道/状态集乐观锁适配 D1 无事务；同通道请求幂等 no-op。
- 事件 `REIMBURSEMENT_ENVELOPE_CHANNEL_SWITCHED` + 审计 `reimbursement.envelope.switch_channel`。
- 前端 detail.vue：办公室在通道栏一键切换（弹窗确认+选填原因）；编辑态通道下拉改为始终禁用（原为可选但保存必 400 的陷阱）。
- 设计文档：docs/superpowers/specs/2026-07-12-reimbursement-channel-switch-design.md
```

- [ ] **Step 3: 提交**

```bash
git add doc/开发记录.md
git commit -m "docs: 报销通道切换开发记录"
```
