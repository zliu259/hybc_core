import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { reimbursementRoutes, resolveReusableElectronicDraft } from "./reimbursement";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "LiuYongChao",
    username: "LiuYongChao",
    nickname: "Liu Yong Chao",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

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

// ---------------------------------------------------------------------------
// Route-level regression tests for POST /reimbursement/electronic-upload.
// Covers what re-uploading onto an existing electronic draft actually does to
// the draft's attachments and envelope fields — the silent replace that used
// to drop the previous invoice must now require an explicit `replace: true`.
// ---------------------------------------------------------------------------

type CapturedStatement = { sql: string; args: unknown[] };

class UploadStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: UploadDb,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM reimbursement_envelope WHERE id = ?")) {
      return this.db.envelopeRow as T;
    }
    if (this.sql.includes("FROM envelope_attachment") && this.sql.includes("COUNT")) {
      return { cnt: this.db.activeAttachmentCount } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  async run() {
    this.db.executed.push({ sql: this.sql, args: this.args });
    if (this.sql.includes("INSERT INTO reimbursement_envelope")) {
      return { meta: { last_row_id: 900, changes: 1 } };
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class UploadDb {
  executed: CapturedStatement[] = [];
  envelopeRow: EnvelopeRow | null = null;
  activeAttachmentCount = 0;

  prepare(sql: string) {
    return new UploadStatement(this, sql);
  }
}

const createEnv = (db: UploadDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestUpload = (
  db: UploadDb,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    "/reimbursement/electronic-upload",
    {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    },
    createEnv(db)
  );
};

const uploadBody = (overrides: Record<string, unknown> = {}) => ({
  project_id: 7,
  envelope_id: 152,
  file_key: "reimbursement/second-invoice.pdf",
  file_name: "second-invoice.pdf",
  invoice_no: "INV-SECOND",
  amount: 88,
  issue_date: "2026-07-20",
  description: "second upload",
  ...overrides
});

const attachmentSoftDeletes = (db: UploadDb) =>
  db.executed.filter(
    item => item.sql.includes("UPDATE envelope_attachment") && item.sql.includes("'deleted'")
  );
const attachmentInserts = (db: UploadDb) =>
  db.executed.filter(item => item.sql.includes("INSERT INTO envelope_attachment"));
const envelopeUpdates = (db: UploadDb) =>
  db.executed.filter(item => item.sql.includes("UPDATE reimbursement_envelope"));
const envelopeInserts = (db: UploadDb) =>
  db.executed.filter(item => item.sql.includes("INSERT INTO reimbursement_envelope"));

describe("POST /reimbursement/electronic-upload re-upload onto an existing draft", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, sub: "LiuYongChao", roles: ["operator"] };
  });

  it("returns 409 and keeps the current invoice when the draft already has an active attachment and replace is not confirmed", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow };
    db.activeAttachmentCount = 1;

    const response = await requestUpload(db, uploadBody());

    expect(response.status).toBe(409);
    const payload = (await response.json()) as {
      success: boolean;
      error: { code?: string; message: string };
    };
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("ENVELOPE_HAS_ACTIVE_INVOICE");

    // Nothing about the draft may change: no attachment soft-delete, no new
    // attachment, no envelope field overwrite, no new envelope.
    expect(attachmentSoftDeletes(db)).toHaveLength(0);
    expect(attachmentInserts(db)).toHaveLength(0);
    expect(envelopeUpdates(db)).toHaveLength(0);
    expect(envelopeInserts(db)).toHaveLength(0);
  });

  it("releases the pending idempotency marker when rejecting with 409", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow };
    db.activeAttachmentCount = 1;

    const response = await requestUpload(db, uploadBody(), { "Idempotency-Key": "idem-409" });

    expect(response.status).toBe(409);
    const abandons = db.executed.filter(item =>
      item.sql.includes("DELETE FROM api_idempotency_request")
    );
    expect(abandons).toHaveLength(1);
  });

  it("replaces the current invoice in place when the caller confirms with replace: true", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow };
    db.activeAttachmentCount = 1;

    const response = await requestUpload(db, uploadBody({ replace: true }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { id: number; envelope_no: string };
    };
    expect(payload.data.id).toBe(152);
    expect(payload.data.envelope_no).toBe("envelope-152");

    // Old attachments soft-deleted (never hard-deleted), exactly one new
    // invoice attachment inserted, and the envelope's single-invoice fields
    // overwritten with the new invoice.
    const softDeletes = attachmentSoftDeletes(db);
    expect(softDeletes).toHaveLength(1);
    expect(softDeletes[0].args).toContain(152);

    const inserts = attachmentInserts(db);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args).toContain("reimbursement/second-invoice.pdf");
    expect(inserts[0].args).toContain(152);

    const updates = envelopeUpdates(db);
    expect(updates).toHaveLength(1);
    expect(updates[0].args).toContain("INV-SECOND");
    expect(updates[0].args).toContain(88);
    expect(updates[0].args).toContain("2026-07-20");

    expect(envelopeInserts(db)).toHaveLength(0);
  });

  it("fills an attachment-less reusable draft in place without requiring replace confirmation", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow };
    db.activeAttachmentCount = 0;

    const response = await requestUpload(db, uploadBody());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; data: { id: number } };
    expect(payload.data.id).toBe(152);
    expect(attachmentInserts(db)).toHaveLength(1);
    expect(envelopeInserts(db)).toHaveLength(0);
  });

  it("creates a fresh envelope when no envelope_id is sent, leaving existing drafts untouched", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow };
    db.activeAttachmentCount = 1;

    const response = await requestUpload(db, uploadBody({ envelope_id: undefined }));

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { success: boolean; data: { id: number } };
    expect(payload.data.id).toBe(900);
    expect(envelopeInserts(db)).toHaveLength(1);
    expect(attachmentSoftDeletes(db)).toHaveLength(0);
  });

  it("creates a fresh envelope when the passed envelope_id is already submitted (stale client id)", async () => {
    const db = new UploadDb();
    db.envelopeRow = { ...baseRow, status: "submitted" };
    db.activeAttachmentCount = 1;

    const response = await requestUpload(db, uploadBody());

    expect(response.status).toBe(201);
    expect(envelopeInserts(db)).toHaveLength(1);
    expect(attachmentSoftDeletes(db)).toHaveLength(0);
  });
});
