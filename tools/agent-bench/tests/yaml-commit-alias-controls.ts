import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v8');
const tasks: Task[] = [];
for (const [family, path, marker, suffix] of [
  [
    'booking-constraints',
    'src/App.vue',
    '<button @click="saveRoom">Save room</button>',
    'yaml-alias-room-commit',
  ],
  [
    'booking-constraints',
    'src/App.vue',
    '<button @click="saveBooking">Save reservation</button>',
    'yaml-alias-reservation-commit',
  ],
  [
    'expense-conservation',
    'src/App.svelte',
    '<button onclick={saveExpense}>Save expense</button>',
    'yaml-alias-expense-commit',
  ],
] as const) {
  const task = corpus.find((item) => item.family === family)!;
  const patch = { ...task.controls!.reference! };
  assert.equal(patch[path]!.split(marker).length, 2);
  // Both affordances use the actual existing validation/commit owner.
  patch[path] = patch[path]!.replace(
    marker,
    marker.replace('</button>', ': commit</button>') +
      marker.replace('>Save ', '>Update ').replace('</button>', ': commit</button>'),
  );
  tasks.push({
    ...task,
    id: `${task.id}-${suffix}`,
    controls: { ...task.controls, reference: patch },
  });
}
const root = await mkdtemp(join(tmpdir(), 'rifty-yaml-alias-commit-controls-'));
console.log(`YAML_COMMIT_ALIAS_ROOT ${root}`);
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
console.log(
  'PASS: YAML quoted Save/Update room/reservation/expense commit aliases preserve real domain owners; no models',
);
