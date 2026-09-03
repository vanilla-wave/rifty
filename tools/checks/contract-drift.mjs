#!/usr/bin/env node
/**
 * Contract-authority tripwire on the aggregate PR diff (merge-base vs head).
 * Beside source: frozen epic fields never change; a ready contract change
 * carries a `re-cut:` line and a changed user-traced row (→ I# / → scenario)
 * carries `fork:` in it (docs/process/rules/readiness.md RDY-5); lineage lines
 * and closure of items deleted here are free; ready flips need a recorded
 * pickup verdict. Process referees land separately (rules/pr.md PR-4).
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
const ITEM_PATH_RE = /^docs\/backlog\/(?!epics\/)(.+)\.md$/;
const EPIC_PATH_RE = /^docs\/backlog\/epics\/[^/]+\.md$/;
const GOAL_PATH_RE = /^docs\/backlog\/epics\/[^/]+\/goal\.md$/;
const REFEREE_RE =
  /^(?:tools\/checks\/(?:(?:contract-drift|run-pickup)(?:\.test)?\.(?:mjs|ts)|review-blockers\.test\.ts)|tools\/review\/(?:review-schema\.json|blockers\.mjs))$/;
// Journal lines a unit accrues during a run (artifacts/unit.md) — never a rewrite.
const LINEAGE_LINE_RE =
  /^(?:ready-verdict|contract-red|final-green|review|re-cut|override):[^\n]*\n?/gm;
const RECUT_LINE_RE = /^re-cut: \d{4}-\d{2}-\d{2} — .*$/gm;
const USER_TRACE_RE = /→\s*(?:I\d+|scenario)\b/u;
const TRACED_SECTIONS = ['Acceptance', 'Parity cases', 'Fault matrix'];
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

/** Remove only deleted ready-item keys from a dependent's blocked_by list. */
export function closeItemDependencies(itemText, deletedItems) {
  if (deletedItems.length === 0) return null;
  const closed = new Set(deletedItems);
  const line = /^blocked_by:\s*\[([^\]]*)\]\s*\r?\n?/m.exec(itemText);
  if (!line) return null;
  const dependencies = line[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const remaining = dependencies.filter((dependency) => !closed.has(dependency));
  if (remaining.length === dependencies.length) return null;
  const replacement = remaining.length > 0 ? `blocked_by: [${remaining.join(', ')}]\n` : '';
  return itemText.replace(line[0], replacement);
}

function stripLineage(text) {
  return (text ?? '').replace(LINEAGE_LINE_RE, '');
}

function recutLines(text) {
  return (text ?? '').match(RECUT_LINE_RE) ?? [];
}

/** Rows of a list/table section: a wrapped row joins its continuation lines. */
export function sectionRows(body) {
  const rows = [];
  for (const raw of (body ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('<!--')) continue;
    if (/^(?:\d+\.|[-*]|\|)\s/u.test(line) || line.startsWith('|')) rows.push(line);
    else if (rows.length > 0) rows[rows.length - 1] += ` ${line}`;
  }
  return rows.map((row) => row.replace(/\s+/g, ' '));
}

/** Rows a re-cut may not change without a recorded fork (RDY-5): traced to I# or scenario. */
export function userTracedRows(text) {
  return TRACED_SECTIONS.flatMap((name) => sectionRows(section(text, name))).filter((row) =>
    USER_TRACE_RE.test(row),
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
  const closedItems = [];
  for (const entry of entries) {
    if (entry.status !== 'D') continue;
    const item = ITEM_PATH_RE.exec(entry.path)?.[1];
    if (!item) continue;
    if (statusOf(read(entry.path, 'base')) !== 'ready') continue;
    closedItems.push(item);
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
      const strippedBase = stripLineage(baseText);
      const strippedHead = stripLineage(headText);
      if (strippedHead === strippedBase) continue;
      const closed = closeItemDependencies(strippedBase, closedItems);
      if (closed !== null && closed === strippedHead) continue;
      const baseRecuts = new Set(recutLines(baseText));
      const newRecuts = recutLines(headText).filter((line) => !baseRecuts.has(line));
      if (newRecuts.length === 0) {
        violations.push(
          `${entry.path}: ready contract changed beside source without a re-cut line (RDY-5)`,
        );
        continue;
      }
      const headRows = new Set(
        sectionRows(TRACED_SECTIONS.map((n) => section(headText, n) ?? '').join('\n')),
      );
      const dropped = userTracedRows(baseText).filter((row) => !headRows.has(row));
      if (dropped.length > 0 && !newRecuts.some((line) => /\bfork:/u.test(line))) {
        violations.push(
          `${entry.path}: user-traced row changed without a recorded fork (RDY-5): ${dropped[0].slice(0, 80)}`,
        );
      }
      continue;
    }
    if (GUARDED.has(headStatus) && !/^ready-verdict:/m.test(headText)) {
      violations.push(`${entry.path}: ready flip without pickup Contract+RED verdict`);
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
