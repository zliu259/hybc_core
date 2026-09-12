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
    const zhang10 = groups.find((g) => g.project_id === 10 && g.applicant_userid === "zhang");
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
    expect(groups.map((g) => `${g.applicant_userid}:${g.project_id}`)).toEqual([
      "li:10",
      "zhang:10",
      "zhang:20"
    ]);
  });

  it("同人同项目不同抬头拆成不同组，组内带抬头 id", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 144, applicant_userid: "lu", amount: 1348, invoice_title_entity_id: 11 },
      { id: 2, project_id: 144, applicant_userid: "lu", amount: 18, invoice_title_entity_id: 6 },
      {
        id: 3,
        project_id: 144,
        applicant_userid: "lu",
        amount: 31.5,
        invoice_title_entity_id: null
      },
      { id: 4, project_id: 144, applicant_userid: "lu", amount: 212, invoice_title_entity_id: 11 }
    ]);
    expect(groups.map((g) => [g.invoice_title_entity_id, g.envelope_ids])).toEqual([
      [6, [2]],
      [11, [1, 4]],
      [null, [3]]
    ]);
  });

  it("未传抬头字段时视为未识别，仍按人+项目分组", () => {
    const groups = groupBatchProposals([
      { id: 1, project_id: 10, applicant_userid: "zhang", amount: 1 },
      { id: 2, project_id: 10, applicant_userid: "zhang", amount: 1 }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].invoice_title_entity_id).toBeNull();
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
