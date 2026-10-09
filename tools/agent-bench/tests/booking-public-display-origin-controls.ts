import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const book = (await loadCorpus('eval-v15')).find((task) => task.family === 'booking-constraints')!;
const file = 'src/App.vue';
const original = book.controls!.reference![file]!;
const formatted = original.replace('{{b.date}}', '{{b.date.split("-").reverse().join("/")}}');
const unsorted = original.replace(
  'a.date.localeCompare(b.date) || a.start.localeCompare(b.start)',
  'b.date.localeCompare(a.date) || b.start.localeCompare(a.start)',
);
assert.notEqual(formatted, original);
assert.notEqual(unsorted, original);
const tasks: Task[] = [
  ['formatted', formatted],
  ['unsorted', unsorted],
].map(([name, source]) => ({
  ...book,
  id: `${book.id}-public-display-${name}`,
  controls: { ...book.controls, reference: { ...book.controls!.reference!, [file]: source! } },
}));
const root = await mkdtemp(join(resolve('.cache/pr341'), 'booking-public-display-'));
const report = await run(config, tasks, ['local-reference'], join(root, 'series'), 'reference');
console.log(
  JSON.stringify({
    root,
    results: report.runs.map((trial) => ({
      task: trial.task,
      outcome: trial.outcome,
      failed: trial.judge.probes.filter((probe) => !probe.pass),
    })),
  }),
);
assert.equal(report.runs.length, 2);
for (const trial of report.runs) assert.equal(trial.agentStatus, 'not-run');
const positive = report.runs[0]!;
const negative = report.runs[1]!;
assert.equal(positive.outcome, 'pass', JSON.stringify(positive.judge));
assert.equal(negative.outcome, 'fail');
assert.ok(
  negative.judge.probes.some((probe) => String(probe.evidence).includes('not chronological')),
  'Unsorted public output must fail its actual chronology requirement',
);
console.log(
  'PASS: date display format open; public unsorted output rejected independently of actions',
);
