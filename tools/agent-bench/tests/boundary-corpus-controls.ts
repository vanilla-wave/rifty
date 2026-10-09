import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const tasks = await loadCorpus('boundary-v1');
const root = await mkdtemp(join(resolve('.cache/pr341'), 'boundary-controls-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5423;
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose: 'Reference admission controls; no model calls; failures retained in origin',
      suite: 'boundary-v1',
      variants: ['baseline', 'reference', 'partial', 'alternative'],
      lanes,
      expectedTrials: 128,
      nativeExpected: 'reference/alternative pass; baseline/partial fail',
      browserFailures: 'Retain and investigate; native pass never rescues own-host failure',
    },
    null,
    2,
  ),
);
console.log(`BOUNDARY_CONTROLS_ROOT ${root}`);
for (const control of ['baseline', 'reference', 'partial', 'alternative'] as const) {
  const report = await run(config, tasks, [...lanes], join(root, control), control);
  assert.equal(report.runs.length, 32);
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
