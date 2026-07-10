export type ProposalEnvelopeInput = {
  id: number;
  project_id: number;
  applicant_userid: string;
  amount: number;
};

export type BatchProposalGroup = {
  project_id: number;
  applicant_userid: string;
  envelope_ids: number[];
  item_count: number;
  total_amount: number;
};

export const groupBatchProposals = (
  envelopes: ProposalEnvelopeInput[]
): BatchProposalGroup[] => {
  const groups = new Map<string, BatchProposalGroup>();
  for (const envelope of envelopes) {
    const key = `${envelope.applicant_userid} ${envelope.project_id}`;
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, {
        ...existing,
        envelope_ids: [...existing.envelope_ids, envelope.id],
        item_count: existing.item_count + 1,
        total_amount: existing.total_amount + (envelope.amount || 0)
      });
    } else {
      groups.set(key, {
        project_id: envelope.project_id,
        applicant_userid: envelope.applicant_userid,
        envelope_ids: [envelope.id],
        item_count: 1,
        total_amount: envelope.amount || 0
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.applicant_userid !== b.applicant_userid) {
      return a.applicant_userid < b.applicant_userid ? -1 : 1;
    }
    return a.project_id - b.project_id;
  });
};

export type PayeeCandidate = {
  id: number;
  linked_userid: string | null;
  status: string;
  type: string;
};

export const matchUniqueInternalPayee = <T extends PayeeCandidate>(
  payees: T[],
  applicantUserid: string
): T | null => {
  const candidates = payees.filter(
    (payee) =>
      payee.type === "internal" &&
      payee.status === "active" &&
      payee.linked_userid === applicantUserid
  );
  return candidates.length === 1 ? candidates[0] : null;
};
