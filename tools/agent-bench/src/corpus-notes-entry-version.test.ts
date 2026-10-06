import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

it('versions only composed-note observation, preserving public inputs and the other seven judges', async () => {
  const before = await loadCorpus('eval-v3');
  const after = await loadCorpus('eval-v4');
  expect(after).toHaveLength(8);
  for (const task of before) {
    const changed = task.id === 'markdown-notes-v3';
    const id = changed ? 'markdown-notes-v4' : task.id;
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
  const certified = await readFile('tools/agent-bench/tests/workflow-oracles/notes-v4.ts', 'utf8');
  expect(await readFile('tools/agent-bench/corpus/cases/markdown-notes-v4/judge.ts', 'utf8')).toBe(
    certified.replaceAll('../../src/judge/context.ts', '../../../src/judge/context.ts'),
  );
});
