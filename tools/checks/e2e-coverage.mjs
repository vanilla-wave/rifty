#!/usr/bin/env node
/**
 * Tracks progress toward ADR-0022's per-milestone e2e coverage gate.
 *
 * Lists `tests/e2e/m*.spec.ts` and, per milestone M0..M10, reports whether a
 * spec exists AND whether its assertions actually run in default CI. A spec
 * counts as covered only when it is CI-active — not gated behind a
 * `RIFTY_E2E_*` env flag, and not an unconditionally-skipped retired
 * placeholder. Otherwise the milestone is reported as "spec present but skipped
 * in default CI" so a gated spec can't masquerade as coverage.
 *
 * Exit status is 0 whenever the script ran to completion (ADR-0022 marks the
 * backfill non-blocking until M11). Any genuine error exits 1.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = join(process.cwd(), 'tests', 'e2e');
const MILESTONES = Array.from({ length: 11 }, (_, i) => i); // M0..M10
const specPattern = /^m(\d+)-.+\.spec\.ts$/;

/**
 * Classify a spec's CI behaviour from its source:
 *   - 'gated'  — whole suite skipped behind a `RIFTY_E2E_*` env flag.
 *   - 'inert'  — no runnable `test(...)`, only an unconditional `test.skip("…")`.
 *   - 'active' — runs in default CI.
 */
export function classifySpec(content) {
  if (/process\.env\.RIFTY_E2E_\w+/.test(content) && /\btest\.skip\(\s*!/.test(content)) {
    return 'gated';
  }
  const hasRunnableTest = /\btest\s*\(/.test(content);
  const hasUnconditionalSkip = /\btest\.skip\(\s*['"`]/.test(content);
  if (!hasRunnableTest && hasUnconditionalSkip) return 'inert';
  return 'active';
}

/**
 * @param {{milestone:number,name:string,content:string}[]} entries
 * @returns {{active:number[],gatedOnly:number[],byMilestone:Map<number,{name:string,kind:string}[]>}}
 */
export function analyzeMilestones(entries) {
  const byMilestone = new Map();
  for (const e of entries) {
    const arr = byMilestone.get(e.milestone) ?? [];
    arr.push({ name: e.name, kind: classifySpec(e.content) });
    byMilestone.set(e.milestone, arr);
  }
  const active = [];
  const gatedOnly = [];
  for (const [milestone, specs] of byMilestone) {
    if (specs.some((s) => s.kind === 'active')) active.push(milestone);
    else gatedOnly.push(milestone);
  }
  active.sort((a, b) => a - b);
  gatedOnly.sort((a, b) => a - b);
  return { active, gatedOnly, byMilestone };
}

function main() {
  const entries = [];
  for (const name of readdirSync(E2E_DIR)) {
    const m = specPattern.exec(name);
    if (!m) continue;
    entries.push({
      milestone: Number(m[1]),
      name,
      content: readFileSync(join(E2E_DIR, name), 'utf8'),
    });
  }

  const { active, gatedOnly, byMilestone } = analyzeMilestones(entries);
  const activeSet = new Set(active);

  console.log(
    `e2e-coverage: ${active.length}/${MILESTONES.length} milestone(s) with a CI-active spec`,
  );
  for (const n of MILESTONES) {
    const specs = byMilestone.get(n);
    if (!specs) {
      console.log(`  · M${n}  (no spec)`);
      continue;
    }
    const label = specs
      .map((s) => `${s.name}${s.kind === 'active' ? '' : ` [${s.kind}]`}`)
      .sort()
      .join(', ');
    if (activeSet.has(n)) console.log(`  ✓ M${n}  ${label}`);
    else console.log(`  ⚠ M${n}  ${label} — spec present but skipped in default CI`);
  }

  if (gatedOnly.length > 0) {
    console.warn(
      `e2e-coverage: ${gatedOnly.length} milestone(s) whose specs are all gated/retired — assertions do NOT run in default CI (opt-in via the RIFTY_E2E_* flag):`,
    );
    console.warn(`  ${gatedOnly.map((n) => `M${n}`).join(', ')}`);
  }

  const missing = MILESTONES.filter((n) => !byMilestone.has(n));
  if (missing.length > 0) {
    console.warn(
      `e2e-coverage: ${missing.length} milestone(s) without an e2e spec (ADR-0022 backfill — non-blocking until M11):`,
    );
    console.warn(`  ${missing.map((n) => `M${n}`).join(', ')}`);
  }

  console.log('e2e-coverage: done');
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
