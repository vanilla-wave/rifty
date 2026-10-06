import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { readTree, writeTree } from '../src/files.ts';
import { editableControl } from '../src/judge/context.ts';
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
const faultMode = process.argv.includes('--faults');
const faults = faultMode
  ? (JSON.parse(
      await readFile('tools/agent-bench/tests/fixtures/workflow-faults.json', 'utf8'),
    ) as { task: string; variant: string; from: string; to: string; requirement: string }[])
  : [];
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
    for (const variant of faultMode
      ? faults.filter((f) => f.task === task.id).map((f) => f.variant)
      : ['baseline', 'reference', 'partial', 'alternative']) {
      const startedAt = new Date().toISOString();
      const dir = join(root, task.id, variant);
      await mkdir(dir, { recursive: true });
      let patch = task.controls![variant]!;
      const fault = faults.find((f) => f.task === task.id && f.variant === variant);
      if (fault) {
        patch = { ...task.controls!.reference! };
        let changes = 0;
        for (const [path, text] of Object.entries(patch)) {
          if (text.includes(fault.from)) {
            patch[path] = text.replace(fault.from, fault.to);
            changes++;
          }
        }
        assert.equal(changes, 1, `Fault applies exactly once: ${variant}`);
      }
      const files = { ...task.files, ...patch };
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
        const large = [];
        if (task.id === 'expense-settlement' && result.pass) {
          const ctx = { view: page, previewUrl: url };
          for (const [index, value, expected] of [
            [1, '90071992547409.90', '90071992547419.91'],
            [2, '0.01', '90071992547419.92'],
            [3, '0.01', '90071992547419.93'],
          ] as const) {
            await page.getByRole('button', { name: 'New expense', exact: true }).click();
            await editableControl(ctx, /description/i).fill(`Large ${index}`);
            await editableControl(ctx, /payer/i).selectOption({ label: 'Zed' });
            await editableControl(ctx, /amount/i).fill(value);
            const picker = editableControl(ctx, /participants/i);
            if (await picker.count()) await picker.selectOption({ label: 'Ada' });
            else await page.getByRole('checkbox', { name: 'Ada', exact: true }).check();
            await page.getByRole('button', { name: 'Save expense', exact: true }).click();
            const named = page.getByLabel('Zed Paid', { exact: true });
            const output = (await named.count())
              ? named
              : page
                  .getByRole('row')
                  .filter({ has: page.getByRole('cell', { name: 'Zed', exact: true }) })
                  .getByRole('cell')
                  .nth(1);
            const observed = (await output.innerText()).trim();
            assert.equal(observed, expected);
            large.push({ index, amount: value, paid: observed, expected });
          }
          await page.goto(url);
          const named = page.getByLabel('Zed Paid', { exact: true });
          const output = (await named.count())
            ? named
            : page
                .getByRole('row')
                .filter({ has: page.getByRole('cell', { name: 'Zed', exact: true }) })
                .getByRole('cell')
                .nth(1);
          assert.equal((await output.innerText()).trim(), '90071992547419.93');
        }
        const row = {
          task: task.id,
          variant,
          expectedPass:
            !faultMode && !wrongWorkflow && (variant === 'reference' || variant === 'alternative'),
          requirement: fault?.requirement,
          result,
          large,
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
assert.equal(rows.length, faultMode ? faults.length : 8);
for (const row of rows) {
  assert.equal(row.result.pass, row.expectedPass, `${row.task}/${row.variant}`);
  if (!faultMode) assert.deepEqual(row.errors, []);
}
