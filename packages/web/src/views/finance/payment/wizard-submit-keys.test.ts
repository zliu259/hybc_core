import { describe, expect, it } from "vitest";

import {
  buildSubmitAttemptKeys,
  createWizardRunId,
  hashFingerprint
} from "./wizard-submit-keys";

describe("wizard submit keys", () => {
  it("derives identical keys for the same run and unchanged content", () => {
    const first = buildSubmitAttemptKeys(
      "payment-wizard-contract",
      "run-1",
      "{a}"
    );
    const second = buildSubmitAttemptKeys(
      "payment-wizard-contract",
      "run-1",
      "{a}"
    );

    expect(second).toEqual(first);
    expect(first.createKey).toContain("payment-wizard-contract-create-run-1-");
    expect(first.submitKey).toContain("payment-wizard-contract-submit-run-1-");
    expect(first.createKey).not.toBe(first.submitKey);
  });

  it("changes keys when the content changes", () => {
    const first = buildSubmitAttemptKeys(
      "payment-wizard-contract",
      "run-1",
      "{a}"
    );
    const second = buildSubmitAttemptKeys(
      "payment-wizard-contract",
      "run-1",
      "{b}"
    );

    expect(second.createKey).not.toBe(first.createKey);
    expect(second.submitKey).not.toBe(first.submitKey);
  });

  it("changes keys when the run id rotates", () => {
    const first = buildSubmitAttemptKeys(
      "payment-wizard-direct",
      "run-1",
      "{a}"
    );
    const second = buildSubmitAttemptKeys(
      "payment-wizard-direct",
      "run-2",
      "{a}"
    );

    expect(second.createKey).not.toBe(first.createKey);
  });

  it("hashes fingerprints into a short stable base36 digest", () => {
    const digest = hashFingerprint(
      JSON.stringify({ amount: 240000, remark: "x" })
    );

    expect(digest).toBe(
      hashFingerprint(JSON.stringify({ amount: 240000, remark: "x" }))
    );
    expect(digest).toMatch(/^[0-9a-z]{7,}$/);
    expect(hashFingerprint("")).toMatch(/^[0-9a-z]{7,}$/);
  });

  it("mints distinct run ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => createWizardRunId()));

    expect(ids.size).toBe(20);
    ids.forEach(id => expect(id.length).toBeGreaterThan(8));
  });
});
