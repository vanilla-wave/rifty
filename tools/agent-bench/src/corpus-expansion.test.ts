import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';
it('resolves the separately frozen eight-case evaluation without family split leakage', async () => {
  const tasks = await loadCorpus('eval-v1');
  expect(tasks.map((t) => t.id)).toEqual([
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow-v3',
    'markdown-notes-v3',
    'booking-workflow',
    'expense-settlement',
  ]);
  expect(tasks.filter((t) => t.split === 'evaluation')).toHaveLength(6);
  expect(new Set(tasks.map((t) => t.family)).size).toBe(7);
  expect(tasks.filter((t) => t.group === 'app')).toHaveLength(4);
  const calibration = new Set(tasks.filter((t) => t.split === 'calibration').map((t) => t.family));
  for (const task of tasks.filter((t) => t.split === 'evaluation'))
    expect(calibration.has(task.family)).toBe(false);
});
it('plans the full separate evaluation campaign before calls', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'tools/agent-bench/src/cli.ts',
      'plan',
      '--suite',
      'eval-v1',
      '--config',
      'tools/agent-bench/configs/pilot-comparison.json',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  expect(child.status, child.stderr).toBe(0);
  const plan = JSON.parse(child.stdout) as { trials: unknown[]; tasks: unknown[] };
  expect(plan.tasks).toHaveLength(8);
  expect(plan.trials).toHaveLength(96);
}, 60000);
