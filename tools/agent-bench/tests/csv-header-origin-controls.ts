import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-csv-header-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const task = (await loadCorpus('pilot-v3')).find((t) => t.family === 'contact-import')!;
const variants = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
  variant: string;
  source: FileTree;
}[];
for (const name of ['titlecase-header', 'semantic-header']) {
  const files = variants.find((v) => v.variant === name)!.source;
  task.controls!.reference = files;
  const report = await run(
    config,
    [task],
    ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'],
    join(root, name),
    'reference',
  );
  assert.equal(report.runs.length, 4);
  for (const row of report.runs) {
    assert.equal(row.agentStatus, 'not-run');
    assert.equal(row.judge.pass, true, JSON.stringify(row));
    const dir = join(root, name, task.id, row.lane, '1');
    const before = JSON.parse(await readFile(join(dir, 'before.json'), 'utf8')) as FileTree;
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'after.json'), 'utf8')), {
      ...before,
      ...files,
    });
  }
}
console.log(`CSV_HEADER_ORIGIN_ARTIFACTS ${root}`);
