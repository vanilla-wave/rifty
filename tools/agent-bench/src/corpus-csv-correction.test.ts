import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';

it('retains frozen v2 bytes and isolates CSV encoding correction with the same six families', async () => {
  const base = '0bed68b575f3a4a4f01c6babf0f15f2c0a5e7265';
  for (const id of ['csv-workflow-v2', 'markdown-notes-v2']) {
    const dir = `tools/agent-bench/corpus/cases/${id}`;
    for (const file of await readdir(dir)) {
      const path = `${dir}/${file}`;
      expect(await readFile(path)).toEqual(execFileSync('git', ['show', `${base}:${path}`]));
    }
  }
  const manifest = 'tools/agent-bench/corpus/pilot-v2.json';
  expect(await readFile(manifest)).toEqual(execFileSync('git', ['show', `${base}:${manifest}`]));
  for (const file of [
    'project.json',
    'prompt.md',
    'reference.json',
    'partial.json',
    'alternative.json',
  ])
    expect(await readFile(`tools/agent-bench/corpus/cases/csv-workflow-v3/${file}`)).toEqual(
      await readFile(`tools/agent-bench/corpus/cases/csv-workflow-v2/${file}`),
    );
  const tasks = await loadCorpus('pilot-v3');
  expect(tasks.map((t) => t.id)).toEqual([
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow-v3',
    'markdown-notes-v2',
  ]);
  expect(tasks.filter((t) => t.split === 'evaluation').map((t) => t.family)).toEqual([
    'stable-serialization',
    'async-concurrency',
    'contact-import',
    'linked-knowledge',
  ]);
});
