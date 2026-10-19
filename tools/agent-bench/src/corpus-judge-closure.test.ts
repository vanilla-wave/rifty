import { readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { judgeImportClosure, loadCorpus } from './corpus.ts';

// ADR-0506/0507: the judge fingerprint covers every file the judge's criteria come from.
// A helper reached only through an import but absent from `judgeFiles` lets changed
// criteria pass as comparable (fault class: provenance-lie / sibling-drift).
it('fingerprints the whole import closure of every corpus judge', async () => {
  const suites = (await readdir('tools/agent-bench/corpus'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length));
  const gaps: string[] = [];
  for (const suite of suites)
    for (const task of await loadCorpus(suite)) {
      if (!task.judgeFiles) continue;
      const missing = (await judgeImportClosure(task.judgeFiles[0]!)).filter(
        (file) => !task.judgeFiles!.includes(file),
      );
      if (missing.length) gaps.push(`${suite}/${task.id}: ${missing.join(', ')}`);
    }
  expect(gaps).toEqual([]);
}, 120_000);
