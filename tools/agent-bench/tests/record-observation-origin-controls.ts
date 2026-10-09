import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v15');
const tasks: Task[] = [];
const expectations: Record<string, boolean> = {};
for (const family of ['booking-constraints', 'expense-conservation']) {
  const original = corpus.find((task) => task.family === family)!;
  for (const [name, pass, patch] of [
    ['reference', true, original.controls!.reference!],
    ['alternative', true, original.controls!.alternative!],
    ['baseline', false, {}],
    ['partial', false, original.controls!.partial!],
  ] as const) {
    const id = `${original.id}-observation-${name}`;
    tasks.push({ ...original, id, controls: { ...original.controls, reference: patch } });
    expectations[id] = pass;
  }
  const path = family === 'booking-constraints' ? 'src/App.vue' : 'src/App.svelte';
  const before =
    family === 'booking-constraints' ? 'Edit room {{row.name}}' : 'Edit expense {row.description}';
  const after =
    family === 'booking-constraints'
      ? 'Edit room details for {{row.name}}'
      : 'Edit expense details for {row.description}';
  const patch = { ...original.controls!.reference! };
  assert.equal(patch[path]!.split(before).length, 2);
  patch[path] = patch[path]!.replace(before, after);
  const id = `${original.id}-observation-qualified`;
  tasks.push({ ...original, id, controls: { ...original.controls, reference: patch } });
  expectations[id] = true;
}
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const root = await mkdtemp(join(resolve('.cache/pr341'), 'record-observation-origins-'));
const plan = await resolvePlan(config, tasks, lanes);
await writeFile(
  join(root, 'declaration.json'),
  JSON.stringify(
    {
      purpose:
        'Current persisted-observation controls in each own origin; no model or quality campaign',
      expectations,
      bootstrapCandidates: tasks
        .filter((task) => task.family === 'expense-conservation' && expectations[task.id])
        .map((task) => ({ task: task.id, lane: 'rifty' })),
      bootstrapEvidence:
        'Retain exact pre-existing Svelte style-import CORS failure as own-host FAIL; semantic proof not reached; no native rescue',
      plan,
    },
    null,
    2,
  ),
);
console.log(`RECORD_OBSERVATION_ORIGINS_ROOT ${root}`);
const report = await run(config, tasks, lanes, join(root, 'series'), 'reference');
console.log(
  JSON.stringify({
    root,
    results: report.runs.map((trial) => ({
      task: trial.task,
      lane: trial.lane,
      outcome: trial.outcome,
      expectedPass: expectations[trial.task],
      failed: trial.judge.probes.filter((probe) => !probe.pass),
    })),
  }),
);
assert.equal(report.runs.length, 40);
assert.deepEqual(report.header.plan, plan);
const physical = [];
const mismatches = [];
for (const trial of report.runs) {
  assert.equal(trial.agentStatus, 'not-run');
  const task = tasks.find((task) => task.id === trial.task)!;
  const before = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.before!), 'utf8'),
  ) as FileTree;
  const after = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.after!), 'utf8'),
  ) as FileTree;
  assert.deepEqual(after, { ...before, ...task.controls!.reference! });
  const trace = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.trace!), 'utf8'),
  ) as { noModelInvocation?: boolean };
  assert.equal(trace.noModelInvocation, true);
  let bootstrapUnavailable = false;
  if (
    trial.lane === 'rifty' &&
    task.family === 'expense-conservation' &&
    trial.artifacts.browserTrace
  ) {
    const events = execFileSync(
      'unzip',
      ['-p', join(root, 'series', trial.artifacts.browserTrace), '*.trace'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    bootstrapUnavailable = events
      .split('\n')
      .filter(Boolean)
      .some((line) => {
        const event = JSON.parse(line) as { type?: string; messageType?: string; text?: string };
        return (
          event.type === 'console' &&
          event.messageType === 'error' &&
          !!event.text?.includes('http://src/App.svelte?svelte&type=style&lang.css') &&
          event.text.includes('blocked by CORS policy')
        );
      });
  }
  const declaredBootstrapFailure =
    expectations[trial.task] &&
    trial.lane === 'rifty' &&
    task.family === 'expense-conservation' &&
    bootstrapUnavailable &&
    trial.outcome === 'fail' &&
    !trial.judge.pass &&
    trial.judge.probes.length === 1 &&
    /Missing named action/.test(String(trial.judge.probes[0]!.evidence));
  if (
    !declaredBootstrapFailure &&
    (trial.judge.pass !== expectations[trial.task] ||
      trial.outcome !== (expectations[trial.task] ? 'pass' : 'fail'))
  )
    mismatches.push(trial);
  physical.push({
    task: trial.task,
    lane: trial.lane,
    sourceExpectedPass: expectations[trial.task],
    ownOutcome: trial.outcome,
    bootstrapUnavailable,
    semanticProofReached: !bootstrapUnavailable,
    beforeAfterExact: true,
    noModelInvocation: true,
  });
}
await writeFile(
  join(root, 'physical-proof.json'),
  `${JSON.stringify({ retained: report.runs.length, physical, mismatches }, null, 2)}\n`,
);
assert.deepEqual(mismatches, []);
console.log(
  'PASS: physical identity/all four origins/no models; semantic controls discriminate where bootstrap reached; declared bootstrap failures retained',
);
