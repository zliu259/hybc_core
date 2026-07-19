import { describe, expect, it } from "vitest";

import { findNewDuplicateMigrationNumbers } from "../scripts/check-migration-numbers.mjs";

// Every migration file is `NNNN_description.sql`. Two files sharing the same
// NNNN prefix is an ambiguous migration slot. 0036/0037/0041 are known
// pre-existing duplicates and are tolerated by an explicit baseline in the
// script; this test fails if any NEW duplicate is introduced (a fresh number
// appearing twice, or a known number appearing a third time). Same logic runs
// as an explicit CI step via scripts/check-migration-numbers.mjs.
describe("migration numbering", () => {
  it("has no NEW duplicate migration numbers beyond the known baseline", () => {
    const violations = findNewDuplicateMigrationNumbers();
    expect(
      violations,
      violations
        .map((v) => `${v.number}: ${v.count} files (allowed ${v.allowed})`)
        .join("; ")
    ).toEqual([]);
  });
});
