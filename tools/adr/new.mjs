#!/usr/bin/env node
import { readdir, writeFile } from 'node:fs/promises';

// areas == docs/adr/<area>/ subdirs (keep in sync with docs/adr/README.md Index)
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
  'process-meta',
  'opencode',
]);

const [area, ...rest] = process.argv.slice(2);
const title = rest.join(' ').trim();

if (!area || !title) {
  console.error(`Usage: pnpm adr:new <area> "Title"\n  areas: ${[...AREAS].join(', ')}`);
  process.exit(1);
}
if (!AREAS.has(area)) {
  console.error(`Unknown area "${area}". Known: ${[...AREAS].join(', ')}`);
  process.exit(1);
}

const adrRoot = new URL('../../docs/adr/', import.meta.url);

// next number = max over every NNNN-*.md anywhere under docs/adr/** (not flat)
async function collectNumbers(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      out.push(...(await collectNumbers(new URL(`${ent.name}/`, dir))));
    } else {
      const m = /^(\d{4})-/.exec(ent.name);
      if (m) out.push(Number(m[1]));
    }
  }
  return out;
}

const numbers = await collectNumbers(adrRoot);
const next = String((numbers.length === 0 ? 0 : Math.max(...numbers)) + 1).padStart(4, '0');

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const path = new URL(`${area}/${next}-${slug}.md`, adrRoot);

const date = new Date().toISOString().slice(0, 7);
const body = `# ADR ${next}: ${title}

Status: Proposed
Date: ${date}

## Context

<why are we here, what's the question>

## Decision

<what we decided>

## Consequences

- <positive>
- <negative>
- <follow-ups>
`;

await writeFile(path, body);
console.log(`Created ${path.pathname}`);
