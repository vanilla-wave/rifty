#!/usr/bin/env node
import { readdir, writeFile } from 'node:fs/promises';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: pnpm adr:new "Title"');
  process.exit(1);
}

const adrDir = new URL('../../docs/adr/', import.meta.url);
const files = await readdir(adrDir);
const numbers = files
  .map((f) => /^(\d{4})-/.exec(f))
  .filter((m) => m !== null)
  .map((m) => Number(m[1]));
const next = String((numbers.length === 0 ? 0 : Math.max(...numbers)) + 1).padStart(4, '0');

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const path = new URL(`${next}-${slug}.md`, adrDir);

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
