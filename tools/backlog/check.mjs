#!/usr/bin/env node
// Backlog linter (no deps). Run as: node tools/backlog/check.mjs (from repo root).
// - validates frontmatter of docs/backlog/<area>/<slug>.md
// - resolves every code marker (see docs/backlog/README.md) to an existing item
// - prints per-area×status counts; exits 1 on any violation

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const BACKLOG_DIR = join(ROOT, 'docs', 'backlog');
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
const STATUSES = ['active', 'parked', 'blocked', 'shipped'];
const STATUS_SET = new Set(STATUSES);

const REQUIRED_KEYS = ['area', 'status', 'title', 'created', 'why'];

const SCAN_ROOTS = ['packages', 'apps', 'tools'];
const CODE_EXT = new Set(['.ts', '.tsx', '.mjs', '.js']);
const EXCLUDE_DIRS = new Set(['dist', 'node_modules']);

const errors = [];

/** Recursively walk a dir, returning absolute file paths. */
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

/** Parse frontmatter between the first two '---' lines. Returns {} if absent. */
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

// --- Pass 1: collect + validate items ---------------------------------------

const itemFiles = walk(
  BACKLOG_DIR,
  (full, name) =>
    name.endsWith('.md') && !SKIP_FILES.has(name) && !full.split(sep).includes('reference'),
);

/** Set of existing "<area>/<slug>" keys. */
const itemKeys = new Set();
/** counts[area][status] = number */
const counts = {};

for (const file of itemFiles) {
  const rel = relative(BACKLOG_DIR, file);
  const parts = rel.split(sep);
  const slug = parts[parts.length - 1].replace(/\.md$/, '');
  const folder = parts.length >= 2 ? parts[parts.length - 2] : '';
  const key = `${folder}/${slug}`;
  itemKeys.add(key);

  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  if (!fm) {
    errors.push(`${rel}: missing or malformed frontmatter (need '---' fenced block)`);
    continue;
  }

  for (const reqKey of REQUIRED_KEYS) {
    if (!(reqKey in fm) || fm[reqKey] === '' || fm[reqKey] == null) {
      errors.push(`${rel}: missing required key '${reqKey}'`);
    }
  }

  if (fm.status != null && !STATUS_SET.has(fm.status)) {
    errors.push(`${rel}: invalid status '${fm.status}' (must be ${STATUSES.join('|')})`);
  }

  if (fm.area != null) {
    if (!KNOWN_AREAS.has(fm.area)) {
      errors.push(`${rel}: unknown area '${fm.area}'`);
    }
    if (fm.area !== folder) {
      errors.push(`${rel}: area '${fm.area}' does not match parent folder '${folder}'`);
    }
  }

  // Tally counts (use parsed status if valid, else 'invalid' bucket).
  const area = KNOWN_AREAS.has(folder) ? folder : folder || '(none)';
  const statusBucket = STATUS_SET.has(fm.status) ? fm.status : 'invalid';
  counts[area] ??= {};
  counts[area][statusBucket] = (counts[area][statusBucket] || 0) + 1;
}

// --- Pass 2: resolve code markers -------------------------------------------

// Built from parts so the literal marker token never appears in this source
// (otherwise the scanner would flag its own regex/error strings).
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
  const cols = [...STATUSES, 'invalid'];
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

console.log(`backlog: ${itemFiles.length} item(s)\n`);
printTable();

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('\nbacklog: OK');
process.exit(0);
