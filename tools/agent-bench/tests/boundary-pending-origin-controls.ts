import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const corpus = await loadCorpus('boundary-v1');
const variants = [
  {
    name: 'pending-count-zero',
    expected: true,
    replacement: 'state:()=>({...clone(current),pending:Number(current.pending)}),',
  },
  {
    name: 'pending-count-busy',
    expected: false,
    replacement: 'state:()=>({...clone(current),pending:1}),',
  },
  {
    name: 'pending-missing',
    expected: false,
    replacement: 'state:()=>({...clone(current),pending:undefined}),',
  },
];
const cases = [1, 2].flatMap((level) =>
  variants.map((variant) => ({
    ...variant,
    id: `${variant.name}-${level}`,
    original: `async-search-${level}`,
  })),
);
const tasks = cases.map((variant) => {
  const task = corpus.find((task) => task.id === variant.original)!;
  const patch = { ...task.controls!.reference! };
  const original = patch['src/search-controller.mjs']!;
  const owner = 'state:()=>clone(current),';
  assert.ok(original.includes(owner));
  patch['src/search-controller.mjs'] = original.replace(owner, variant.replacement);
  return { ...task, id: variant.id, controls: { reference: patch } };
});
const root = await mkdtemp(join(resolve('.cache/pr341'), 'pending-carrier-controls-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5571;
console.log(`PENDING_CARRIER_CONTROLS_ROOT ${root}`);
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose:
        'Actual published pending inactivity/count and invalid busy/missing states; no model calls, historical rescue or source-result rebinding',
      cases,
      effectivePatches: Object.fromEntries(tasks.map((task) => [task.id, task.controls.reference])),
      selected: 24,
    },
    null,
    2,
  ),
);
const report = await run(
  config,
  tasks,
  ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'],
  join(root, 'series'),
  'reference',
);
assert.equal(report.runs.length, 24);
for (const row of report.runs) {
  assert.equal(
    row.judge.pass,
    cases.find((variant) => variant.id === row.task)!.expected,
    JSON.stringify(row),
  );
  assert.equal(row.agentStatus, 'not-run');
}
