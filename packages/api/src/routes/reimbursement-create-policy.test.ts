import { describe, expect, it } from "vitest";

import { decideCreateRouteBranch } from "./reimbursement-create-policy";

const baseInput = {
  authSub: "operator.a",
  isPrivileged: false,
  requestedApplicant: "operator.a",
  requestedChannel: "physical" as const,
  preferredEnvelopeUuid: "uuid-preprinted-001",
  generatedEnvelopeUuid: "uuid-generated-001",
  unassignedApplicant: "__UNASSIGNED__"
};

describe("decideCreateRouteBranch", () => {
  it("binds existing unregistered envelope when preferred uuid exists", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      existingEnvelope: {
        id: 12,
        status: "unregistered",
        applicant_userid: "__UNASSIGNED__",
        channel: "physical",
        envelope_uuid: "uuid-preprinted-001"
      }
    });

    expect(result.kind).toBe("bind-existing");
    if (result.kind !== "bind-existing") return;
    expect(result.envelopeId).toBe(12);
    expect(result.envelopeNo).toBe("uuid-preprinted-001");
    expect(result.envelopeUuid).toBe("uuid-preprinted-001");
    expect(result.nextStatus).toBe("draft");
    expect(result.applicantToPersist).toBe("operator.a");
    expect(result.channelToPersist).toBe("physical");
  });

  it("creates new envelope when preferred uuid is not found", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      existingEnvelope: undefined
    });

    expect(result).toEqual({
      kind: "create-new",
      envelopeNo: "uuid-preprinted-001",
      envelopeUuid: "uuid-preprinted-001"
    });
  });

  it("rejects binding when existing envelope status is not bindable", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      existingEnvelope: {
        id: 33,
        status: "approved",
        applicant_userid: "operator.a",
        channel: "physical",
        envelope_uuid: "uuid-preprinted-001"
      }
    });

    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: "Envelope in status approved cannot be bound during create"
    });
  });

  it("rejects binding when existing envelope is already submitted", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      existingEnvelope: {
        id: 34,
        status: "submitted",
        applicant_userid: "operator.a",
        channel: "electronic",
        envelope_uuid: "uuid-preprinted-001"
      }
    });

    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: "Envelope in status submitted cannot be bound during create"
    });
  });

  it("rejects bind-existing when requested channel mismatches envelope channel", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      requestedChannel: "physical",
      existingEnvelope: {
        id: 35,
        status: "draft",
        applicant_userid: "operator.a",
        channel: "electronic",
        envelope_uuid: "uuid-preprinted-001"
      }
    });

    expect(result).toEqual({
      kind: "error",
      status: 400,
      message: "Envelope channel mismatch; cannot bind"
    });
  });

  it("rejects non-privileged create when assigning another applicant", () => {
    const result = decideCreateRouteBranch({
      ...baseInput,
      requestedApplicant: "operator.b"
    });

    expect(result).toEqual({
      kind: "error",
      status: 403,
      message: "Only privileged roles can assign another applicant"
    });
  });
});
