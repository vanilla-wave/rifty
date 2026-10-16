import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v10');
const booking = corpus.find((task) => task.family === 'booking-constraints')!;
const marker = '<button @click="saveRoom">Save room</button>';
const original = booking.controls!.reference!;
assert.equal(original['src/App.vue']!.split(marker).length, 2);
const discard = {
  ...original,
  'src/App.vue': original['src/App.vue']!.replace(
    marker,
    `${marker}<button v-if="roomForm.id" @click="Object.assign(roomForm, { id: '', name: '', capacity: '' })">Discard room edit</button>`,
  ),
};
const variants = [
  { name: 'original', patch: original },
  { name: 'discard', patch: discard },
];
const tasks = variants.map(({ name, patch }) => ({
  ...booking,
  id: `${booking.id}-${name}`,
  controls: { ...booking.controls, reference: patch },
}));
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const root = await mkdtemp(join(resolve('test-results/pr341'), 'record-identity-origins-'));
const declaration = { variants, lanes, plan: await resolvePlan(config, tasks, lanes) };
await writeFile(join(root, 'declaration.json'), JSON.stringify(declaration, null, 2));
console.log(`RECORD_IDENTITY_ROOT ${root}`);
const report = await run(config, tasks, lanes, join(root, 'series'), 'reference');
assert.equal(report.runs.length, 8);
assert.deepEqual(report.header.plan, declaration.plan);
const physical = [];
for (const trial of report.runs) {
  const variant = variants.find(({ name }) => trial.task === `${booking.id}-${name}`)!;
  assert.equal(trial.agentStatus, 'not-run');
  assert.equal(trial.outcome, 'pass', JSON.stringify(trial));
  assert.equal(trial.judge.pass, true);
  const before = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.before!), 'utf8'),
  ) as FileTree;
  const after = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.after!), 'utf8'),
  ) as FileTree;
  assert.deepEqual(after, { ...before, ...variant.patch });
  const trace = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.trace!), 'utf8'),
  ) as { noModelInvocation?: boolean };
  assert.equal(trace.noModelInvocation, true);
  physical.push({
    task: trial.task,
    lane: trial.lane,
    ownOutcome: trial.outcome,
    beforeAfterExact: true,
    noModelInvocation: true,
    probes: trial.judge.probes.length,
  });
}
await writeFile(
  join(root, 'physical-proof.json'),
  JSON.stringify({ retained: 8, physical }, null, 2),
);
console.log(JSON.stringify({ root, retained: 8, physical }));
