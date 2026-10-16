import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

it('versions transfer observation without changing public tasks or frozen criteria', async () => {
  const previous = await loadCorpus('eval-v16');
  const current = await loadCorpus('eval-v17');
  expect(current).toHaveLength(8);
  expect(current.map((task) => [task.family, task.files, task.prompt, task.controls])).toEqual(
    previous.map((task) => [task.family, task.files, task.prompt, task.controls]),
  );
  for (const file of [
    'card.json',
    'judge.ts',
    'project.json',
    'prompt.md',
    'reference.json',
    'partial.json',
    'alternative.json',
  ]) {
    const path = `tools/agent-bench/corpus/cases/expense-settlement-v10/${file}`;
    expect(await readFile(path)).toEqual(execFileSync('git', ['show', `448711cfe:${path}`]));
  }
  const path = 'tools/agent-bench/corpus/eval-v16.json';
  expect(await readFile(path)).toEqual(execFileSync('git', ['show', `448711cfe:${path}`]));
  expect(current.find((task) => task.family === 'expense-conservation')?.id).toBe(
    'expense-settlement-v11',
  );
});
