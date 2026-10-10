import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const corpus = await loadCorpus('boundary-v1');
const cases = [
  { id: 'obs-linked-message', original: 'linked-import-1', expected: true },
  { id: 'obs-linked-bad-position', original: 'linked-import-1', expected: false },
  { id: 'obs-linked-undo-void', original: 'linked-import-2', expected: true },
  { id: 'obs-async-wrapped', original: 'async-search-2', expected: true },
  { id: 'obs-async-handled', original: 'async-search-2', expected: true },
  { id: 'obs-async-lost-query', original: 'async-search-2', expected: false },
];
const tasks = cases.map((variant) => {
  const task = corpus.find((task) => task.id === variant.original)!;
  const patch = { ...task.controls!.reference! };
  const path =
    task.family === 'linked-data-import' ? 'src/workbook.mjs' : 'src/search-controller.mjs';
  const original = patch[path]!;
  if (variant.id.includes('message') || variant.id.includes('bad-position')) {
    const fields =
      'const error=new Error(message);error.line=quoteLine||line;error.column=quoteColumn||column;throw error;';
    patch[path] = original.replace(
      fields,
      variant.expected
        ? 'throw new Error(`${message} (${quoteLine||line}:${quoteColumn||column})`);'
        : 'throw new Error(`${message} (${quoteLine||line}:${(quoteColumn||column)+1})`);',
    );
  } else if (variant.id.endsWith('undo-void')) {
    patch[path] = original.replace(
      'current=history.pop();return true;',
      'current=history.pop();return;',
    );
  } else if (variant.id.endsWith('wrapped')) {
    patch[path] = original.replaceAll(
      'throw error;',
      "throw new Error('Request failed',{cause:error});",
    );
  } else if (variant.id.endsWith('handled')) {
    patch[path] = original.replaceAll('throw error;', 'return;');
  } else {
    patch[path] = original.replace(
      'catch(error){replace(before);',
      'catch(error){current.query=null;replace(before);',
    );
  }
  assert.notEqual(patch[path], original);
  return { ...task, id: variant.id, controls: { reference: patch } };
});
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
config.playgroundPort = 5483;
const root = await mkdtemp(join(resolve('.cache/pr341'), 'observation-carrier-controls-'));
console.log(`OBSERVATION_CARRIER_CONTROLS_ROOT ${root}`);
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose:
        'Actual public diagnostic/failure carriers and effects; no model calls; no source-corpus or historical score substitution',
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
