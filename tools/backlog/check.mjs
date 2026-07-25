#!/usr/bin/env node
// Backlog linter (no deps). Run as: node tools/backlog/check.mjs (from repo root).
// - validates frontmatter of items docs/backlog/<area>/<slug>.md + epics docs/backlog/epics/<slug>.md
// - `ready` items/epics must carry their contract sections
// - epic / blocked_by / epic items links must resolve
// - resolves every code marker (see docs/backlog/README.md) to an existing item
// - prints per-area×status counts; exits 1 on any violation

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const BACKLOG_DIR = join(ROOT, 'docs', 'backlog');
const EPICS_DIR_NAME = 'epics';
const SKIP_FILES = new Set(['README.md', 'TEMPLATE.md']);

const KNOWN_AREAS = new Set([
  'vfs',
  'kernel',
  'runtime-js',
  'runtime-wasi',
  'net',
  'service-worker',
  'npm-client',
  'shell',
  'playground',
  'toolchain-build',
  'protocol',
  'process-meta',
  'perf',
  'terminal',
  'distribution',
]);

const ITEM_STATUSES = ['draft', 'ready'];
const ITEM_STATUS_SET = new Set(ITEM_STATUSES);
const EPIC_STATUSES = ['draft', 'ready', 'in-progress'];
const EPIC_STATUS_SET = new Set(EPIC_STATUSES);

const EPIC_TIERS = ['works', 'robust', 'production'];
const EPIC_TIER_SET = new Set(EPIC_TIERS);

const ITEM_REQUIRED_KEYS = ['area', 'status', 'title', 'created', 'why'];
const EPIC_REQUIRED_KEYS = ['kind', 'status', 'title', 'created', 'value'];
const READY_ITEM_SECTIONS = ['Acceptance', 'Parity cases', 'Out of scope', 'Decisions'];
const READY_EPIC_SECTIONS = ['Outcome', 'User scenario', 'Items'];

const SCAN_ROOTS = ['packages', 'apps', 'tools', 'services'];
const CODE_EXT = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE_DIRS = new Set(['dist', 'node_modules']);

const errors = [];

/** Recursively walk a dir, returning absolute file paths matching predicate. */
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
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      out.push(...walk(full, predicate));
    } else if (ent.isFile() && predicate(full, ent.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Parse frontmatter between the first two '---' lines. Returns null if absent. */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const fm = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      value = inner === '' ? [] : inner.split(',').map((s) => s.trim());
    }
    fm[key] = value;
  }
  return fm;
}

/** True if the markdown body contains a `## <name>` heading. */
function hasSection(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\b`, 'm').test(text);
}

// --- Pass 1: collect files, split items vs epics ----------------------------

const mdFiles = walk(
  BACKLOG_DIR,
  (full, name) =>
    name.endsWith('.md') && !SKIP_FILES.has(name) && !full.split(sep).includes('reference'),
);

const itemRecords = []; // { file, rel, area, slug, key, fm, text }
const epicRecords = []; // { file, rel, slug, fm, text }
const itemKeys = new Set(); // "<area>/<slug>"
const epicKeys = new Set(); // "<slug>"

for (const file of mdFiles) {
  const rel = relative(BACKLOG_DIR, file);
  const parts = rel.split(sep);
  const slug = parts[parts.length - 1].replace(/\.md$/, '');
  const folder = parts.length >= 2 ? parts[parts.length - 2] : '';
  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);

  if (folder === EPICS_DIR_NAME) {
    epicKeys.add(slug);
    epicRecords.push({ file, rel, slug, fm, text });
  } else {
    const key = `${folder}/${slug}`;
    itemKeys.add(key);
    itemRecords.push({ file, rel, area: folder, slug, key, fm, text });
  }
}

// --- Pass 2: validate items -------------------------------------------------

/** counts[area][status] = number */
const counts = {};

for (const { rel, area, fm, text } of itemRecords) {
  if (!fm) {
    errors.push(`${rel}: missing or malformed frontmatter (need '---' fenced block)`);
    continue;
  }
  for (const reqKey of ITEM_REQUIRED_KEYS) {
    if (!(reqKey in fm) || fm[reqKey] === '' || fm[reqKey] == null) {
      errors.push(`${rel}: missing required key '${reqKey}'`);
    }
  }
  if (fm.status != null && !ITEM_STATUS_SET.has(fm.status)) {
    errors.push(`${rel}: invalid status '${fm.status}' (must be ${ITEM_STATUSES.join('|')})`);
  }
  if (typeof fm.why === 'string' && /^(?:DELIVERED|DONE|LANDED)\b/i.test(fm.why)) {
    errors.push(`${rel}: completed item must be deleted, not kept active via why: ${fm.why}`);
  }
  if ('tier' in fm) {
    errors.push(`${rel}: tier lives on the epic (items inherit it) — remove 'tier'`);
  }
  if (fm.area != null) {
    if (!KNOWN_AREAS.has(fm.area)) errors.push(`${rel}: unknown area '${fm.area}'`);
    if (fm.area !== area)
      errors.push(`${rel}: area '${fm.area}' does not match parent folder '${area}'`);
  }
  // ready ⇒ contract sections present
  if (fm.status === 'ready') {
    for (const s of READY_ITEM_SECTIONS) {
      if (!hasSection(text, s)) errors.push(`${rel}: ready item missing '## ${s}' section`);
    }
    // Epic-grade scenario: a ready item WITHOUT an epic owns its `## User scenario`
    // (mission-anchored, real software). An epic child inherits it from the epic —
    // requiring it there too would just duplicate the epic's scenario.
    if (!fm.epic && !hasSection(text, 'User scenario')) {
      errors.push(
        `${rel}: ready item without an epic must carry a '## User scenario' section (epic children inherit it from the epic)`,
      );
    }
  }
  // links resolve
  if (fm.epic) {
    if (!epicKeys.has(fm.epic))
      errors.push(`${rel}: epic '${fm.epic}' — no epic docs/backlog/epics/${fm.epic}.md`);
  }
  if (Array.isArray(fm.blocked_by)) {
    for (const dep of fm.blocked_by) {
      if (dep && !itemKeys.has(dep))
        errors.push(`${rel}: blocked_by '${dep}' — no item docs/backlog/${dep}.md`);
    }
  }

  const a = KNOWN_AREAS.has(area) ? area : area || '(none)';
  const bucket = ITEM_STATUS_SET.has(fm?.status) ? fm.status : 'invalid';
  counts[a] ??= {};
  counts[a][bucket] = (counts[a][bucket] || 0) + 1;
}

// --- Pass 3: validate epics -------------------------------------------------

const epicCounts = { draft: 0, ready: 0, 'in-progress': 0, invalid: 0 };

for (const { rel, fm, text } of epicRecords) {
  if (!fm) {
    errors.push(`${rel}: missing or malformed frontmatter (need '---' fenced block)`);
    continue;
  }
  for (const reqKey of EPIC_REQUIRED_KEYS) {
    if (!(reqKey in fm) || fm[reqKey] === '' || fm[reqKey] == null) {
      errors.push(`${rel}: missing required key '${reqKey}'`);
    }
  }
  if (fm.kind !== 'epic') errors.push(`${rel}: epic must set 'kind: epic'`);
  if (fm.status != null && !EPIC_STATUS_SET.has(fm.status)) {
    errors.push(`${rel}: invalid status '${fm.status}' (must be ${EPIC_STATUSES.join('|')})`);
  }
  if (fm.tier != null && !EPIC_TIER_SET.has(fm.tier)) {
    errors.push(`${rel}: invalid tier '${fm.tier}' (must be ${EPIC_TIERS.join('|')})`);
  }
  if (fm.goal_baseline != null) {
    if (!/^[0-9a-f]{40}$/u.test(fm.goal_baseline)) {
      errors.push(`${rel}: goal_baseline must be one exact 40-hex commit`);
    }
    if (fm.tier == null) errors.push(`${rel}: autonomous goal_baseline requires tier`);
  }
  if (fm.status === 'ready' || fm.status === 'in-progress') {
    for (const s of READY_EPIC_SECTIONS) {
      if (!hasSection(text, s)) errors.push(`${rel}: ${fm.status} epic missing '## ${s}' section`);
    }
  }
  if (Array.isArray(fm.items)) {
    for (const it of fm.items) {
      if (it && !itemKeys.has(it))
        errors.push(`${rel}: items '${it}' — no item docs/backlog/${it}.md`);
    }
  }
  epicCounts[EPIC_STATUS_SET.has(fm?.status) ? fm.status : 'invalid'] += 1;
}

// --- Pass 4: resolve code markers -------------------------------------------

// Built from parts so the literal marker token never appears in this source.
const MARKER_TOKEN = `TODO${'('}backlog:`;
const MARKER_RE = new RegExp(`TODO\\${'('}backlog:\\s*([^)]+)\\)`, 'g');

for (const scanRoot of SCAN_ROOTS) {
  const dir = join(ROOT, scanRoot);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) continue;

  const codeFiles = walk(dir, (full) => {
    const dot = full.lastIndexOf('.');
    if (dot === -1) return false;
    return CODE_EXT.has(full.slice(dot));
  });

  for (const file of codeFiles) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(MARKER_RE)) {
      const target = m[1].trim();
      if (!itemKeys.has(target)) {
        errors.push(
          `${relative(ROOT, file)}: dangling marker ${MARKER_TOKEN} ${target}) — no item docs/backlog/${target}.md`,
        );
      }
    }
  }
}

// --- Report -----------------------------------------------------------------

function printTable() {
  const cols = [...ITEM_STATUSES, 'invalid'];
  const areas = Object.keys(counts).sort();
  const totals = {};
  for (const c of cols) totals[c] = 0;
  let grand = 0;

  const areaWidth = Math.max(4, ...areas.map((a) => a.length), 'TOTAL'.length);
  const pad = (s, w) => String(s).padEnd(w);
  const padNum = (n, w) => String(n).padStart(w);

  const header = [pad('area', areaWidth), ...cols.map((c) => padNum(c, 8)), padNum('total', 8)];
  console.log(header.join(' '));

  for (const area of areas) {
    const row = [pad(area, areaWidth)];
    let rowTotal = 0;
    for (const c of cols) {
      const n = counts[area][c] || 0;
      totals[c] += n;
      rowTotal += n;
      row.push(padNum(n, 8));
    }
    grand += rowTotal;
    row.push(padNum(rowTotal, 8));
    console.log(row.join(' '));
  }

  const totalRow = [pad('TOTAL', areaWidth)];
  for (const c of cols) totalRow.push(padNum(totals[c], 8));
  totalRow.push(padNum(grand, 8));
  console.log(totalRow.join(' '));
}

console.log(`backlog: ${itemRecords.length} item(s), ${epicRecords.length} epic(s)\n`);
printTable();
console.log(
  `\nepics: ${epicRecords.length} (draft ${epicCounts.draft}, ready ${epicCounts.ready}, in-progress ${epicCounts['in-progress']}, invalid ${epicCounts.invalid})`,
);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('\nbacklog: OK');
process.exit(0);
