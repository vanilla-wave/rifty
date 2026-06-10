#!/usr/bin/env node
// Scaffold an ADR + auto-append its row to the README Index (kept in sync by construction).
// Usage: pnpm adr:new <area> "Title" [--number NNNN]
//   --number NNNN  author a specific (e.g. reserved) number instead of max+1.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
  'perf',
  'shell',
  'terminal',
  'distribution',
]);

// Provisional reserved labels (none — the perf-plan's 0081-0093 reservations were
// materialised as ADRs / retired in the M11/M12 merge). Keep in sync with README "Numbering".
const RESERVED = new Set();

const STATE_DIR =
  process.env.RIFTY_ADR_STATE_DIR ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'rifty');
const STATE_PATH = join(STATE_DIR, 'adr-number.json');
const LOCK_PATH = join(STATE_DIR, 'adr-number.lock');
const LOCK_STALE_MS = 2 * 60 * 1000;

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

const maxExisting = existing.size === 0 ? 0 : Math.max(...[...existing].map(Number));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireStateLock() {
  await mkdir(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      await mkdir(LOCK_PATH);
      await writeFile(join(LOCK_PATH, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`);
      return async () => {
        await rm(LOCK_PATH, { recursive: true, force: true });
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      try {
        const lockStat = await stat(LOCK_PATH);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS)
          await rm(LOCK_PATH, { recursive: true, force: true });
      } catch (statErr) {
        if (statErr?.code !== 'ENOENT') throw statErr;
      }
      await sleep(50);
    }
  }
  throw new Error(`Timed out waiting for ADR number lock: ${LOCK_PATH}`);
}

async function readMachineLastNumber() {
  let raw;
  try {
    raw = await readFile(STATE_PATH, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }

  const parsed = JSON.parse(raw);
  if (!Number.isInteger(parsed.last) || parsed.last < 0)
    throw new Error(`Invalid ADR number state in ${STATE_PATH}: expected {"last": number}`);
  return parsed.last;
}

async function writeMachineLastNumber(last) {
  const body = JSON.stringify({ last, updatedAt: new Date().toISOString() }, null, 2);
  await writeFile(STATE_PATH, `${body}\n`);
}

async function allocateNumber(existing, forced, repoMax) {
  const release = await acquireStateLock();
  try {
    const machineLast = await readMachineLastNumber();
    const base = Math.max(repoMax, machineLast ?? repoMax);

    if (forced != null) {
      const forcedNumber = Number(forced);
      await writeMachineLastNumber(Math.max(base, forcedNumber));
      return forced;
    }

    let n = base + 1;
    while (RESERVED.has(String(n).padStart(4, '0')) || existing.has(String(n).padStart(4, '0')))
      n++;
    await writeMachineLastNumber(n);
    return String(n).padStart(4, '0');
  } finally {
    await release();
  }
}

if (forced != null) {
  if (!/^\d{4}$/.test(forced)) {
    console.error(`--number must be 4 digits, got "${forced}"`);
    process.exit(1);
  }
  if (existing.has(forced)) {
    console.error(`ADR ${forced} already exists on disk — pick a free number.`);
    process.exit(1);
  }
  if (RESERVED.size && !RESERVED.has(forced))
    console.log(`note: ${forced} is outside the reserved band.`);
}

const next = await allocateNumber(existing, forced, maxExisting);

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
await writeFile(adrPath, body, { flag: 'wx' });

const readme = await readFile(readmePath, 'utf8');
await writeFile(readmePath, appendIndexRow(readme, area, next, title));

console.log(
  `Created ADR ${next}: ${fileURLToPath(adrPath)}\nIndexed under "### ${area}" in docs/adr/README.md`,
);
