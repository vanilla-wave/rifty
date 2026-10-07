import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const task = (await loadCorpus(process.argv[2] ?? 'eval-v6')).find(
  (t) => t.family === 'expense-conservation',
)!;
const root = await mkdtemp(join(tmpdir(), 'rifty-expense-native-number-controls-'));
const reference = task.controls!.reference!;
const source = reference['src/App.svelte']!;
const control = '<input bind:value={amount} inputmode="decimal">';
assert.ok(source.includes(control));
const numberSource = source.replace(
  control,
  '<input type="number" step="any" value={amount} oninput={(event) => amount = event.currentTarget.value} inputmode="decimal">',
);
const native: FileTree = { ...reference, 'src/App.svelte': numberSource };
function defect(from: string, to: string): FileTree {
  assert.ok(numberSource.includes(from), from);
  return { ...native, 'src/App.svelte': numberSource.replace(from, to) };
}
const variants = [
  { name: 'reference', files: reference, pass: true },
  { name: 'alternative', files: task.controls!.alternative!, pass: true },
  { name: 'native-number-raw-value', files: native, pass: true },
  { name: 'accepts-zero-native-number', files: defect('result > 0', 'result >= 0'), pass: false },
  {
    name: 'lost-persistence',
    files: defect('localStorage.setItem(key, JSON.stringify(next));', ''),
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
      await waitHttpReady(url, 30000, 'Expense native number control');
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
  console.log(`EXPENSE_NATIVE_NUMBER_ARTIFACTS ${root}`);
}
for (const row of evidence) {
  assert.equal(row.result.pass, row.expectedPass, row.variant);
  assert.deepEqual(row.errors, [], row.variant);
}
