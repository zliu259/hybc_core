import type { ReimbursementChannel, ReimbursementEnvelope } from "../types/reimbursement";

export type CreateRouteDecisionInput = {
  authSub: string;
  isPrivileged: boolean;
  requestedApplicant: string;
  requestedChannel: ReimbursementChannel;
  preferredEnvelopeUuid?: string;
  generatedEnvelopeUuid: string;
  unassignedApplicant: string;
  existingEnvelope?: Pick<
    ReimbursementEnvelope,
    "id" | "status" | "applicant_userid" | "channel" | "envelope_uuid"
  >;
};

export type CreateRouteDecision =
  | {
      kind: "error";
      status: 400 | 403;
      message: string;
    }
  | {
      kind: "bind-existing";
      envelopeId: number;
      envelopeNo: string;
      envelopeUuid: string;
      applicantToPersist: string;
      channelToPersist: ReimbursementChannel;
      nextStatus: string;
    }
  | {
      kind: "create-new";
      envelopeNo: string;
      envelopeUuid: string;
    };

const bindableStatuses = new Set(["unregistered", "draft", "submitted"]);

export const decideCreateRouteBranch = (
  input: CreateRouteDecisionInput
): CreateRouteDecision => {
  if (!input.isPrivileged && input.requestedApplicant !== input.authSub) {
    return {
      kind: "error",
      status: 403,
      message: "Only privileged roles can assign another applicant"
    };
  }

  if (input.preferredEnvelopeUuid && input.existingEnvelope) {
    if (!bindableStatuses.has(input.existingEnvelope.status)) {
      return {
        kind: "error",
        status: 400,
        message: `Envelope in status ${input.existingEnvelope.status} cannot be bound during create`
      };
    }

    const canBindApplicant =
      input.existingEnvelope.applicant_userid === input.unassignedApplicant ||
      input.existingEnvelope.status === "unregistered";

    if (!canBindApplicant && !input.isPrivileged && input.existingEnvelope.applicant_userid !== input.authSub) {
      return {
        kind: "error",
        status: 403,
        message: "Forbidden"
      };
    }

    return {
      kind: "bind-existing",
      envelopeId: input.existingEnvelope.id,
      envelopeNo: input.existingEnvelope.envelope_uuid,
      envelopeUuid: input.existingEnvelope.envelope_uuid,
      applicantToPersist: canBindApplicant
        ? input.requestedApplicant
        : input.existingEnvelope.applicant_userid,
      channelToPersist:
        input.existingEnvelope.status === "unregistered"
          ? input.requestedChannel
          : input.existingEnvelope.channel,
      nextStatus:
        input.existingEnvelope.status === "unregistered"
          ? "draft"
          : input.existingEnvelope.status
    };
  }

  const envelopeUuid = input.preferredEnvelopeUuid || input.generatedEnvelopeUuid;

  return {
    kind: "create-new",
    envelopeNo: envelopeUuid,
    envelopeUuid
  };
};
