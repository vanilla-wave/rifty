#!/usr/bin/env node
/**
 * Enforces (and tracks progress toward) ADR 0022's per-module parity floor.
 *
 * Counts `*.case.ts` files under `tools/node-parity-runner/cases/<module>/`
 * and reports per-module coverage. Two thresholds:
 *
 * - TARGET (≥ 5 cases per represented module) — the ADR-0022 acceptance
 *   target. Modules below this are warned about but do not fail the build,
 *   because the ADR explicitly defers full enforcement to M11+ and notes
 *   "The gate is enforced by reviewer, not by CI, to allow case-by-case
 *   judgement." Surfacing the deficit on every CI run keeps reviewers honest.
 *
 * - FLOOR (≥ 1 case per represented module) — a represented module must
 *   never go empty silently. If somebody deletes the last case in a
 *   directory, the directory should be removed too. Failing here is cheap
 *   and catches accidental coverage regressions.
 *
 * Modules with zero cases (i.e. directories that don't exist) are
 * out-of-scope by design and are not reported.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TARGET = 5;
const FLOOR = 1;
const CASES_DIR = join(process.cwd(), 'tools', 'node-parity-runner', 'cases');

function countCasesIn(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith('.case.ts')) n++;
  }
  return n;
}

const modules = readdirSync(CASES_DIR)
  .filter((name) => {
    try {
      return statSync(join(CASES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();

const counts = modules.map((name) => ({ name, count: countCasesIn(join(CASES_DIR, name)) }));
const total = counts.reduce((s, m) => s + m.count, 0);

const empty = counts.filter((m) => m.count < FLOOR);
const underTarget = counts.filter((m) => m.count >= FLOOR && m.count < TARGET);

console.log(`parity-coverage: ${total} case(s) across ${modules.length} module(s)`);
for (const { name, count } of counts) {
  const flag = count >= TARGET ? '✓' : count >= FLOOR ? '!' : '✗';
  console.log(`  ${flag} ${name.padEnd(14)} ${count}`);
}

if (empty.length > 0) {
  console.error(
    `parity-coverage: ${empty.length} represented module(s) have zero cases — remove the directory or add a case (floor: ${FLOOR}):`,
  );
  for (const { name } of empty) console.error(`  ${name}`);
  process.exit(1);
}

if (underTarget.length > 0) {
  console.warn(
    `parity-coverage: ${underTarget.length} module(s) below ADR-0022 target of ${TARGET} case(s); reviewer must justify on each milestone-finishing PR:`,
  );
  for (const { name, count } of underTarget) console.warn(`  ${name} — ${count}/${TARGET}`);
}

console.log('parity-coverage: ok');
