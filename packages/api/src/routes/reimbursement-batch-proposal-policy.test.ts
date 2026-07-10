import { describe, expect, it } from "vitest";

import {
  groupBatchProposals,
  matchUniqueInternalPayee
} from "./reimbursement-batch-proposal-policy";

describe("groupBatchProposals", () => {
  it("groups envelopes by project and applicant with totals", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 10, applicant_userid: "zhang", amount: 100 },
      { id: 2, project_id: 10, applicant_userid: "zhang", amount: 50.5 },
      { id: 3, project_id: 10, applicant_userid: "li", amount: 30 },
      { id: 4, project_id: 20, applicant_userid: "zhang", amount: 70 }
    ]);
    expect(groups).toHaveLength(3);
    const zhang10 = groups.find(
      (g) => g.project_id === 10 && g.applicant_userid === "zhang"
    );
    expect(zhang10?.envelope_ids).toEqual([1, 2]);
    expect(zhang10?.item_count).toBe(2);
    expect(zhang10?.total_amount).toBeCloseTo(150.5);
  });

  it("returns empty for no envelopes", () => {
    expect(groupBatchProposals([])).toEqual([]);
  });

  it("sorts groups by applicant then project for stable display", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 20, applicant_userid: "zhang", amount: 1 },
      { id: 2, project_id: 10, applicant_userid: "li", amount: 1 },
      { id: 3, project_id: 10, applicant_userid: "zhang", amount: 1 }
    ]);
    expect(
      groups.map((g) => `${g.applicant_userid}:${g.project_id}`)
    ).toEqual(["li:10", "zhang:10", "zhang:20"]);
  });
});

describe("matchUniqueInternalPayee", () => {
  const payees = [
    { id: 1, linked_userid: "zhang", status: "active", type: "internal" },
    { id: 2, linked_userid: "li", status: "active", type: "internal" },
    { id: 3, linked_userid: "li", status: "active", type: "internal" },
    { id: 4, linked_userid: "wang", status: "inactive", type: "internal" }
  ];

  it("matches the unique active internal payee", () => {
    expect(matchUniqueInternalPayee(payees, "zhang")?.id).toBe(1);
  });

  it("returns null when multiple payees exist", () => {
    expect(matchUniqueInternalPayee(payees, "li")).toBeNull();
  });

  it("ignores inactive payees and unknown users", () => {
    expect(matchUniqueInternalPayee(payees, "wang")).toBeNull();
    expect(matchUniqueInternalPayee(payees, "zhao")).toBeNull();
  });
});
