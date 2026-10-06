import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const task = (await loadCorpus(process.argv[2] ?? 'eval-v5')).find(
  (t) => t.family === 'contact-import',
)!;
const root = await mkdtemp(join(tmpdir(), 'rifty-csv-export-toggle-controls-'));
const reference = task.controls!.reference!;
const captured = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/csv-export-toggle-programme.json.gz'),
  ).toString(),
) as FileTree;
const source = captured['src/main.tsx']!;
function change(from: string, to: string): FileTree {
  assert.ok(source.includes(from), from);
  return { ...captured, 'src/main.tsx': source.replace(from, to) };
}
const variants = [
  { name: 'reference', files: reference, pass: true },
  { name: 'alternative', files: task.controls!.alternative!, pass: true },
  { name: 'captured-export-toggle', files: captured, pass: true },
  {
    name: 'stale-unfiltered-export',
    files: change('...filtered.map(c =>', '...contacts.map(c =>'),
    pass: false,
  },
  {
    name: 'duplicate-export',
    files: change('...filtered.map(c =>', '...filtered.concat(filtered).map(c =>'),
    pass: false,
  },
  {
    name: 'missing-export-row',
    files: change('...filtered.map(c =>', '...filtered.slice(1).map(c =>'),
    pass: false,
  },
  {
    name: 'no-export-output',
    files: change('exportOpen && <section', 'false && <section'),
    pass: false,
  },
  {
    name: 'lost-persistence',
    files: change('localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));', ''),
    pass: false,
  },
];
await mkdir(root, { recursive: true });
await writeTree(root, task.files);
await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, timeoutMs: 300000 });
const browser = await chromium.launch();
const evidence = [];
try {
  for (const variant of variants.filter((v) => !process.argv[3] || v.name === process.argv[3])) {
    await writeTree(root, { ...task.files, ...variant.files });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const server = spawnLoggedServer(
      join(root, 'node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: root, env: process.env, logPath: join(root, 'server.log'), detached: true },
    );
    const context = await browser.newContext();
    try {
      await waitHttpReady(url, 30000, 'CSV export control');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      const result = await task.judge!({ view: page, previewUrl: url });
      evidence.push({
        variant: variant.name,
        expectedPass: variant.pass,
        result,
        errors,
        source: variant.files,
      });
      console.log(
        JSON.stringify({ variant: variant.name, expectedPass: variant.pass, result, errors }),
      );
    } finally {
      await context.close();
      await killProcessGroup(server);
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`CSV_EXPORT_TOGGLE_ARTIFACTS ${root}`);
}
for (const row of evidence) {
  assert.equal(row.result.pass, row.expectedPass, row.variant);
  assert.deepEqual(row.errors, [], row.variant);
}
