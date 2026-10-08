import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v9');
const book = corpus.find((task) => task.family === 'booking-constraints')!;
const expense = corpus.find((task) => task.family === 'expense-conservation')!;
const tasks: Task[] = [];
function variant(task: Task, name: string, file: string, transform: (text: string) => string) {
  const patch: FileTree = { ...task.controls!.reference! };
  const original = patch[file]!;
  patch[file] = transform(original);
  if (name !== 'original') assert.notEqual(patch[file], original);
  tasks.push({
    ...task,
    id: `${task.id}-${name}`,
    controls: { ...task.controls, reference: patch },
  });
}
variant(book, 'original', 'src/App.vue', (text) => text);
variant(book, 'cancel-edit', 'src/App.vue', (text) =>
  text.replace(
    '<button @click="saveRoom">Save room</button>',
    '<button @click="saveRoom">Save room</button><button v-if="roomForm.id" @click="Object.assign(roomForm, { id: \'\', name: \'\', capacity: \'\' })">Cancel room edit</button>',
  ),
);
variant(book, 'contextual-actions', 'src/App.vue', (text) =>
  text
    .replace('Edit room {{row.name}}', 'Edit {{row.name}}')
    .replace('Delete room {{row.name}}', 'Delete {{row.name}}'),
);
variant(expense, 'original', 'src/App.svelte', (text) => text);
variant(expense, 'contextual-actions', 'src/App.svelte', (text) =>
  text
    .replace('Edit expense {row.description}', 'Edit {row.description}')
    .replace('Delete expense {row.description}', 'Delete {row.description}'),
);
const root = await mkdtemp(join(tmpdir(), 'rifty-operation-context-regression-'));
const report = await run(config, tasks, ['local-reference'], join(root, 'series'), 'reference');
console.log(
  JSON.stringify({
    root,
    results: report.runs.map((trial) => ({ task: trial.task, outcome: trial.outcome })),
  }),
);
assert.equal(report.runs.length, 5);
for (const trial of report.runs) {
  assert.equal(trial.agentStatus, 'not-run');
  assert.ok(trial.judge.probes.length > 0);
  assert.equal(
    trial.judge.pass,
    true,
    JSON.stringify({
      root,
      task: trial.task,
      failed: trial.judge.probes.filter((probe) => !probe.pass),
    }),
  );
  assert.equal(trial.outcome, 'pass');
}
console.log('PASS: real Vue/Svelte operation contexts; no models');
