import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";
import type { IntegrityIssue, IntegritySummary } from "./reimbursement-integrity";

const integrityMock = vi.hoisted(() => ({
  findReimbursementIntegrityIssues: vi.fn(),
  summarizeIntegrityIssues: vi.fn()
}));

const auditLogMock = vi.hoisted(() => ({
  writeAuditLog: vi.fn()
}));

const eventBusMock = vi.hoisted(() => ({
  publishEvent: vi.fn()
}));

vi.mock("./reimbursement-integrity", () => ({
  findReimbursementIntegrityIssues: integrityMock.findReimbursementIntegrityIssues,
  summarizeIntegrityIssues: integrityMock.summarizeIntegrityIssues
}));

vi.mock("./audit-log", () => ({
  writeAuditLog: auditLogMock.writeAuditLog
}));

vi.mock("./event-bus", () => ({
  publishEvent: eventBusMock.publishEvent
}));

import { runReimbursementIntegrityCheck } from "./cron-jobs";

const fakeEnv = { DB: {} } as unknown as Env;

beforeEach(() => {
  integrityMock.findReimbursementIntegrityIssues.mockReset();
  integrityMock.summarizeIntegrityIssues.mockReset();
  auditLogMock.writeAuditLog.mockReset();
  auditLogMock.writeAuditLog.mockResolvedValue(undefined);
  eventBusMock.publishEvent.mockReset();
  eventBusMock.publishEvent.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runReimbursementIntegrityCheck", () => {
  it("does not write a log or publish an event when there are no issues", async () => {
    integrityMock.findReimbursementIntegrityIssues.mockResolvedValue([]);

    await runReimbursementIntegrityCheck(fakeEnv);

    expect(auditLogMock.writeAuditLog).not.toHaveBeenCalled();
    expect(eventBusMock.publishEvent).not.toHaveBeenCalled();
  });

  it("writes an audit log and publishes an event when issues are found", async () => {
    const issues: IntegrityIssue[] = [
      { kind: "envelope_no_uuid_mismatch", severity: "high", count: 2, ids: [1, 2] }
    ];
    const summary: IntegritySummary = { total: 2, bySeverity: { high: 2 } };
    integrityMock.findReimbursementIntegrityIssues.mockResolvedValue(issues);
    integrityMock.summarizeIntegrityIssues.mockReturnValue(summary);

    await runReimbursementIntegrityCheck(fakeEnv);

    expect(auditLogMock.writeAuditLog).toHaveBeenCalledTimes(1);
    const [db, input] = auditLogMock.writeAuditLog.mock.calls[0];
    expect(db).toBe(fakeEnv.DB);
    expect(input).toMatchObject({
      actorUserId: "system",
      actorRoles: [],
      action: "system.integrity.reimbursement_issues_found"
    });
    expect(input.detail).toMatchObject({ summary, issues });

    expect(eventBusMock.publishEvent).toHaveBeenCalledTimes(1);
    const [env, type, source, payload] = eventBusMock.publishEvent.mock.calls[0];
    expect(env).toBe(fakeEnv);
    expect(type).toBe("REIMBURSEMENT_INTEGRITY_ISSUES_FOUND");
    expect(source).toBe("system");
    expect(payload).toMatchObject({ summary, issues });
  });

  it("never throws when findReimbursementIntegrityIssues rejects", async () => {
    integrityMock.findReimbursementIntegrityIssues.mockRejectedValue(new Error("db unavailable"));

    await expect(runReimbursementIntegrityCheck(fakeEnv)).resolves.toBeUndefined();

    expect(auditLogMock.writeAuditLog).not.toHaveBeenCalled();
    expect(eventBusMock.publishEvent).not.toHaveBeenCalled();
  });

  it("never throws when writeAuditLog rejects", async () => {
    integrityMock.findReimbursementIntegrityIssues.mockResolvedValue([
      { kind: "orphan_split_child", severity: "medium", count: 1, ids: [9] }
    ]);
    integrityMock.summarizeIntegrityIssues.mockReturnValue({ total: 1, bySeverity: { medium: 1 } });
    auditLogMock.writeAuditLog.mockRejectedValue(new Error("audit log db unavailable"));

    await expect(runReimbursementIntegrityCheck(fakeEnv)).resolves.toBeUndefined();
  });

  it("never throws when publishEvent rejects", async () => {
    integrityMock.findReimbursementIntegrityIssues.mockResolvedValue([
      { kind: "orphan_split_child", severity: "medium", count: 1, ids: [9] }
    ]);
    integrityMock.summarizeIntegrityIssues.mockReturnValue({ total: 1, bySeverity: { medium: 1 } });
    eventBusMock.publishEvent.mockRejectedValue(new Error("queue unavailable"));

    await expect(runReimbursementIntegrityCheck(fakeEnv)).resolves.toBeUndefined();
  });
});
