#!/usr/bin/env node
// Guards against duplicate migration numeric prefixes in packages/api/migrations.
//
// Migration files are `NNNN_description.sql`; two files sharing the same NNNN
// prefix means an ambiguous/duplicated migration slot. There are 3 KNOWN,
// PRE-EXISTING duplicates (0036, 0037, 0041 — each appears twice). We snapshot
// those as an allowed baseline so this check is GREEN today, while still failing
// on any NEW duplicate (a fresh number appearing twice, or a known number
// appearing a THIRD time). Fix the underlying duplicates by renumbering, then
// tighten the baseline below.
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

// Snapshot of the counts we tolerate. Anything above these is a NEW duplicate.
const ALLOWED_COUNTS = {
  "0036": 2,
  "0037": 2,
  "0041": 2
};

/**
 * @param {string} [dir] migrations directory (defaults to packages/api/migrations)
 * @returns {{ number: string, count: number, allowed: number, files: string[] }[]}
 *   list of NEW violations (empty when clean)
 */
export function findNewDuplicateMigrationNumbers(dir = migrationsDir) {
  const byNumber = new Map();
  for (const name of readdirSync(dir)) {
    const match = /^(\d{4})_.*\.sql$/.exec(name);
    if (!match) {
      continue;
    }
    const number = match[1];
    const files = byNumber.get(number) ?? [];
    files.push(name);
    byNumber.set(number, files);
  }

  const violations = [];
  for (const [number, files] of byNumber) {
    const allowed = ALLOWED_COUNTS[number] ?? 1;
    if (files.length > allowed) {
      violations.push({ number, count: files.length, allowed, files: files.sort() });
    }
  }
  return violations.sort((a, b) => a.number.localeCompare(b.number));
}

function main() {
  const violations = findNewDuplicateMigrationNumbers();
  if (violations.length === 0) {
    const known = Object.keys(ALLOWED_COUNTS).sort().join(", ");
    console.log(
      `OK: no new duplicate migration numbers (tolerating known pre-existing dups: ${known}).`
    );
    return;
  }
  console.error("FAIL: new duplicate migration number(s) detected:");
  for (const v of violations) {
    console.error(
      `  ${v.number}: ${v.count} files (allowed ${v.allowed}) -> ${v.files.join(", ")}`
    );
  }
  console.error(
    "Renumber the offending migration(s). If a known dup was intentionally resolved, lower its baseline in ALLOWED_COUNTS."
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
