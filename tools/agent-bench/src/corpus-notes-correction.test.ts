import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadCorpus } from './corpus.ts';
it('retains frozen pilot-v3 bytes and isolates notes correction without changing family/input selection', async () => {
  const base = 'db494579e4bde3aa61525f416c33633784654b08';
  for (const id of ['csv-workflow-v3', 'markdown-notes-v2']) {
    const dir = `tools/agent-bench/corpus/cases/${id}`;
    for (const file of await readdir(dir)) {
      const path = `${dir}/${file}`;
      expect(await readFile(path)).toEqual(execFileSync('git', ['show', `${base}:${path}`]));
    }
  }
  const manifest = 'tools/agent-bench/corpus/pilot-v3.json';
  expect(await readFile(manifest)).toEqual(execFileSync('git', ['show', `${base}:${manifest}`]));
  for (const file of [
    'project.json',
    'prompt.md',
    'reference.json',
    'partial.json',
    'alternative.json',
  ])
    expect(await readFile(`tools/agent-bench/corpus/cases/markdown-notes-v3/${file}`)).toEqual(
      await readFile(`tools/agent-bench/corpus/cases/markdown-notes-v2/${file}`),
    );
  const tasks = await loadCorpus('pilot-v4');
  expect(tasks.map((t) => t.id)).toEqual([
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow-v3',
    'markdown-notes-v3',
  ]);
  expect(tasks.filter((t) => t.split === 'evaluation').map((t) => t.family)).toEqual([
    'stable-serialization',
    'async-concurrency',
    'contact-import',
    'linked-knowledge',
  ]);
});
