import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { resolvePlan } from '../src/plan.ts';
import type { Run } from '../src/report.ts';
import { run } from '../src/runner.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-workflow-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const tasks = await loadCorpus('eval-v2');
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
const frozen = await resolvePlan(config, tasks, [...lanes]);
await writeFile(join(root, 'frozen-input-plan.json'), JSON.stringify(frozen, null, 2));
const selected = tasks.filter((t) =>
  ['booking-workflow-v2', 'expense-settlement-v2'].includes(t.id),
);
const series: {
  name: string;
  output: string;
  selected: number | undefined;
  runs: Pick<Run, 'task' | 'lane' | 'outcome' | 'stage' | 'error' | 'judge'>[];
}[] = [];
async function controls(name: string, selectedTasks: typeof tasks, variant: string) {
  assert.deepEqual((await resolvePlan(config, tasks, [...lanes])).tasks, frozen.tasks);
  const output = join(root, name);
  const report = await run(config, selectedTasks, [...lanes], output, variant);
  assert.deepEqual((await resolvePlan(config, tasks, [...lanes])).tasks, frozen.tasks);
  assert.equal(report.runs.length, selectedTasks.length * 4);
  assert.equal(report.header.purpose, 'controls');
  assert.equal(report.header.series?.status, 'completed');
  for (const row of report.runs) {
    assert.equal(row.agentStatus, 'not-run');
    const task = selectedTasks.find((t) => t.id === row.task)!;
    if (row.artifacts.before && row.artifacts.after) {
      const before = JSON.parse(await readFile(join(output, row.artifacts.before), 'utf8'));
      const after = JSON.parse(await readFile(join(output, row.artifacts.after), 'utf8'));
      assert.deepEqual(after, { ...before, ...task.controls![variant] });
    }
    // Setup/unsupported failures are retained; reference expectations apply to native.
    if (row.lane === 'local-reference' || row.lane === 'native-codex')
      assert.equal(
        row.judge.pass,
        variant === 'reference' || variant === 'alternative',
        JSON.stringify(row),
      );
    if (variant === 'baseline' || variant === 'partial') assert.equal(row.judge.pass, false);
  }
  series.push({
    name,
    output,
    selected: report.header.plan?.trials.length,
    runs: report.runs.map(({ task, lane, outcome, stage, error, judge }) => ({
      task,
      lane,
      outcome,
      stage,
      error,
      judge,
    })),
  });
  await writeFile(join(root, 'evidence.json'), JSON.stringify(series, null, 2));
}
// Previous six cases unchanged; new judges require the two affected workflows.
await controls('references', selected, 'reference');
for (const variant of ['baseline', 'partial', 'alternative'])
  await controls(variant, selected, variant);
console.log(`WORKFLOW_ORIGIN_ARTIFACTS ${root}`);

for (const task of selected) {
  for (const variant of ['reference', 'alternative']) {
    const patch = { ...task.controls![variant]! };
    const path = task.family === 'booking-constraints' ? 'src/App.vue' : 'src/App.svelte';
    const from =
      task.family === 'booking-constraints' ? '{{r.name}}</option>' : '{person.name}</option>';
    const to =
      task.family === 'booking-constraints'
        ? '{{r.name}} · {{r.capacity}} seats</option>'
        : '{person.name} · participant</option>';
    assert.ok(patch[path]!.includes(from));
    patch[path] = patch[path]!.replaceAll(from, to);
    task.controls![variant] = patch;
  }
}
const decoratedPlan = await resolvePlan(config, tasks, [...lanes]);
await writeFile(join(root, 'decorated-input-plan.json'), JSON.stringify(decoratedPlan, null, 2));
// Each plan binds its own real positive control; no model calls or quality scores.
frozen.tasks = decoratedPlan.tasks;
for (const variant of ['reference', 'alternative'])
  await controls(`decorated-${variant}`, selected, variant);

const booking = selected.filter((task) => task.family === 'booking-constraints');
for (const task of booking)
  for (const variant of ['reference', 'alternative']) {
    const patch = { ...task.controls![variant]! };
    assert.ok(patch['src/App.vue']!.includes('<label>Room name <input'));
    patch['src/App.vue'] = patch['src/App.vue']!.replace(
      '<label>Room name <input',
      '<label>Name of room <input',
    );
    task.controls![variant] = patch;
  }
const reversedNamePlan = await resolvePlan(config, tasks, [...lanes]);
await writeFile(
  join(root, 'reversed-name-input-plan.json'),
  JSON.stringify(reversedNamePlan, null, 2),
);
frozen.tasks = reversedNamePlan.tasks;
for (const variant of ['reference', 'alternative'])
  await controls(`reversed-name-${variant}`, booking, variant);
