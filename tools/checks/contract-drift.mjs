#!/usr/bin/env node
/**
 * Contract-authority tripwire on the aggregate PR diff (merge-base vs head).
 * Beside source: frozen epic fields never change; a ready CONTRACT — status +
 * the sections a reviewer grades (artifacts/unit.md) — changes only with a
 * `re-cut:` line (docs/process/rules/readiness.md RDY-5); Context, Challenge,
 * Decisions and the rest of the frontmatter are journal/path, never compared;
 * a dropped `→ I#`/`→ scenario` row needs `fork:` in the re-cut line
 * (rewording is review's, REV-10 axis 3); a ready flip beside production
 * source carries its pickup Contract+RED verdict — an `ordinary` unit changes
 * no production path (RDY-8). Referees — the gates, the parity oracle harness,
 * CI wiring — land separately (rules/pr.md PR-4).
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
// Referees — the gates, the CI classifier and lanes, the parity oracle harness, the review rubric —
// land separately (PR-4): a product PR never rewrites what judges it.
const REFEREE_RE =
  /^(?:tools\/checks\/(?:(?:contract-drift|run-pickup|ci-change-scope|ci-gate|pr-check)(?:\.test)?\.(?:mjs|ts)|review-blockers\.test\.ts)|tools\/review\/(?:review-schema\.json|blockers\.mjs)|tools\/backlog\/check\.mjs|tools\/node-parity-runner\/src\/.+|\.github\/workflows\/.+|docs\/process\/rules\/review\.md|\.agents\/skills\/rifty-review(?:-inline)?\/SKILL\.md|\.claude\/commands\/rifty-review-inline\.md)$/;
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
const USER_TRACED_ROW_RE = /^(?:\d+\.|[-*]|\|).*→\s*(?:I\d+|scenario)\b/gmu;
const ITEM_KEY_RE = /^docs\/backlog\/(?!epics\/)([^/]+)\/([^/]+)\.md$/u;

/** `docs/backlog/<area>/reference/<slug>-contract-red.json` for an item path or `<area>/<slug>` key. */
export function verdictArtifactPath(itemPathOrKey) {
  const m = ITEM_KEY_RE.exec(itemPathOrKey) ?? /^([^/]+)\/([^/]+)$/u.exec(itemPathOrKey);
  return m ? `docs/backlog/${m[1]}/reference/${m[2]}-contract-red.json` : null;
}

/** The committed Contract+RED verdict a `ready-verdict:` line names (REV-8), or the violation. */
function verdictArtifactViolation(path, headText, read) {
  const m = VERDICT_LINE_RE.exec(headText);
  if (!m)
    return `${path}: ready flip beside production source without a pickup Contract+RED verdict (RDY-8: a review: ordinary unit changes no production path)`;
  const artifact = verdictArtifactPath(m[2] ?? path);
  let parsed = null;
  try {
    parsed = JSON.parse(read(artifact, 'head') ?? 'null');
  } catch {
    parsed = null;
  }
  if (parsed?.checkpoint !== 'Contract+RED') {
    return `${path}: ready-verdict: names a Contract+RED pass but ${artifact} is absent or not a Contract+RED verdict (REV-8)`;
  }
  return null;
}
const RECUT_LINE_RE = new RegExp(`${JOURNAL_PREFIX}re-cut: \\d{4}-\\d{2}-\\d{2} — .*$`, 'gm');
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

/** Number of rows traced to I# / scenario across the graded sections (RDY-5: dropping one is the user's). */
export function userTracedRowCount(text) {
  return CONTRACT_SECTIONS.reduce(
    (n, name) => n + ((section(text, name) ?? '').match(USER_TRACED_ROW_RE) ?? []).length,
    0,
  );
}

const TRACED_ROW_RE = /^(?:\d+\.|[-*]|\|).*→\s*(?:I\d+|scenario|ADR-\d{4})\b/gmu;
/** Number of obligations — rows traced to I# / scenario / ADR — across the graded sections (RDY-3, REV-4). */
export function tracedRowCount(text) {
  return CONTRACT_SECTIONS.reduce(
    (n, name) => n + ((section(text, name) ?? '').match(TRACED_ROW_RE) ?? []).length,
    0,
  );
}

/**
 * @param {{status:string,path:string}[]} entries  aggregate base..head name-status rows
 * @param {(path:string, side:'base'|'head') => string|null} read
 * @param {{status:string,path:string}[]} refereeEntries  full-PR rows
 * @returns {string[]} violations (empty = pass)
 */
export function evaluate(entries, read, refereeEntries = entries) {
  if (!entries.some((entry) => classifyAutonomousRunPath(entry.path) === 'production')) return [];
  const refereeChanges = refereeEntries.filter((entry) => REFEREE_RE.test(entry.path));
  if (refereeChanges.length > 0) {
    return refereeChanges.map(
      (entry) =>
        `${entry.path}: implementation diff edits its own process referee — land gate semantics separately`,
    );
  }
  const violations = [];
  for (const entry of entries) {
    if (entry.status === 'D' || !CONTRACT_RE.test(entry.path) || SKIP_RE.test(entry.path)) {
      continue;
    }
    const baseText = read(entry.path, 'base');
    const headText = read(entry.path, 'head');
    if (headText === null) continue;
    // Frozen destination: single-file epics and dir-format goal.md (artifacts/goal.md).
    if (EPIC_PATH_RE.test(entry.path) || GOAL_PATH_RE.test(entry.path)) {
      if (!GUARDED.has(statusOf(baseText))) continue;
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
      if (!GUARDED.has(headStatus)) continue; // demotion — review discipline owns the fork record
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
      continue;
    }
    // Beside a production path only a Contract+RED verdict flips a unit ready — an `ordinary` unit
    // changes no production path (RDY-8) — and the verdict is the committed verdict.json (REV-8).
    if (GUARDED.has(headStatus)) {
      const violation = verdictArtifactViolation(entry.path, headText, read);
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
