import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('retains every original frozen app byte and isolates corrected cases without dropping selected families', async () => {
  const original = '03a531ab20f4f5d1a96f2b6baa93502ef53b75f3';
  for (const id of ['csv-workflow', 'markdown-notes']) {
    const dir = `tools/agent-bench/corpus/cases/${id}`;
    for (const file of await readdir(dir)) {
      const path = join(dir, file);
      expect(await readFile(path)).toEqual(execFileSync('git', ['show', `${original}:${path}`]));
    }
    for (const file of [
      'project.json',
      'prompt.md',
      'reference.json',
      'partial.json',
      'alternative.json',
    ])
      expect(await readFile(join(dir, file))).toEqual(
        await readFile(`tools/agent-bench/corpus/cases/${id}-v2/${file}`),
      );
  }
  const path = 'tools/agent-bench/corpus/pilot-v1.json';
  expect(await readFile(path)).toEqual(execFileSync('git', ['show', `${original}:${path}`]));
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tools/agent-bench/src/cli.ts'),
      'plan',
      '--suite',
      'pilot-v2',
      '--config',
      'tools/agent-bench/configs/pilot-comparison.json',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  expect(child.status, child.stderr).toBe(0);
  const plan = JSON.parse(child.stdout) as {
    trials: unknown[];
    tasks: { id: string; family: string; split: string }[];
  };
  expect(plan.trials).toHaveLength(72);
  expect(plan.tasks.map((task) => task.id)).toEqual([
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow-v2',
    'markdown-notes-v2',
  ]);
  expect(
    plan.tasks.filter((task) => task.split === 'evaluation').map((task) => task.family),
  ).toEqual(['stable-serialization', 'async-concurrency', 'contact-import', 'linked-knowledge']);
}, 60000);
