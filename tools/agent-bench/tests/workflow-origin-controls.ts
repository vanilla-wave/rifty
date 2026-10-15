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
const tasks = await loadCorpus('eval-v1');
const lanes = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'] as const;
const frozen = await resolvePlan(config, tasks, [...lanes]);
await writeFile(join(root, 'frozen-input-plan.json'), JSON.stringify(frozen, null, 2));
const selected = tasks.filter((t) => ['booking-workflow', 'expense-settlement'].includes(t.id));
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
await controls('references', tasks, 'reference');
for (const variant of ['baseline', 'reference', 'partial', 'alternative'])
  await controls(variant, selected, variant);
console.log(`WORKFLOW_ORIGIN_ARTIFACTS ${root}`);
