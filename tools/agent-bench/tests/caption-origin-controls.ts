import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';
import { captionReference } from './caption-variants.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-caption-origin-controls-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const apps = (await loadCorpus('pilot-v2')).filter((task) => task.group === 'app');
for (const task of apps) task.controls!.reference = captionReference(task);
const controls = await run(
  config,
  apps,
  ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'],
  join(root, 'captions'),
  'reference',
);
assert.equal(controls.runs.length, 8);
for (const row of controls.runs) {
  assert.equal(row.agentStatus, 'not-run');
  assert.equal(row.judge.pass, true, JSON.stringify(row));
}
if (process.argv[2]) {
  const raw = await readFile(process.argv[2]);
  const files = JSON.parse(
    (process.argv[2].endsWith('.gz') ? gunzipSync(raw) : raw).toString(),
  ) as FileTree;
  const task = apps.find((task) => task.family === 'contact-import')!;
  task.controls!.reference = files;
  const replay = await run(config, [task], ['rifty'], join(root, 'actual-programme2'), 'reference');
  await writeFile(
    join(root, 'actual-source.json'),
    JSON.stringify({ source: process.argv[2], files }, null, 2),
  );
  const row = replay.runs[0]!;
  assert.equal(row.agentStatus, 'not-run');
  assert.equal(row.judge.probes.length, 7, JSON.stringify(row));
  assert(
    row.judge.probes.every((probe) => !String(probe.evidence).includes('locator.')),
    JSON.stringify(row),
  );
  console.log(
    'ACTUAL_PROGRAMME2_REPLAY',
    JSON.stringify({ outcome: row.outcome, probes: row.judge.probes }),
  );
}
console.log(`CAPTION_ORIGIN_ARTIFACTS ${root}`);
