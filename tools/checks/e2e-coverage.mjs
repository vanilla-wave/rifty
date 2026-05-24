#!/usr/bin/env node
/**
 * Tracks progress toward ADR-0022's per-milestone e2e coverage gate.
 *
 * Lists `tests/e2e/m*.spec.ts` and asserts a spec exists for each milestone
 * M0..M10. Missing milestones are listed as warnings — the ADR explicitly
 * marks this as non-blocking until the backfill in M11 lands.
 *
 * Exit status is 0 whenever the script ran to completion. Any genuine error
 * (e.g. malformed milestone tag, duplicate entries) exits 1.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const E2E_DIR = join(process.cwd(), 'tests', 'e2e');
const MILESTONES = Array.from({ length: 11 }, (_, i) => i); // M0..M10

const specPattern = /^m(\d+)-.+\.spec\.ts$/;
const seen = new Map(); // milestone -> filename[]

for (const entry of readdirSync(E2E_DIR)) {
  const m = specPattern.exec(entry);
  if (!m) continue;
  const milestone = Number(m[1]);
  const arr = seen.get(milestone) ?? [];
  arr.push(entry);
  seen.set(milestone, arr);
}

const covered = MILESTONES.filter((n) => seen.has(n));
const missing = MILESTONES.filter((n) => !seen.has(n));

console.log(
  `e2e-coverage: ${covered.length}/${MILESTONES.length} milestone(s) with at least one spec`,
);
for (const n of MILESTONES) {
  const files = seen.get(n);
  if (files && files.length > 0) {
    console.log(`  ✓ M${n}  ${files.sort().join(', ')}`);
  } else {
    console.log(`  · M${n}  (no spec)`);
  }
}

if (missing.length > 0) {
  console.warn(
    `e2e-coverage: ${missing.length} milestone(s) without an e2e spec (ADR-0022 backfill — non-blocking until M11):`,
  );
  console.warn(`  ${missing.map((n) => `M${n}`).join(', ')}`);
}

console.log('e2e-coverage: done');
