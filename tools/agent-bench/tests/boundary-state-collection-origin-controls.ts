import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const tasks = (await loadCorpus('boundary-v1')).filter((task) =>
  ['async-search-1', 'async-search-2'].includes(task.id),
);
assert.equal(tasks.length, 2);
const root = await mkdtemp(join(resolve('.cache/pr341'), 'state-collection-controls-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5531;
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose:
        'Fresh published state collection controls; original interrupted32/12 immutable, no model calls',
      suite: 'boundary-v1',
      variants: ['baseline', 'reference', 'partial', 'alternative'],
      lanes,
      expectedTrials: 32,
      nativeExpected: 'reference/alternative pass; baseline/partial fail',
      browserFailures: 'Retain all originating failures; native success cannot rescue them',
    },
    null,
    2,
  ),
);
console.log(`STATE_COLLECTION_CONTROLS_ROOT ${root}`);
for (const control of ['baseline', 'reference', 'partial', 'alternative'] as const) {
  const report = await run(config, tasks, [...lanes], join(root, control), control);
  assert.equal(report.runs.length, 8);
  for (const row of report.runs) {
    if (row.lane === 'local-reference' || row.lane === 'native-codex') {
      assert.equal(
        row.judge.pass,
        control === 'reference' || control === 'alternative',
        `${control}/${row.task}/${row.lane}: ${row.error ?? JSON.stringify(row.judge)}`,
      );
    }
    assert.equal(row.agentStatus, 'not-run');
  }
}
