import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

// Actual pinned programmes: opener/reset changes, domain commit/validation unchanged.
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v8');
const tasks: Task[] = [];
for (const [family, path, before, after, suffix] of [
  [
    'booking-constraints',
    'src/App.vue',
    '<label>Room name <input',
    "<button @click=\"Object.assign(roomForm, { id: '', name: '', capacity: '' })\">Add room</button><label>Room name <input",
    'room-opener',
  ],
  [
    'booking-constraints',
    'src/App.vue',
    '>New reservation</button>',
    '>Add reservation</button>',
    'reservation-opener',
  ],
  [
    'expense-conservation',
    'src/App.svelte',
    '>New expense</button>',
    '>Add expense</button>',
    'expense-opener',
  ],
] as const) {
  const task = corpus.find((item) => item.family === family)!;
  const patch = { ...task.controls!.reference! };
  const source = patch[path]!;
  assert.equal(source.split(before).length, 2);
  patch[path] = source.replace(before, after);
  tasks.push({
    ...task,
    id: `${task.id}-${suffix}`,
    controls: { ...task.controls, reference: patch },
  });
}
const root = await mkdtemp(join(tmpdir(), 'rifty-creation-opener-controls-'));
console.log(`CREATION_OPENER_ROOT ${root}`);
const report = await run(config, tasks, ['local-reference'], join(root, 'series'), 'reference');
assert.equal(report.runs.length, 3);
for (const trial of report.runs) {
  assert.equal(trial.agentStatus, 'not-run');
  assert.equal(
    trial.judge.pass,
    true,
    JSON.stringify({
      root,
      task: trial.task,
      failed: trial.judge.probes.filter((probe) => !probe.pass),
    }),
  );
}
console.log('PASS: pinned room/reservation/expense Add openers preserve Save commits; no models');
