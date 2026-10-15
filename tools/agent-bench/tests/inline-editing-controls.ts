import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';

// Actual pinned Vue regression; standalone tsx driver avoids Playwright's SDK TS transform.
{
  const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
  config.runsPerTask = 1;
  const booking = (await loadCorpus('eval-v8')).find((task) => task.id === 'booking-workflow-v5');
  if (!booking?.controls?.reference) throw Error('Missing pinned booking reference');
  const dual = JSON.parse(
    await readFile('tools/agent-bench/tests/fixtures/booking-dual-editor.json', 'utf8'),
  ) as FileTree;
  const tasks = [
    { ...booking, id: `${booking.id}-single-editor` },
    {
      ...booking,
      id: `${booking.id}-dual-editor`,
      controls: { ...booking.controls, reference: dual },
    },
  ];
  const expense = (await loadCorpus('eval-v8')).find((task) => task.id === 'expense-settlement-v5');
  if (!expense?.controls?.reference) throw Error('Missing pinned expense reference');
  const expenseDual = JSON.parse(
    await readFile('tools/agent-bench/tests/fixtures/expense-dual-editor.json', 'utf8'),
  ) as FileTree;
  tasks.push(
    { ...expense, id: `${expense.id}-single-editor` },
    {
      ...expense,
      id: `${expense.id}-dual-editor`,
      controls: { ...expense.controls, reference: expenseDual },
    },
  );
  const root = await mkdtemp(join(tmpdir(), 'rifty-inline-editing-regression-'));
  const report = await run(config, tasks, ['local-reference'], join(root, 'series'), 'reference');
  assert.equal(report.runs.length, 4);
  for (const trial of report.runs) {
    assert.equal(trial.agentStatus, 'not-run');
    assert.ok(trial.judge.probes.length > 0);
    assert.equal(
      trial.judge.pass,
      true,
      JSON.stringify({
        root,
        task: trial.task,
        failed: trial.judge.probes.filter((probe) => !probe.pass),
      }),
    );
    assert.equal(trial.outcome, 'pass');
  }
  console.log('PASS: real single/dual Vue/Svelte editing consumers; no models');
}
