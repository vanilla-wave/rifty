import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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

it('binds each new case to its public workflow, starter and certified semantic oracle', async () => {
  const tasks = await loadCorpus('eval-v1');
  for (const [id, library, version, prompt, oracle] of [
    ['booking-workflow', 'vue', '3.5.18', 'booking', 'booking'],
    ['expense-settlement', 'svelte', '5.38.7', 'expense', 'expense'],
  ] as const) {
    const task = tasks.find((candidate) => candidate.id === id)!;
    const pkg = JSON.parse(task.files['package.json']!) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.[library] ?? pkg.devDependencies?.[library]).toBe(version);
    expect(task.prompt).toBe(
      await readFile(`docs/backlog/distribution/reference/agent-eval-${prompt}-prompt.md`, 'utf8'),
    );
    const certified = await readFile(
      `tools/agent-bench/tests/workflow-oracles/${oracle}.ts`,
      'utf8',
    );
    expect(await readFile(`tools/agent-bench/corpus/cases/${id}/judge.ts`, 'utf8')).toBe(
      certified.replaceAll('../../src/judge/context.ts', '../../../src/judge/context.ts'),
    );
  }
});
