import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it('resolves the frozen pilot with real projects/apps, family separation and identical lock identity', async () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tools/agent-bench/src/cli.ts'),
      'plan',
      '--config',
      'tools/agent-bench/configs/gpt-6-luna.json',
      '--suite',
      'pilot-v1',
      '--runs',
      '2',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  expect(result.status, result.stderr).toBe(0);
  const plan = JSON.parse(result.stdout) as {
    tasks: {
      id: string;
      group: string;
      family: string;
      split: string;
      lockfileSha256: string | null;
      filesSha256: string;
    }[];
    trials: unknown[];
  };
  expect(plan.tasks.map((task) => task.id)).toEqual([
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow',
    'markdown-notes',
  ]);
  expect(plan.trials).toHaveLength(48);
  expect(new Set(plan.tasks.map((task) => task.group))).toEqual(new Set(['bug', 'feature', 'app']));
  const calibration = new Set(
    plan.tasks.filter((task) => task.split === 'calibration').map((task) => task.family),
  );
  for (const task of plan.tasks.filter((task) => task.split === 'evaluation'))
    expect(calibration.has(task.family)).toBe(false);
  for (const task of plan.tasks) {
    expect(task.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
    const files = JSON.parse(
      await readFile(`tools/agent-bench/corpus/cases/${task.id}/project.json`, 'utf8'),
    ) as Record<string, string>;
    expect(JSON.parse(files['package-lock.json']!).lockfileVersion).toBe(3);
    expect(
      Object.keys(files).some((path) => /reference|partial|alternative|judge/.test(path)),
    ).toBe(false);
  }
}, 60000);
