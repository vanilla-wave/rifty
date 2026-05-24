#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';

const qId = process.argv[2];
if (!qId || !/^Q-\d{4}-\d{2}-\d{2}-\d+$/.test(qId)) {
  console.error('Usage: pnpm adr:promote Q-YYYY-MM-DD-NNN');
  process.exit(1);
}

// 1. Find the entry in OPEN_QUESTIONS.md
const oqPath = new URL('../../OPEN_QUESTIONS.md', import.meta.url);
const oq = await readFile(oqPath, 'utf8');
const headerRe = new RegExp(`^## ${qId}:\\s*(.+)$`, 'm');
const headerMatch = headerRe.exec(oq);
if (!headerMatch) {
  console.error(`Question ${qId} not found in OPEN_QUESTIONS.md`);
  process.exit(1);
}
const title = headerMatch[1];

// 2. Create a new ADR with extracted context.
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
const newAdrPath = new URL(`${next}-${slug}.md`, adrDir);

const date = new Date().toISOString().slice(0, 7);
const body = `# ADR ${next}: ${title}

Status: Accepted (promoted from ${qId})
Date: ${date}

## Context

Promoted from OPEN_QUESTIONS.md entry ${qId}.

## Decision

<copy the provisional decision from OPEN_QUESTIONS.md and confirm or adjust>

## Consequences

- <positive>
- <negative>
- <follow-ups>
`;
await writeFile(newAdrPath, body);

// 3. Remove TODO(ADR): ${qId} markers across the repo (best-effort: only touch tracked source files).
// grep exits 1 when no lines match — that's success here, not failure.
const { spawnSync } = await import('node:child_process');
const grepResult = spawnSync(
  'grep',
  [
    '-rl',
    '--include=*.ts',
    '--include=*.tsx',
    '--include=*.js',
    '--include=*.mjs',
    `TODO(ADR): ${qId}`,
    '.',
  ],
  { encoding: 'utf8' },
);
if (grepResult.status !== 0 && grepResult.status !== 1) {
  console.error(`grep failed (status ${grepResult.status}): ${grepResult.stderr}`);
  process.exit(1);
}
const filesWithMarker = (grepResult.stdout || '').split('\n').filter(Boolean);

for (const file of filesWithMarker) {
  const text = await readFile(file, 'utf8');
  const cleaned = text
    .split('\n')
    .filter((line) => !line.includes(`TODO(ADR): ${qId}`))
    .join('\n');
  await writeFile(file, cleaned);
}

console.log(`Created ${newAdrPath.pathname}`);
console.log(`Cleared TODO(ADR) markers in ${filesWithMarker.length} files`);
console.log(`Update OPEN_QUESTIONS.md to mark ${qId} as Promoted -> ADR ${next}.`);
