import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';
const original = (await loadCorpus('boundary-v1')).find((task) => task.id === 'linked-import-1')!;
const tasks = ['reference', 'build-broken', 'boot-broken'].map((fault) => ({
  ...original,
  id: `starter-${fault}`,
  commandJudge: Object.assign(
    { ...original.commandJudge! },
    {
      starterRegression: {
        buildCommand: 'npm run build',
        heading: 'Minimal JavaScript starter',
      },
    },
  ),
  controls: {
    reference: {
      ...original.controls!.reference!,
      ...(fault === 'reference'
        ? {}
        : {
            'src/main.js':
              fault === 'build-broken'
                ? 'const = ;\n'
                : "throw new Error('Broken starter boot');\n",
          }),
    },
  },
}));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5453;
const root = await mkdtemp(join(resolve('.cache/pr341'), 'starter-regression-controls-'));
console.log(`STARTER_REGRESSION_CONTROLS_ROOT ${root}`);
const lanes =
  process.argv[2] === 'native'
    ? (['local-reference'] as const)
    : (['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const);
const report = await run(config, tasks, [...lanes], join(root, 'series'), 'reference');
await writeFile(
  join(root, 'expected.json'),
  JSON.stringify(
    {
      source: 'Published existing build/boot preserved',
      expected: {
        'starter-reference': true,
        'starter-build-broken': false,
        'starter-boot-broken': false,
      },
      noModels: true,
    },
    null,
    2,
  ),
);
for (const row of report.runs) {
  assert.equal(row.judge.pass, row.task === 'starter-reference', JSON.stringify(row));
  assert.equal(row.agentStatus, 'not-run');
}
