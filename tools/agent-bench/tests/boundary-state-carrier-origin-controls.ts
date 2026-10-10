import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const corpus = await loadCorpus('boundary-v1');
const variants = [
  {
    name: 'selection-set',
    expected: true,
    replacement: 'state:()=>({...clone(current),selectedIds:new Set(current.selectedIds)}),',
  },
  {
    name: 'selection-missing',
    expected: false,
    replacement: 'state:()=>({...clone(current),selectedIds:new Set()}),',
  },
  {
    name: 'items-set',
    expected: true,
    replacement: 'state:()=>({...clone(current),items:new Set(current.items)}),',
  },
  {
    name: 'items-reverse',
    expected: false,
    replacement: 'state:()=>({...clone(current),items:[...current.items].reverse()}),',
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
const root = await mkdtemp(join(resolve('.cache/pr341'), 'state-carrier-controls-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5551;
console.log(`STATE_CARRIER_CONTROLS_ROOT ${root}`);
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose:
        'Actual published selection/ordered-row carriers and invalid effects; no model calls, historical rescue or source-result rebinding',
      cases,
      effectivePatches: Object.fromEntries(tasks.map((task) => [task.id, task.controls.reference])),
      selected: 32,
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
assert.equal(report.runs.length, 32);
for (const row of report.runs) {
  assert.equal(
    row.judge.pass,
    cases.find((variant) => variant.id === row.task)!.expected,
    JSON.stringify(row),
  );
  assert.equal(row.agentStatus, 'not-run');
}
