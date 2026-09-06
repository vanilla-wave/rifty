#!/usr/bin/env node
/**
 * Contract-authority tripwire on the aggregate PR diff (merge-base vs head).
 * Beside code (a production path or a test): frozen epic fields never change;
 * a ready CONTRACT — status + the sections a reviewer grades
 * (artifacts/unit.md) — changes only with a `re-cut:` line
 * (docs/process/rules/readiness.md RDY-5); Context, Challenge, Decisions and
 * the rest of the frontmatter are journal/path, never compared; a dropped
 * `→ I#`/`→ scenario` row needs `fork:` in the re-cut line, a dropped ADR row
 * that ADR's id named there (rewording is review's, REV-10 axis 3). A ready
 * flip in ANY diff, and a `ready-verdict:` line added or changed beside code,
 * carries its committed Contract+RED verdict (schema-shaped, naming the unit
 * and the reviewed commit) or, off production paths, `review: ordinary`
 * (RDY-8, REV-8). A contract deleted on done beside code leaves its verdicts
 * behind — a ready one its landing verdict, a compiled draft (traced rows)
 * both its Contract+RED and its landing verdict, a plain draft any landing
 * verdict added in the diff. Beside code only the product, its tests and
 * parity cases, backlog/ADR docs and changelogs change — anything else judges
 * the PR and lands separately (rules/pr.md PR-4).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyAutonomousRunPath } from './run-pickup.mjs';

const EXACT_SHA_RE = /^[0-9a-f]{40}$/u;

/**
 * PR-head identity. GitHub checks out a synthetic merge commit for PR jobs;
 * gates must read HEAD content from the exact PR head recorded in the event.
 */
export function historyHeadRevision(env, readEvent) {
  if (!env.GITHUB_EVENT_PATH) return { revision: 'HEAD', kind: 'checkout', error: null };
  let event;
  try {
    event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
  } catch {
    return { revision: null, kind: 'event', error: 'cannot read GitHub event for history head' };
  }
  if (event?.pull_request === undefined) {
    return { revision: 'HEAD', kind: 'checkout', error: null };
  }
  const revision = event.pull_request?.head?.sha;
  return EXACT_SHA_RE.test(revision ?? '')
    ? { revision, kind: 'pull-request', error: null }
    : {
        revision: null,
        kind: 'pull-request',
        error: 'pull_request.head.sha must be one exact 40-hex commit',
      };
}

function frontmatterValue(text, key) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/mu.exec(text ?? '')?.[1];
  if (!frontmatter) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*([^\\r\\n]*?)\\s*$`, 'mu').exec(frontmatter)?.[1] ?? null;
}

function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^##\\s+${escaped}\\s*$\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, 'mu')
      .exec(text ?? '')?.[1]
      ?.trim() ?? null
  );
}

/** Canonical observable part of a ready epic (legacy single-file format). */
export function goalContract(text) {
  if (text === null || text === undefined) return null;
  return {
    value: frontmatterValue(text, 'value'),
    tier: frontmatterValue(text, 'tier'),
    outcome: section(text, 'Outcome'),
    userScenario: section(text, 'User scenario'),
    invariants: section(text, 'Invariants'),
  };
}

const CONTRACT_RE = /^docs\/backlog\/.+\.md$/;
const SKIP_RE = /\/(?:README|TEMPLATE)\.md$/;
const GUARDED = new Set(['ready', 'in-progress']);
const EPIC_PATH_RE = /^docs\/backlog\/epics\/[^/]+\.md$/;
const GOAL_PATH_RE = /^docs\/backlog\/epics\/[^/]+\/goal\.md$/;
// What rides with a code change: the product, its tests and parity cases, examples, deploy/perf,
// the backlog and ADR docs, changelogs, lockfile and workspace/tsconfig structure. Everything
// else — CI, the gates, the parity oracle harness, the process canon, agent instructions, every
// lint/test/lane config (root or package-local) — judges the PR and lands separately (PR-4). An
// open rule: a new judge is a referee by default.
const RIDES_WITH_CODE_RE =
  /^(?:apps|packages|services|tests|examples|deploy|perf|tools\/shadow-registry|tools\/node-parity-runner\/cases)\/|^docs\/(?!process\/)|(?:^|\/)CHANGELOG\.md$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$|^tsconfig[^/]*\.json$/u;
const JUDGES_ANYWHERE_RE =
  /(?:^|\/)(?:vitest|playwright)[^/]*\.config\.[cm]?[jt]s$|^(?:apps|packages|services)\/[^/]+\/package\.json$/u;
export function isReferee(path) {
  return JUDGES_ANYWHERE_RE.test(path) || !RIDES_WITH_CODE_RE.test(path);
}
// The contract a reviewer grades (artifacts/unit.md); everything else in the file is journal.
const CONTRACT_SECTIONS = [
  'User scenario',
  'Reference contract',
  'Acceptance',
  'Parity cases',
  'Fault matrix',
  'Out of scope',
];
const JOURNAL_PREFIX = '^(?:[-*]\\s+)?`?';
const VERDICT_LINE_RE = new RegExp(
  `${JOURNAL_PREFIX}ready-verdict:[^\\n]*?(?:Contract\\+RED @ (\\S+)|inherited from (\\S+) @ (\\S+))`,
  'm',
);
const NO_CHECKPOINT_RE = new RegExp(`${JOURNAL_PREFIX}review:\\s*ordinary\\b`, 'm');
const RECUT_LINE_RE = new RegExp(`${JOURNAL_PREFIX}re-cut: \\d{4}-\\d{2}-\\d{2} — .*$`, 'gm');
const USER_TRACED_ROW_RE = /^(?:\d+\.|[-*]|\|).*→\s*(?:I\d+|scenario)\b/gmu;
const ADR_TRACED_ROW_RE = /^(?:\d+\.|[-*]|\|).*→\s*(ADR-\d{4})\b/gmu;
const TRACED_ROW_RE = /^(?:\d+\.|[-*]|\|).*→\s*(?:I\d+|scenario|ADR-\d{4})\b/gmu;
const ITEM_KEY_RE = /^docs\/backlog\/(?!epics\/)([^/]+)\/([^/]+)\.md$/u;
const FROZEN_FIELDS = [
  ['value', 'value'],
  ['tier', 'tier'],
  ['outcome', 'Outcome'],
  ['userScenario', 'User scenario'],
  ['invariants', 'Invariants'],
];

/** Frontmatter `status:` value, or null. */
export function statusOf(text) {
  const match = /^---[\s\S]*?^status:\s*(\S+)\s*$/m.exec(text ?? '');
  return match ? match[1] : null;
}

/** The graded contract of an item: status + CONTRACT_SECTIONS; null without text. */
export function itemContract(text) {
  if (text === null || text === undefined) return null;
  return [statusOf(text), ...CONTRACT_SECTIONS.map((name) => section(text, name))].join('\u0000');
}

function recutLines(text) {
  return (text ?? '').match(RECUT_LINE_RE) ?? [];
}

function countRows(text, re) {
  return CONTRACT_SECTIONS.reduce(
    (n, name) => n + ((section(text, name) ?? '').match(re) ?? []).length,
    0,
  );
}

/** ADR ids the graded sections trace to. */
function adrIds(text) {
  const ids = new Set();
  for (const name of CONTRACT_SECTIONS) {
    for (const m of (section(text, name) ?? '').matchAll(ADR_TRACED_ROW_RE)) ids.add(m[1]);
  }
  return ids;
}

/** Rows traced to I# / scenario across the graded sections (RDY-5: dropping one is the user's). */
export function userTracedRowCount(text) {
  return countRows(text, USER_TRACED_ROW_RE);
}

/** Obligations — rows traced to I# / scenario / ADR — across the graded sections (RDY-3, REV-4). */
export function tracedRowCount(text) {
  return countRows(text, TRACED_ROW_RE);
}

/** `docs/backlog/<area>/reference/<slug>-<kind>.json` for an item path or `<area>/<slug>` key. */
export function verdictArtifactPath(itemPathOrKey, kind = 'contract-red') {
  const m = ITEM_KEY_RE.exec(itemPathOrKey) ?? /^([^/]+)\/([^/]+)$/u.exec(itemPathOrKey);
  return m ? `docs/backlog/${m[1]}/reference/${m[2]}-${kind}.json` : null;
}

function parseJson(text) {
  try {
    const v = JSON.parse(text ?? 'null');
    return v !== null && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * A committed checkpoint verdict is a schema-shaped review — eight axes, a coverage table, the
 * unit it names, the reviewed commit — never a JSON with one field (REV-8). Returns a reason or null.
 */
export function checkpointVerdictShape(v, checkpoint, unitPath = null, shaPrefix = null) {
  if (v === null) return 'absent or not JSON';
  if (v.checkpoint !== checkpoint) return `checkpoint is not ${checkpoint}`;
  if (!Array.isArray(v.axes) || v.axes.length !== 8) return 'no eight rubric axes';
  if (!Array.isArray(v.coverage)) return 'no coverage table';
  if (
    typeof v.unit_goal_source !== 'string' ||
    (unitPath !== null && !v.unit_goal_source.includes(unitPath))
  )
    return 'unit_goal_source does not name this unit';
  if (!EXACT_SHA_RE.test(String(v.reviewed_sha ?? ''))) return 'no 40-hex reviewed_sha';
  if (shaPrefix !== null && !v.reviewed_sha.startsWith(shaPrefix))
    return `reviewed_sha is not ${shaPrefix}`;
  return null;
}

/**
 * A committed ordinary review (checkpoint-run.md §Ordinary review): the reviewer's prose verdict,
 * the reception lines with who ruled them, the reviewed commit. The driver never REJECTs a
 * Fidelity blocker on its own (REV-12).
 */
export function ordinaryVerdictShape(v) {
  if (v === null) return 'absent or not JSON';
  if (v.checkpoint !== 'ordinary') return 'checkpoint is not ordinary';
  if (typeof v.verdict !== 'string' || v.verdict.trim().length === 0) return 'no reviewer verdict';
  if (!Array.isArray(v.reception)) return 'no reception list';
  for (const r of v.reception) {
    if (
      r?.ruling === 'REJECT' &&
      r?.by !== 'critic' &&
      /Fidelity/iu.test(String(r?.authority ?? ''))
    )
      return `a Fidelity blocker REJECTed by ${r?.by ?? 'nobody'} — only the critic may (REV-12)`;
  }
  if (!EXACT_SHA_RE.test(String(v.reviewed_sha ?? ''))) return 'no 40-hex reviewed_sha';
  return null;
}

function artifactViolation(path, artifact, checkpoint, shaPrefix, unitPath, read) {
  const v = parseJson(read(artifact, 'head'));
  const reason =
    checkpoint === 'ordinary'
      ? ordinaryVerdictShape(v)
      : checkpointVerdictShape(v, checkpoint, unitPath, shaPrefix);
  return reason === null ? null : `${path}: ${artifact} — ${reason} (REV-8)`;
}

/** A ready flip carries its Contract+RED verdict — or, off any production path, `review: ordinary` (RDY-8). */
function readyFlipViolation(path, headText, read, besideProduction) {
  const m = VERDICT_LINE_RE.exec(headText);
  if (!m) {
    if (!besideProduction && NO_CHECKPOINT_RE.test(headText)) return null;
    return besideProduction
      ? `${path}: ready flip beside production source without a pickup Contract+RED verdict (RDY-8: a review: ordinary unit changes no production path)`
      : `${path}: ready flip without a pickup Contract+RED verdict or a review: ordinary line (RDY-8)`;
  }
  const inherited = m[2] ?? null;
  return artifactViolation(
    path,
    verdictArtifactPath(inherited ?? path),
    'Contract+RED',
    m[1] ?? m[3] ?? null,
    inherited ? null : path,
    read,
  );
}

const LANDING_ADDED_RE = /^docs\/backlog\/[^/]+\/reference\/[^/]+-(?:final-green|ordinary)\.json$/u;

/**
 * @param {{status:string,path:string}[]} entries  aggregate base..head name-status rows
 * @param {(path:string, side:'base'|'head') => string|null} read
 * @param {{status:string,path:string}[]} refereeEntries  full-PR rows
 * @returns {string[]} violations (empty = pass)
 */
// Code = a production path, or a test of the product (product roots, e2e, parity cases). Tests of
// the referees themselves (tools/checks/*.test.ts) are part of a referee PR, not of the product.
const PRODUCT_TEST_ROOT_RE =
  /^(?:apps|packages|services|tests|tools\/node-parity-runner\/cases)\//u;

export function evaluate(entries, read, refereeEntries = entries) {
  const kinds = entries.map((entry) => classifyAutonomousRunPath(entry.path));
  const besideProduction = kinds.includes('production');
  const besideCode =
    besideProduction ||
    entries.some(
      (entry, i) => kinds[i] === 'test-support' && PRODUCT_TEST_ROOT_RE.test(entry.path),
    );
  if (besideCode) {
    const refereeChanges = refereeEntries.filter((entry) => isReferee(entry.path));
    if (refereeChanges.length > 0) {
      return refereeChanges.map(
        (entry) =>
          `${entry.path}: implementation diff edits what judges it (PR-4) — land it separately`,
      );
    }
  }
  const landingAdded = entries.some(
    (entry) => entry.status !== 'D' && LANDING_ADDED_RE.test(entry.path),
  );
  const violations = [];
  for (const entry of entries) {
    if (!CONTRACT_RE.test(entry.path) || SKIP_RE.test(entry.path)) continue;
    const isGoal = EPIC_PATH_RE.test(entry.path) || GOAL_PATH_RE.test(entry.path);
    if (entry.status === 'D') {
      // Delete on done beside production leaves the verdicts behind (REV-8): a ready unit its landing
      // verdict; a compiled draft (traced rows — flipped, built and deleted inside this PR) both its
      // Contract+RED and its landing verdict; a plain draft any landing verdict added in the diff.
      if (!besideProduction || isGoal || entry.path.startsWith('docs/backlog/epics/')) continue;
      const baseText = read(entry.path, 'base');
      const ordinary = NO_CHECKPOINT_RE.test(baseText ?? '');
      const landing = (kind) =>
        artifactViolation(
          entry.path,
          verdictArtifactPath(entry.path, kind),
          kind === 'ordinary' ? 'ordinary' : 'Final+GREEN',
          null,
          entry.path,
          read,
        );
      if (GUARDED.has(statusOf(baseText))) {
        const v = landing(ordinary ? 'ordinary' : 'final-green');
        if (v) violations.push(v);
      } else if (tracedRowCount(baseText ?? '') > 0 && !ordinary) {
        const red = artifactViolation(
          entry.path,
          verdictArtifactPath(entry.path),
          'Contract+RED',
          null,
          entry.path,
          read,
        );
        if (red) violations.push(red);
        const v = landing('final-green');
        if (v) violations.push(v);
      } else if (!landingAdded) {
        violations.push(
          `${entry.path}: draft deleted beside production with no landing verdict added in this diff (REV-8)`,
        );
      }
      continue;
    }
    const baseText = read(entry.path, 'base');
    const headText = read(entry.path, 'head');
    if (headText === null) continue;
    // Frozen destination: single-file epics and dir-format goal.md (artifacts/goal.md).
    if (isGoal) {
      if (!besideProduction || !GUARDED.has(statusOf(baseText))) continue;
      const base = goalContract(baseText);
      const head = goalContract(headText);
      for (const [key, label] of FROZEN_FIELDS) {
        if (base[key] !== head[key]) {
          violations.push(`${entry.path}: frozen ${label} changed beside source`);
        }
      }
      continue;
    }
    // map.md / ledger.md are the agent's path and journal — review owns them
    if (entry.path.startsWith('docs/backlog/epics/')) continue;
    const baseStatus = statusOf(baseText);
    const headStatus = statusOf(headText);
    if (GUARDED.has(baseStatus)) {
      if (!besideProduction) continue; // a contract edit with no product beside it is review's
      if (!GUARDED.has(headStatus)) continue; // demotion — review discipline owns the fork record
      // A verdict line added or changed on an already-ready unit binds like a flip (REV-8).
      const baseLine = VERDICT_LINE_RE.exec(baseText ?? '')?.[0] ?? null;
      const headLine = VERDICT_LINE_RE.exec(headText)?.[0] ?? null;
      if (headLine !== null && headLine !== baseLine) {
        const v = readyFlipViolation(entry.path, headText, read, true);
        if (v) violations.push(v);
      }
      if (itemContract(baseText) === itemContract(headText)) continue; // journal / path edits
      const baseRecuts = new Set(recutLines(baseText));
      const newRecuts = recutLines(headText).filter((line) => !baseRecuts.has(line));
      if (newRecuts.length === 0) {
        violations.push(
          `${entry.path}: ready contract changed beside source without a re-cut line (RDY-5)`,
        );
        continue;
      }
      // Fewer user-traced rows = a dropped obligation: the user's, recorded as fork: in THIS re-cut
      // line (RDY-5) — an older fork never licenses a later drop. Rewording stays review's
      // (REV-10 axis 3): a count cannot tell strengthening from weakening.
      if (
        userTracedRowCount(headText) < userTracedRowCount(baseText) &&
        !newRecuts.some((line) => /— fork:/u.test(line))
      ) {
        violations.push(
          `${entry.path}: user-traced row dropped beside source without a recorded fork (RDY-5)`,
        );
      }
      // An ADR-traced obligation leaves only with THAT ADR named in the re-cut line (RDY-5).
      const headIds = adrIds(headText);
      for (const id of adrIds(baseText)) {
        if (headIds.has(id)) continue;
        if (!newRecuts.some((line) => line.includes(id))) {
          violations.push(
            `${entry.path}: ${id}-traced row dropped beside source without ${id} named in the re-cut line (RDY-5)`,
          );
        }
      }
      continue;
    }
    // A ready flip, in any diff, carries its committed Contract+RED verdict — or, off any
    // production path, a `review: ordinary` line (RDY-8, REV-8).
    if (GUARDED.has(headStatus)) {
      const violation = readyFlipViolation(entry.path, headText, read, besideProduction);
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  const historyHead = historyHeadRevision(process.env, (path) => readFileSync(path, 'utf8'));
  if (historyHead.error !== null) {
    console.error(`contract-drift: ✗ ${historyHead.error}`);
    process.exit(1);
  }
  const head = historyHead.revision;
  let base;
  try {
    base = git('merge-base', 'origin/main', head).trim();
  } catch {
    console.log('contract-drift: SKIPPED — no origin/main merge-base (shallow clone?)');
    return;
  }
  const entries = git('diff', '--name-status', base, head)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
  const read = (path, side) => {
    try {
      if (side === 'base') return git('show', `${base}:${path}`);
      return head === 'HEAD' ? readFileSync(path, 'utf8') : git('show', `${head}:${path}`);
    } catch {
      return null;
    }
  };
  const violations = evaluate(entries, read);
  if (violations.length > 0) {
    console.error(`contract-drift: ${violations.length} violation(s) vs ${base.slice(0, 12)}:`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }
  console.log(`contract-drift: OK (${entries.length} path(s) vs ${base.slice(0, 12)})`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
