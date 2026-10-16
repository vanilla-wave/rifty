import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { frozenDigest, sha256 } from './_fixtures/frozen-corpus.ts';
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
    expect(sha256(await readFile(path))).toBe(frozenDigest('448711cfe', path));
  }
  const path = 'tools/agent-bench/corpus/eval-v16.json';
  expect(sha256(await readFile(path))).toBe(frozenDigest('448711cfe', path));
  expect(current.find((task) => task.family === 'expense-conservation')?.id).toBe(
    'expense-settlement-v11',
  );
});
