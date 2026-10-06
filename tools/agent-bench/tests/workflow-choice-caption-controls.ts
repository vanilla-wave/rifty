import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

// Public layout is open: visible choice captions may include useful context.
const root = await mkdtemp(join(tmpdir(), 'rifty-workflow-choice-captions-'));
const browser = await chromium.launch();
const rows = [];
try {
  const suite = process.argv[2] ?? 'eval-v1';
  const tasks = (await loadCorpus(suite)).filter((task) =>
    ['booking-constraints', 'expense-conservation'].includes(task.family!),
  );
  for (const task of tasks)
    for (const variant of ['reference', 'alternative'])
      for (const decorated of [false, true]) {
        const patch = { ...task.controls![variant]! };
        if (decorated) {
          const path = task.family === 'booking-constraints' ? 'src/App.vue' : 'src/App.svelte';
          const from =
            task.family === 'booking-constraints'
              ? '{{r.name}}</option>'
              : '{person.name}</option>';
          const to =
            task.family === 'booking-constraints'
              ? '{{r.name}} · {{r.capacity}} seats</option>'
              : '{person.name} · participant</option>';
          assert.ok(patch[path]!.includes(from));
          patch[path] = patch[path]!.replaceAll(from, to);
        }
        const files = { ...task.files, ...patch };
        const dir = join(root, task.id, `${variant}-${decorated ? 'decorated' : 'plain'}`);
        await mkdir(dir, { recursive: true });
        await writeTree(dir, files);
        for (const args of [
          ['ci', '--no-audit', '--no-fund'],
          ['run', 'build'],
        ])
          await runOrThrow('npm', args, {
            cwd: dir,
            env: { ...process.env, NODE_PATH: undefined },
            timeoutMs: 300000,
          });
        const port = await freePort();
        const url = `http://127.0.0.1:${port}/`;
        const server = spawnLoggedServer(
          join(dir, 'node_modules/.bin/vite'),
          ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
          {
            cwd: dir,
            env: { ...process.env, NODE_PATH: undefined },
            logPath: join(dir, 'server.log'),
            detached: true,
          },
        );
        const context = await browser.newContext();
        try {
          await waitHttpReady(url, 30000, 'choice-caption control');
          const page = await context.newPage();
          page.setDefaultTimeout(2000);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(url);
          const result = await task.judge!({
            view: page,
            previewUrl: url,
          });
          const row = { task: task.id, variant, decorated, result, errors, files, dir };
          rows.push(row);
          console.log(JSON.stringify({ task: task.id, variant, decorated, pass: result.pass }));
        } finally {
          await context.close();
          await killProcessGroup(server);
        }
      }
} finally {
  await browser.close();
  await writeFile(
    join(root, 'evidence.json'),
    JSON.stringify({ purpose: 'controls', rows }, null, 2),
  );
  console.log(`CHOICE_CAPTION_ARTIFACTS ${root}`);
}
assert.equal(rows.length, 8);
for (const row of rows) {
  assert.equal(row.result.pass, true, `${row.task}/${row.variant}/${row.decorated}`);
  assert.deepEqual(row.errors, []);
}
