import { describe, expect, it } from "vitest";

import { decideSplitEnvelope } from "./reimbursement-split-policy";

const baseEnvelope = {
  status: "received",
  batch_id: null,
  approval_instance_id: null,
  amount: 300
};

const baseInput = {
  envelope: baseEnvelope,
  newProjectId: 2,
  newAmount: 100,
  originalAmount: 200,
  attachmentIds: [11, 12],
  ownedActiveAttachmentIds: [11, 12, 13]
};

describe("decideSplitEnvelope", () => {
  it("allows splitting a received envelope and reports amount delta", () => {
    const decision = decideSplitEnvelope(baseInput);
    expect(decision).toEqual({ allowed: true, amountDelta: 0 });
  });

  it("reports non-zero delta when split amounts do not sum to previous amount", () => {
    const decision = decideSplitEnvelope({ ...baseInput, newAmount: 150 });
    expect(decision).toEqual({ allowed: true, amountDelta: 50 });
  });

  it.each(["draft", "unregistered", "batched", "pending_approval", "approved", "paid", "rejected", "cancelled"])(
    "rejects status %s",
    (status) => {
      const decision = decideSplitEnvelope({
        ...baseInput,
        envelope: { ...baseEnvelope, status }
      });
      expect(decision.allowed).toBe(false);
    }
  );

  it("rejects envelope already in a batch", () => {
    const decision = decideSplitEnvelope({
      ...baseInput,
      envelope: { ...baseEnvelope, batch_id: 9 }
    });
    expect(decision.allowed).toBe(false);
  });

  it("rejects envelope with approval instance", () => {
    const decision = decideSplitEnvelope({
      ...baseInput,
      envelope: { ...baseEnvelope, approval_instance_id: 5 }
    });
    expect(decision.allowed).toBe(false);
  });

  it("rejects invalid target project", () => {
    expect(decideSplitEnvelope({ ...baseInput, newProjectId: 0 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, newProjectId: Number.NaN }).allowed).toBe(false);
  });

  it("rejects non-positive amounts", () => {
    expect(decideSplitEnvelope({ ...baseInput, newAmount: 0 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, originalAmount: -1 }).allowed).toBe(false);
    expect(decideSplitEnvelope({ ...baseInput, newAmount: Number.NaN }).allowed).toBe(false);
  });

  it("rejects attachments that do not belong to the envelope", () => {
    const decision = decideSplitEnvelope({ ...baseInput, attachmentIds: [11, 99] });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toContain("99");
    }
  });

  it("allows splitting without moving any attachment (paper receipts stay physical)", () => {
    const decision = decideSplitEnvelope({ ...baseInput, attachmentIds: [] });
    expect(decision).toEqual({ allowed: true, amountDelta: 0 });
  });
});
