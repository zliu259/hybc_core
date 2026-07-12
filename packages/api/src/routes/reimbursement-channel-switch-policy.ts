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
