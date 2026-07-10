import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";

const auditLogMock = vi.hoisted(() => ({
  writeAuditLog: vi.fn()
}));

const eventBusMock = vi.hoisted(() => ({
  publishEvent: vi.fn()
}));

vi.mock("./audit-log", () => ({
  writeAuditLog: auditLogMock.writeAuditLog
}));

vi.mock("./event-bus", () => ({
  publishEvent: eventBusMock.publishEvent
}));

import { reportCompensationFailure } from "./transaction-recovery";

const fakeEnv = { DB: {} } as unknown as Env;

beforeEach(() => {
  auditLogMock.writeAuditLog.mockReset();
  auditLogMock.writeAuditLog.mockResolvedValue(undefined);
  eventBusMock.publishEvent.mockReset();
  eventBusMock.publishEvent.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("reportCompensationFailure", () => {
  it("writes an audit log entry with the compensation-failed action", async () => {
    await reportCompensationFailure(fakeEnv, {
      operation: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: 42,
      actorUserId: "user-1",
      actorRoles: ["finance"],
      originalError: new Error("insert failed"),
      compensationError: new Error("rollback failed")
    });

    expect(auditLogMock.writeAuditLog).toHaveBeenCalledTimes(1);
    const [db, input] = auditLogMock.writeAuditLog.mock.calls[0];
    expect(db).toBe(fakeEnv.DB);
    expect(input).toMatchObject({
      actorUserId: "user-1",
      actorRoles: ["finance"],
      action: "system.transaction.compensation_failed",
      targetType: "reimbursement_envelope",
      targetId: 42
    });
  });

  it("publishes a TRANSACTION_COMPENSATION_FAILED event", async () => {
    await reportCompensationFailure(fakeEnv, {
      operation: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: 42,
      originalError: new Error("insert failed"),
      compensationError: new Error("rollback failed")
    });

    expect(eventBusMock.publishEvent).toHaveBeenCalledTimes(1);
    const [env, type, source] = eventBusMock.publishEvent.mock.calls[0];
    expect(env).toBe(fakeEnv);
    expect(type).toBe("TRANSACTION_COMPENSATION_FAILED");
    expect(source).toBe("reimbursement_envelope");
  });

  it("includes stringified operation/originalError/compensationError in the detail payload", async () => {
    await reportCompensationFailure(fakeEnv, {
      operation: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: 42,
      originalError: new Error("insert failed"),
      compensationError: new Error("rollback failed"),
      context: { new_envelope_id: 99 }
    });

    const [, auditInput] = auditLogMock.writeAuditLog.mock.calls[0];
    expect(auditInput.detail).toMatchObject({
      operation: "reimbursement.envelope.split",
      original_error: "insert failed",
      compensation_error: "rollback failed",
      new_envelope_id: 99
    });

    const [, , , eventPayload] = eventBusMock.publishEvent.mock.calls[0];
    expect(eventPayload).toMatchObject({
      operation: "reimbursement.envelope.split",
      original_error: "insert failed",
      compensation_error: "rollback failed",
      new_envelope_id: 99,
      target_id: 42
    });
  });

  it("stringifies non-Error originalError/compensationError values", async () => {
    await reportCompensationFailure(fakeEnv, {
      operation: "reimbursement.envelope.split",
      targetType: "reimbursement_envelope",
      targetId: 42,
      originalError: "plain string failure",
      compensationError: { code: 500 }
    });

    const [, auditInput] = auditLogMock.writeAuditLog.mock.calls[0];
    expect(auditInput.detail.original_error).toBe("plain string failure");
    expect(auditInput.detail.compensation_error).toBe("[object Object]");
  });

  it("never throws when writeAuditLog itself fails", async () => {
    auditLogMock.writeAuditLog.mockRejectedValue(new Error("DB unavailable"));

    await expect(
      reportCompensationFailure(fakeEnv, {
        operation: "reimbursement.envelope.split",
        targetType: "reimbursement_envelope",
        targetId: 42,
        originalError: new Error("insert failed"),
        compensationError: new Error("rollback failed")
      })
    ).resolves.toBeUndefined();

    // The event should still be attempted even though the audit log write failed.
    expect(eventBusMock.publishEvent).toHaveBeenCalledTimes(1);
  });

  it("never throws when publishEvent itself fails", async () => {
    eventBusMock.publishEvent.mockRejectedValue(new Error("queue unavailable"));

    await expect(
      reportCompensationFailure(fakeEnv, {
        operation: "reimbursement.envelope.split",
        targetType: "reimbursement_envelope",
        targetId: 42,
        originalError: new Error("insert failed"),
        compensationError: new Error("rollback failed")
      })
    ).resolves.toBeUndefined();

    expect(auditLogMock.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("never throws when both writeAuditLog and publishEvent fail", async () => {
    auditLogMock.writeAuditLog.mockRejectedValue(new Error("DB unavailable"));
    eventBusMock.publishEvent.mockRejectedValue(new Error("queue unavailable"));

    await expect(
      reportCompensationFailure(fakeEnv, {
        operation: "reimbursement.envelope.split",
        targetType: "reimbursement_envelope",
        targetId: 42,
        originalError: new Error("insert failed"),
        compensationError: new Error("rollback failed")
      })
    ).resolves.toBeUndefined();
  });
});
