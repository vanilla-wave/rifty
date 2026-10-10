import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-csv-export-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const apps = (await loadCorpus('pilot-v3')).filter((t) => t.group === 'app');
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
const controls = await run(config, apps, [...lanes], join(root, 'references'), 'reference');
assert.equal(controls.runs.length, 8);
for (const row of controls.runs) assert.equal(row.judge.pass, true, JSON.stringify(row));
const task = apps.find((t) => t.family === 'contact-import')!;
const actual = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/csv-pilot-v2-programme1.json.gz'),
  ).toString(),
) as FileTree;
const variants = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  variant: string;
  source: FileTree;
}[];
const quoted = variants.find((v) => v.variant === 'quoted-header-pre')!.source;
for (const [name, files] of [
  ['actual-programme1', actual],
  ['quoted-header-pre', quoted],
] as const) {
  task.controls!.reference = files;
  const report = await run(config, [task], [...lanes], join(root, name), 'reference');
  assert.equal(report.runs.length, 4);
  for (const row of report.runs) {
    assert.equal(row.agentStatus, 'not-run');
    assert.equal(row.judge.pass, true, JSON.stringify(row));
    assert.deepEqual(
      JSON.parse(await readFile(join(root, name, task.id, row.lane, '1/after.json'), 'utf8')),
      {
        ...JSON.parse(await readFile(join(root, name, task.id, row.lane, '1/before.json'), 'utf8')),
        ...files,
      },
    );
  }
}
console.log(`CSV_EXPORT_ORIGIN_ARTIFACTS ${root}`);
