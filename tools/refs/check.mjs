#!/usr/bin/env node
// Cross-reference linter (no deps). Run: node tools/refs/check.mjs  (CI gate, blocking).
//
// Catches DANGLING refs — a doc points at a target that no longer exists. It does
// NOT flag orphans (a target nobody links to): backlog is a free capture store,
// unlinked ideas are fine by design.
//
// Scope (deliberately NOT docs/ROADMAP.md — that stays an informal doc):
//   1. ADR index <-> disk parity (docs/adr/README.md Index + Superseded table).
//   2. Every ADR-NNNN cited in docs/adr|docs/backlog resolves (file | removed | reserved | draft).
//   3. Every docs/... path/glob cited in docs/adr|docs/backlog resolves (incl. moved-tree redirects).
//
// reference/ subtrees are excluded as ref SOURCES (long-form design scratch with its
// own draft namespace) but remain valid TARGETS.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const ADR_DIR = join(ROOT, 'docs', 'adr');
const BACKLOG_DIR = join(ROOT, 'docs', 'backlog');
const README = join(ADR_DIR, 'README.md');

// Reserved ADR numbers: provisional labels not yet materialised as files.
// (None — the perf-plan's 0081-0093 reservations were all materialised as ADRs
// 0082-0093 or retired (0081) in the M11/M12 merge.) Keep in sync with README "Numbering".
const RESERVED = new Set();

// Retired process ADR numbers: process decisions moved out of ADRs into AGENTS.md /
// docs/process/decision-workflow.md (no longer recorded as ADRs). Immutable product ADRs
// still cite these; they resolve there. Mirror docs/adr/README.md "Historical references".
const RETIRED = new Set(['0008', '0022', '0024', '0033', '0063', '0064', '0081']);

// Retired opencode draft labels still cited by historical ADRs. The opencode
// server-facade docs were removed, but immutable ADR prose can keep citing the
// old provisional labels without becoming dangling references.
const DRAFTS = new Set(['0056', '0057', '0058', '0059', '0060', '0061', '0062']);

// Moved doc trees: a `docs/<old>/x` ref resolves if `docs/<new>/x` exists.
// Mirror docs/adr/README.md "Historical references".
const REDIRECTS = [
  ['docs/compat/', 'docs/public/compat/'],
  ['docs/perf/', 'docs/backlog/perf/reference/'],
  ['docs/backlog/tests/', 'docs/backlog/toolchain-build/reference/'],
];

// Single-file renames (mirror "Historical references").
const FILE_REDIRECTS = {
  'docs/PUBLISHING.md': 'docs/public/publishing.md',
  'docs/hosting-netlify.md': 'docs/public/hosting-netlify.md',
};

// Removed with no successor: acknowledged dead, resolve to git history (mirror
// docs/adr/README.md "Historical references"). Immutable ADR bodies cite these by
// policy and are NOT rewritten; this list is what makes that policy auditable.
const TOMBSTONES = new Set([
  // root trackers retired into docs/backlog + docs/public
  'PROJECT_PLAN.md',
  'OPEN_QUESTIONS.md',
  // vision/architecture folded into AGENTS.md §Mission + ADRs (D-001..D-006)
  'docs/ARCHITECTURE.md',
  'REVIEW_ACTIONS.md',
  'TASKS.md',
  // architecture-review / follow-up ledgers (closed; git history)
  'docs/follow-ups-2026-05-27.md',
  'docs/follow-ups-architecture-review-2026-05-27.md',
  'docs/large-targets-readiness-2026-05-27.md',
  'docs/review/2026-05-26-architecture-review.md',
  'docs/processes/ecosystem-sweep.md',
  'docs/backlog-distribution-and-ide.md',
  // retired opencode server-facade exploration (no successor)
  'docs/opencode/',
  'docs/opencode-rifty-feasibility-2026-05-30.md',
  'docs/opencode/HANDOFF.md',
  'docs/opencode/README.md',
  'docs/opencode/decisions.md',
  'docs/opencode/feature-02-ts-on-import-graph.md',
  'docs/opencode/feature-05-effect-http-bridge.md',
  'docs/opencode/feature-07-ws-sse-bridge.md',
  // compat pages deleted in the docs/public split (not regenerated)
  'docs/compat/m10-tooling.md',
  'docs/compat/m10-tooling',
  'docs/compat/sqlite.md',
  'docs/compat/opencode-tool-ceiling.md',
  'docs/compat/browsers.md',
  'docs/public/compat/browsers.md',
  // completed backlog items removed on close (record = the ADR + code; ADR bodies still cite them)
  'docs/backlog/playground/terminal-node-command.md', // done → ADR-0154
  'docs/backlog/runtime-js/execsync-node-entry-loader.md', // done → ADR-0137/0143/0150 + code
]);

const errors = [];

/** Recursively walk a dir → absolute file paths matching predicate. */
function walk(dir, predicate) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, predicate));
    else if (ent.isFile() && predicate(full, ent.name)) out.push(full);
  }
  return out;
}

function exists(relPath) {
  try {
    statSync(join(ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

/** Glob-match a `dir/pattern` where pattern may contain `*`. */
function globMatches(relPath) {
  const idx = relPath.lastIndexOf('/');
  const dir = idx === -1 ? '' : relPath.slice(0, idx);
  const pat = relPath.slice(idx + 1);
  const re = new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  try {
    return readdirSync(join(ROOT, dir)).some((n) => re.test(n));
  } catch {
    return false;
  }
}

const has = (ref) => (ref.includes('*') ? globMatches(ref) : exists(ref));

/** Does a docs/... reference resolve (literal | renamed | moved-tree | tombstone | glob)? */
function docRefResolves(ref) {
  if (TOMBSTONES.has(ref)) return true;
  if (has(ref)) return true;
  if (FILE_REDIRECTS[ref] && exists(FILE_REDIRECTS[ref])) return true;
  for (const [from, to] of REDIRECTS) {
    if (ref.startsWith(from) && has(to + ref.slice(from.length))) return true;
  }
  return false;
}

// --- ADR files on disk: NNNN -> relpath -------------------------------------
const adrFiles = walk(ADR_DIR, (_f, n) => /^\d{4}-.*\.md$/.test(n));
const onDisk = new Map();
for (const f of adrFiles) {
  const num = /^(\d{4})-/.exec(f.split(sep).pop())[1];
  if (onDisk.has(num))
    errors.push(`duplicate ADR number ${num}: ${relative(ROOT, f)} and ${onDisk.get(num)}`);
  else onDisk.set(num, relative(ROOT, f));
}

// --- Parse README Index (active) + Superseded (removed) ---------------------
const readmeLines = readFileSync(README, 'utf8').split(/\r?\n/);
let section = 'index'; // index -> removed -> other
const indexNums = new Set();
const removedNums = new Set();
for (const line of readmeLines) {
  if (/^##\s+Superseded\b/i.test(line)) {
    section = 'removed';
    continue;
  }
  if (/^##\s+(Appendix|Numbering|Historical)/i.test(line)) {
    section = 'other';
    continue;
  }
  const m = /^\|\s*(\d{4})\s*\|/.exec(line);
  if (!m) continue;
  if (section === 'index') indexNums.add(m[1]);
  else if (section === 'removed') removedNums.add(m[1]);
}

// Check 1: index <-> disk parity
for (const num of onDisk.keys()) {
  if (!indexNums.has(num))
    errors.push(`ADR ${num} (${onDisk.get(num)}) is on disk but missing from the README Index`);
}
for (const num of indexNums) {
  if (!onDisk.has(num))
    errors.push(`README Index lists ADR ${num} but no file ${num}-*.md exists on disk`);
}
for (const num of removedNums) {
  if (onDisk.has(num))
    errors.push(
      `ADR ${num} is in the Superseded(removed) table but a file still exists: ${onDisk.get(num)}`,
    );
}

// --- Scan SOURCES (docs/adr + docs/backlog, excluding reference/) -----------
const isRefSource = (full, name) => name.endsWith('.md') && !full.split(sep).includes('reference');
const sources = [...walk(ADR_DIR, isRefSource), ...walk(BACKLOG_DIR, isRefSource)];

const ADR_REF_RE = /\bADR[-\s](\d{4})\b/g;
const DOC_PATH_RE = /docs\/[A-Za-z0-9._*/-]+/g;

function adrRefResolves(num) {
  return (
    onDisk.has(num) ||
    removedNums.has(num) ||
    RESERVED.has(num) ||
    DRAFTS.has(num) ||
    RETIRED.has(num)
  );
}

for (const file of sources) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');

  // Check 2: ADR-NNNN citations
  for (const m of text.matchAll(ADR_REF_RE)) {
    if (!adrRefResolves(m[1])) {
      errors.push(
        `${rel}: cites ADR-${m[1]} which has no file, no removed-row, and is not reserved/draft`,
      );
    }
  }

  // Check 3: docs/... path/glob citations
  for (const m of text.matchAll(DOC_PATH_RE)) {
    const ref = m[0].replace(/[.,)'"`]+$/, ''); // trim trailing punctuation
    if (/^docs\/(adr|backlog|public)\/?$/.test(ref)) continue; // bare placeholder roots
    if (!docRefResolves(ref)) errors.push(`${rel}: dangling doc reference ${ref}`);
  }
}

// --- Report -----------------------------------------------------------------
console.log(
  `refs: ${onDisk.size} ADR file(s), ${indexNums.size} index row(s), ${removedNums.size} removed row(s), ${sources.length} source doc(s)\n`,
);

if (errors.length > 0) {
  console.error(`${errors.length} dangling reference(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('refs: OK');
process.exit(0);
