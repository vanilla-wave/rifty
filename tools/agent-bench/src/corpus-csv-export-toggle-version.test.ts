import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

it('versions Export visibility only, preserving all eight public tasks and other seven judges', async () => {
  const before = await loadCorpus('eval-v4');
  const after = await loadCorpus('eval-v5');
  expect(after).toHaveLength(8);
  for (const task of before) {
    const changed = task.id === 'csv-workflow-v4';
    const id = changed ? 'csv-workflow-v5' : task.id;
    const next = after.find((candidate) => candidate.id === id)!;
    expect(next.files).toEqual(task.files);
    expect(next.prompt).toBe(task.prompt);
    expect(next.controls).toEqual(task.controls);
    expect(next.family).toBe(task.family);
    expect(next.split).toBe(task.split);
    for (const name of [
      'project.json',
      'prompt.md',
      'reference.json',
      'partial.json',
      'alternative.json',
    ])
      expect(await readFile(`tools/agent-bench/corpus/cases/${id}/${name}`)).toEqual(
        await readFile(`tools/agent-bench/corpus/cases/${task.id}/${name}`),
      );
    if (!changed)
      expect(await readFile(next.judgeFiles![0]!)).toEqual(await readFile(task.judgeFiles![0]!));
  }
  const certified = await readFile('tools/agent-bench/tests/workflow-oracles/csv-v5.ts', 'utf8');
  expect(await readFile('tools/agent-bench/corpus/cases/csv-workflow-v5/judge.ts', 'utf8')).toBe(
    certified.replaceAll('../../src/judge/context.ts', '../../../src/judge/context.ts'),
  );
});
