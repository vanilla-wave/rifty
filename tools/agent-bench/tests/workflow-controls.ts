import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { readTree, writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';
import bookingOracle from './workflow-oracles/booking.ts';
import expenseOracle from './workflow-oracles/expense.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-workflow-controls-'));
const browser = await chromium.launch();
const rows = [];
try {
  const wrongWorkflow = process.argv.includes('--wrong-workflow');
  const ids = wrongWorkflow
    ? ['csv-workflow-v3', 'markdown-notes-v3']
    : ['booking-workflow', 'expense-settlement'];
  const tasks = (await loadCorpus(wrongWorkflow ? 'pilot-v4' : 'eval-v1')).filter((task) =>
    ids.includes(task.id),
  );
  assert.equal(tasks.length, 2);
  for (const task of tasks) {
    for (const variant of ['baseline', 'reference', 'partial', 'alternative']) {
      const startedAt = new Date().toISOString();
      const dir = join(root, task.id, variant);
      await mkdir(dir, { recursive: true });
      const files = { ...task.files, ...task.controls![variant]! };
      await writeTree(dir, files);
      await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], {
        cwd: dir,
        env: { ...process.env, NODE_PATH: undefined },
        timeoutMs: 300000,
      });
      await runOrThrow('npm', ['run', 'build'], {
        cwd: dir,
        env: { ...process.env, NODE_PATH: undefined },
        timeoutMs: 120000,
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
        await waitHttpReady(url, 30000, 'workflow control');
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(url);
        const oracle = task.id === ids[0] ? bookingOracle : expenseOracle;
        const result = await oracle({ view: page, previewUrl: url });
        const row = {
          task: task.id,
          variant,
          expectedPass: !wrongWorkflow && (variant === 'reference' || variant === 'alternative'),
          result,
          errors,
          startedAt,
          finishedAt: new Date().toISOString(),
          dir,
          files: await readTree(dir),
        };
        rows.push(row);
        console.log(JSON.stringify({ task: task.id, variant, pass: result.pass, errors }));
      } finally {
        await context.close();
        await killProcessGroup(server);
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(
    join(root, 'evidence.json'),
    JSON.stringify({ purpose: 'controls', rows }, null, 2),
  );
  console.log(`WORKFLOW_CONTROL_ARTIFACTS ${root}`);
}
assert.equal(rows.length, 8);
for (const row of rows) {
  assert.equal(row.result.pass, row.expectedPass, `${row.task}/${row.variant}`);
  assert.deepEqual(row.errors, []);
}
