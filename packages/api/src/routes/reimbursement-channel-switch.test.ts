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
