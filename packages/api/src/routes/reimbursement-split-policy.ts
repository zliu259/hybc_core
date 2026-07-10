export const SPLIT_ALLOWED_STATUSES = new Set(["submitted", "received"]);

export type SplitEnvelopeSnapshot = {
  status: string;
  batch_id: number | null;
  approval_instance_id: number | null;
  amount: number;
};

export type SplitDecisionInput = {
  envelope: SplitEnvelopeSnapshot;
  newProjectId: number;
  newAmount: number;
  originalAmount: number;
  attachmentIds: number[];
  ownedActiveAttachmentIds: number[];
};

export type SplitDecision =
  | { allowed: true; amountDelta: number }
  | { allowed: false; message: string };

const isPositiveAmount = (value: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const decideSplitEnvelope = (input: SplitDecisionInput): SplitDecision => {
  if (!SPLIT_ALLOWED_STATUSES.has(input.envelope.status)) {
    return {
      allowed: false,
      message: `Envelope in status ${input.envelope.status} cannot be split`
    };
  }
  if (input.envelope.batch_id !== null) {
    return { allowed: false, message: "Envelope already belongs to a batch" };
  }
  if (input.envelope.approval_instance_id !== null) {
    return { allowed: false, message: "Envelope already linked to an approval instance" };
  }
  if (!Number.isFinite(input.newProjectId) || input.newProjectId <= 0) {
    return { allowed: false, message: "new_envelope.project_id is required" };
  }
  if (!isPositiveAmount(input.newAmount)) {
    return { allowed: false, message: "new_envelope.amount must be a positive number" };
  }
  if (!isPositiveAmount(input.originalAmount)) {
    return { allowed: false, message: "original_amount must be a positive number" };
  }

  const ownedSet = new Set(input.ownedActiveAttachmentIds);
  const foreign = input.attachmentIds.filter((id) => !ownedSet.has(id));
  if (foreign.length > 0) {
    return {
      allowed: false,
      message: `Attachments not found on envelope: ${foreign.join(", ")}`
    };
  }

  return {
    allowed: true,
    amountDelta: input.newAmount + input.originalAmount - input.envelope.amount
  };
};
