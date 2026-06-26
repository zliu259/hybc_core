import { describe, expect, it } from "vitest";

import { resolveReusableElectronicDraft } from "./reimbursement";

type EnvelopeRow = {
  id: number;
  envelope_no: string;
  envelope_uuid: string;
  applicant_userid: string;
  channel: string;
  status: string;
};

// Minimal D1 fake: resolveReusableElectronicDraft only issues a single
// prepare(...).bind(...).first() lookup, so the fake just returns the
// configured row (or null) for that one call.
const createFakeDb = (row: EnvelopeRow | null): D1Database =>
  ({
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            }
          };
        }
      };
    }
  }) as unknown as D1Database;

const baseRow: EnvelopeRow = {
  id: 152,
  envelope_no: "envelope-152",
  envelope_uuid: "uuid-152",
  applicant_userid: "LiuYongChao",
  channel: "electronic",
  status: "draft"
};

const owner = { sub: "LiuYongChao", roles: ["operator"] };

describe("resolveReusableElectronicDraft", () => {
  it("returns null without querying when envelopeId is missing or zero", async () => {
    const throwingDb = {
      prepare() {
        throw new Error("must not query the database");
      }
    } as unknown as D1Database;

    expect(await resolveReusableElectronicDraft(throwingDb, undefined, owner)).toBeNull();
    expect(await resolveReusableElectronicDraft(throwingDb, 0, owner)).toBeNull();
  });

  it("reuses the caller's own unsubmitted electronic draft", async () => {
    const result = await resolveReusableElectronicDraft(createFakeDb(baseRow), 152, owner);
    expect(result).toEqual({
      id: 152,
      envelope_no: "envelope-152",
      envelope_uuid: "uuid-152"
    });
  });

  it("reuses an 'unregistered' electronic draft", async () => {
    const result = await resolveReusableElectronicDraft(
      createFakeDb({ ...baseRow, status: "unregistered" }),
      152,
      owner
    );
    expect(result).not.toBeNull();
  });

  it("never reuses an already-submitted envelope (no silent merge of committed records)", async () => {
    const result = await resolveReusableElectronicDraft(
      createFakeDb({ ...baseRow, status: "submitted" }),
      152,
      owner
    );
    expect(result).toBeNull();
  });

  it("never reuses a non-electronic envelope", async () => {
    const result = await resolveReusableElectronicDraft(
      createFakeDb({ ...baseRow, channel: "physical" }),
      152,
      owner
    );
    expect(result).toBeNull();
  });

  it("returns null when the envelope does not exist", async () => {
    expect(await resolveReusableElectronicDraft(createFakeDb(null), 999, owner)).toBeNull();
  });

  it("does not let a non-office user reuse someone else's draft", async () => {
    const result = await resolveReusableElectronicDraft(
      createFakeDb({ ...baseRow, applicant_userid: "SomeoneElse" }),
      152,
      owner
    );
    expect(result).toBeNull();
  });

  it("allows an office role to reuse another applicant's draft", async () => {
    const office = { sub: "Reviewer", roles: ["manager"] };
    const result = await resolveReusableElectronicDraft(
      createFakeDb({ ...baseRow, applicant_userid: "SomeoneElse" }),
      152,
      office
    );
    expect(result).not.toBeNull();
  });
});
