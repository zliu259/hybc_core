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
    "cancelled",
    "rejected"
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
