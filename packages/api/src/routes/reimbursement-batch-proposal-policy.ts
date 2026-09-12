export type ProposalEnvelopeInput = {
  id: number;
  project_id: number;
  applicant_userid: string;
  amount: number;
  invoice_title_entity_id?: number | null;
};

export type BatchProposalGroup = {
  project_id: number;
  applicant_userid: string;
  invoice_title_entity_id: number | null;
  envelope_ids: number[];
  item_count: number;
  total_amount: number;
};

export const groupBatchProposals = (envelopes: ProposalEnvelopeInput[]): BatchProposalGroup[] => {
  const groups = new Map<string, BatchProposalGroup>();
  for (const envelope of envelopes) {
    const titleEntityId = envelope.invoice_title_entity_id ?? null;
    const key = `${envelope.applicant_userid} ${envelope.project_id} ${titleEntityId ?? "none"}`;
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
        invoice_title_entity_id: titleEntityId,
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
    if (a.project_id !== b.project_id) {
      return a.project_id - b.project_id;
    }
    // 未识别抬头排最后，其余按主体 id 升序
    if (a.invoice_title_entity_id === null) return b.invoice_title_entity_id === null ? 0 : 1;
    if (b.invoice_title_entity_id === null) return -1;
    return a.invoice_title_entity_id - b.invoice_title_entity_id;
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
