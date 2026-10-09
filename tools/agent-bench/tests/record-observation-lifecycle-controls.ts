import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import { RecordObservation, withRecordObservation } from '../src/judge/record-observation.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const parent = resolve('.cache/pr341');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'record-lifecycle-'));
const task = (await loadCorpus('eval-v14')).find(
  (entry) => entry.family === 'expense-conservation',
)!;
await writeTree(root, { ...task.files, ...task.controls!.reference! });
await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, timeoutMs: 300000 });
const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawnLoggedServer(
  join(root, 'node_modules/.bin/vite'),
  ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, env: process.env, logPath: join(root, 'server.log'), detached: true },
);
const browser = await chromium.launch();
const rows: { phase: string; pass: boolean; evidence: unknown }[] = [];
try {
  await waitHttpReady(url, 30000, 'record observation lifecycle');
  for (const phase of [
    'success',
    'after-applied-write',
    'cause-and-cleanup',
    'swallowed-cleanup',
    'collision',
    'generated-collision-retry',
    'generated-collision-exhausted',
    'escaped-scope',
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const input = (name: string) => page.getByRole('textbox', { name, exact: true });
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const state = () => page.evaluate(() => localStorage.getItem('expense-settlement-v1'));
    try {
      await page.goto(url);
      await page.getByRole('heading', { name: 'Shared expenses', exact: true }).waitFor();
      await input('Person name').fill('Zed');
      await button('Add person').click();
      await input('Expense description').fill('Original');
      await page
        .getByRole('combobox', { name: 'Payer', exact: true })
        .selectOption({ label: 'Zed' });
      await input('Amount').fill('1.00');
      await page.getByRole('checkbox', { name: 'Zed', exact: true }).check();
      await button('Save expense').click();
      const before = await state();
      const primary = new Error('failure after actual applied Save');
      const marker = phase === 'collision' ? 'Original' : 'Owned temporary description';
      let caught: unknown;
      let result: unknown;
      try {
        result = await withRecordObservation(async (scope) => {
          if (phase === 'escaped-scope') return scope;
          if (phase === 'generated-collision-retry') {
            scope.reserve('Already reserved', ['Original']);
            const candidates = ['Original', 'Already reserved', '', marker];
            assert.equal(
              scope.reserveGenerated(() => candidates.shift()!, ['Original']),
              marker,
            );
          } else if (phase === 'generated-collision-exhausted') {
            scope.reserveGenerated(() => 'Original', ['Original']);
          } else {
            scope.reserve(marker, ['Original']);
          }
          await scope.apply(
            marker,
            async () => {
              if (phase === 'cause-and-cleanup' || phase === 'swallowed-cleanup')
                await page.close();
              await button(`Edit expense ${marker}`).click();
              await input('Expense description').fill('Original');
              await input('Amount').fill('1.00');
              await button('Save expense').click();
            },
            async () => {
              await button('Edit expense Original').click();
              await input('Expense description').fill(marker);
              await input('Amount').fill('1.01');
              await button('Save expense').click();
              if (phase === 'after-applied-write' || phase === 'cause-and-cleanup') throw primary;
            },
          );
          if (phase === 'swallowed-cleanup') {
            try {
              await scope.release(marker);
            } catch {
              /* Deliberate consumer misuse cannot grant success. */
            }
          }
          return 'receipt';
        });
      } catch (error) {
        caught = error;
      }
      const observer = page.isClosed() ? await context.newPage() : page;
      await observer.goto(url);
      await observer.getByRole('heading', { name: 'Shared expenses', exact: true }).waitFor();
      const after = await observer.evaluate(() => localStorage.getItem('expense-settlement-v1'));
      const errors = caught instanceof AggregateError ? (caught.errors as unknown[]) : [caught];
      if (phase === 'escaped-scope') {
        assert.ok(result instanceof RecordObservation);
        assert.throws(() => result.reserve(marker, ['Original']), /closed/);
        assert.throws(() => result.reserveGenerated(() => marker, ['Original']), /closed/);
        assert.equal(after, before);
      } else if (phase === 'success' || phase === 'generated-collision-retry') {
        assert.equal(result, 'receipt');
        assert.equal(after, before);
      } else {
        assert.notEqual(caught, undefined, `${phase}: no successful unsettled observation`);
        if (phase === 'after-applied-write') {
          assert.equal(caught, primary);
          assert.equal(after, before);
        }
        if (phase === 'cause-and-cleanup') {
          assert.ok(errors.includes(primary));
          assert.ok(
            errors.some(
              (error) => error instanceof Error && String(error.cause).includes('closed'),
            ),
          );
        }
        if (phase === 'swallowed-cleanup') assert.equal(result, undefined);
        if (phase === 'collision' || phase === 'generated-collision-exhausted') {
          assert.match(String(caught), /collision/);
          assert.equal(after, before);
        }
      }
      rows.push({
        phase,
        pass: true,
        evidence: { result, errors: errors.map(String), stateRestored: after === before },
      });
      console.log(JSON.stringify(rows.at(-1)));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await killProcessGroup(server);
  await writeFile(join(root, 'proof.json'), `${JSON.stringify({ root, rows }, null, 2)}\n`);
  console.log(`RECORD_LIFECYCLE_ROOT ${root}`);
}
