#!/usr/bin/env node
// Scaffold an ADR + auto-append its row to the README Index (kept in sync by construction).
// Usage: pnpm adr:new <area> "Title" [--number NNNN]
//   --number NNNN  author a specific (e.g. reserved) number instead of max+1.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// areas == docs/adr/<area>/ subdirs (keep in sync with tools/refs/check.mjs + README Index)
const AREAS = new Set([
  'vfs',
  'kernel',
  'runtime-js',
  'runtime-wasi',
  'net',
  'service-worker',
  'npm-client',
  'playground',
  'toolchain-build',
  'protocol',
  'opencode',
  'perf',
  'shell',
  'terminal',
  'distribution',
]);

// Provisional labels reserved by the JS-runtime perf plan (docs/adr/README.md Numbering).
const RESERVED = new Set();
for (let n = 81; n <= 93; n++) RESERVED.add(String(n).padStart(4, '0'));

// --- args: <area> "Title" [--number NNNN] -----------------------------------
const argv = process.argv.slice(2);
let forced = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--number') forced = argv[++i];
  else rest.push(argv[i]);
}
const [area, ...titleParts] = rest;
const title = titleParts.join(' ').trim();

const usage = `Usage: pnpm adr:new <area> "Title" [--number NNNN]\n  areas: ${[...AREAS].join(', ')}`;
if (!area || !title) {
  console.error(usage);
  process.exit(1);
}
if (!AREAS.has(area)) {
  console.error(`Unknown area "${area}". Known: ${[...AREAS].join(', ')}`);
  process.exit(1);
}

const adrRoot = new URL('../../docs/adr/', import.meta.url);
const readmePath = new URL('README.md', adrRoot);

// existing numbers = every NNNN-*.md anywhere under docs/adr/**
async function collectNumbers(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) out.push(...(await collectNumbers(new URL(`${ent.name}/`, dir))));
    else {
      const m = /^(\d{4})-/.exec(ent.name);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

const existing = new Set(await collectNumbers(adrRoot));

let next;
if (forced != null) {
  if (!/^\d{4}$/.test(forced)) {
    console.error(`--number must be 4 digits, got "${forced}"`);
    process.exit(1);
  }
  if (existing.has(forced)) {
    console.error(`ADR ${forced} already exists on disk — pick a free number.`);
    process.exit(1);
  }
  next = forced;
  if (!RESERVED.has(forced)) console.log(`note: ${forced} is not in the reserved 0081-0093 band.`);
} else {
  // first free number above the current max, skipping the reserved block
  let n = (existing.size === 0 ? 0 : Math.max(...[...existing].map(Number))) + 1;
  while (RESERVED.has(String(n).padStart(4, '0')) || existing.has(String(n).padStart(4, '0'))) n++;
  next = String(n).padStart(4, '0');
}

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const adrPath = new URL(`${area}/${next}-${slug}.md`, adrRoot);

const date = new Date().toISOString().slice(0, 7);
const body = `# ADR ${next}: ${title}

Status: Proposed
Date: ${date}

> TL;DR: <the decision in one sentence — fill in>

## Context

<why are we here, what's the question>

## Decision

<what we decided>

## Consequences

- <positive>
- <negative>
- <follow-ups>
`;

/**
 * Insert `| NNNN | Title |` into the README Index under `### <area>`.
 * Creates the area subsection (at the end of Index) if it doesn't exist yet.
 * Returns the updated README text. Throws if the Index structure isn't found.
 */
function appendIndexRow(text, area, num, title) {
  const lines = text.split('\n');
  const indexAt = lines.findIndex((l) => /^##\s+Index\s*$/.test(l));
  const supersededAt = lines.findIndex((l) => /^##\s+Superseded\b/.test(l));
  if (indexAt === -1 || supersededAt === -1)
    throw new Error('README Index/Superseded markers not found');

  const row = `| ${num} | ${title} |`;
  const areaAt = lines.findIndex(
    (l, i) => i > indexAt && i < supersededAt && l.trim() === `### ${area}`,
  );

  if (areaAt !== -1) {
    // find the last contiguous table row of this subsection, insert after it
    let i = areaAt + 1;
    let lastRow = -1;
    for (; i < supersededAt; i++) {
      if (/^###\s/.test(lines[i])) break;
      if (lines[i].startsWith('|')) lastRow = i;
    }
    if (lastRow === -1) throw new Error(`Index subsection "### ${area}" has no table`);
    lines.splice(lastRow + 1, 0, row);
  } else {
    // new area subsection, placed just before "## Superseded"
    const block = ['', `### ${area}`, '', '| # | Title |', '|---|---|', row];
    let at = supersededAt;
    while (at > 0 && lines[at - 1].trim() === '') at--; // collapse trailing blanks
    lines.splice(at, 0, ...block);
  }
  return lines.join('\n');
}

await mkdir(dirname(fileURLToPath(adrPath)), { recursive: true });
await writeFile(adrPath, body);

const readme = await readFile(readmePath, 'utf8');
await writeFile(readmePath, appendIndexRow(readme, area, next, title));

console.log(`Created ${fileURLToPath(adrPath)}\nIndexed under "### ${area}" in docs/adr/README.md`);
