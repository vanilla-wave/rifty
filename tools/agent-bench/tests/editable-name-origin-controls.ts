import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

const root = await mkdtemp(join(tmpdir(), 'rifty-editable-name-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v7');
const tasks: Task[] = [];
const variants: {
  id: string;
  family: string;
  name: string;
  expectedPass: boolean;
  patch: FileTree;
}[] = [];
function add(task: Task, name: string, expectedPass: boolean, patch: FileTree) {
  const id = `${task.id}-${name}`;
  variants.push({ id, family: task.family!, name, expectedPass, patch });
  tasks.push({ ...task, id, controls: { ...task.controls, reference: patch } });
}
const booking = corpus.find((task) => task.family === 'booking-constraints')!;
const expense = corpus.find((task) => task.family === 'expense-conservation')!;
for (const task of [booking, expense]) {
  add(task, 'reference', true, task.controls!.reference!);
  add(task, 'alternative', true, task.controls!.alternative!);
  add(task, 'baseline', false, {});
  add(task, 'partial', false, task.controls!.partial!);
}
const bookRef = booking.controls!.reference!;
const vue = bookRef['src/App.vue']!;
const bare = vue.replace('<label>Reservation room <select', '<label>Reservation room<select');
assert.notEqual(bare, vue);
add(booking, 'bare-label', true, { ...bookRef, 'src/App.vue': bare });
const nameInput = '<input v-model="roomForm.name">';
assert.ok(vue.includes(nameInput));
add(booking, 'textarea-value-caption', true, {
  ...bookRef,
  'src/App.vue': vue.replace(
    nameInput,
    '<textarea v-model="roomForm.name">Capacity in prose</textarea>',
  ),
});
add(booking, 'labelled-contenteditable', true, {
  ...bookRef,
  'src/App.vue': vue.replace(
    nameInput,
    '<div contenteditable="true" aria-label="Room name" @input="roomForm.name=$event.target.textContent">{{roomForm.name}}</div>',
  ),
});
const expenseRef = expense.controls!.reference!;
const svelte = expenseRef['src/App.svelte']!;
const description = '<input bind:value={description}>';
assert.ok(svelte.includes(description));
add(expense, 'description-textarea', true, {
  ...expenseRef,
  'src/App.svelte': svelte.replace(description, '<textarea bind:value={description}></textarea>'),
});
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
assert.equal(tasks.length, 12);
const declaration = {
  purpose:
    'Editable-name class consumer controls; twelve real programmes/four hosts, no models/quality evidence',
  sourceExpectationVsOwnOutcome:
    'Source-correct expense COI controls may retain exact existing style-import bootstrap failure; no native rescue/score substitution',
  variants,
  bootstrapCandidates: variants
    .filter((v) => v.family === 'expense-conservation' && v.expectedPass)
    .map((v) => ({ task: v.id, lane: 'rifty' })),
  plan: await resolvePlan(config, tasks, lanes),
};
await writeFile(join(root, 'declared-input-plan.json'), JSON.stringify(declaration, null, 2));
console.log(`EDITABLE_NAME_ROOT ${root}`);
const report = await run(config, tasks, lanes, join(root, 'series'), 'reference');
assert.equal(report.runs.length, 48);
assert.deepEqual(report.header.plan, declaration.plan);
const physical = [];
for (const row of report.runs) {
  const variant = variants.find((v) => v.id === row.task)!;
  assert.equal(row.agentStatus, 'not-run');
  let bootstrapUnavailable = false;
  if (
    row.lane === 'rifty' &&
    variant.family === 'expense-conservation' &&
    row.artifacts.browserTrace
  ) {
    const events = execFileSync(
      'unzip',
      ['-p', join(root, 'series', row.artifacts.browserTrace), '*.trace'],
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
  if (variant.expectedPass && !row.judge.pass) {
    assert.ok(
      declaration.bootstrapCandidates.some(
        (candidate) => candidate.task === row.task && candidate.lane === row.lane,
      ),
      JSON.stringify(row),
    );
    assert.equal(bootstrapUnavailable, true, JSON.stringify(row));
    assert.equal(row.judge.probes.length, 1);
    assert.match(String(row.judge.probes[0]!.evidence), /Missing named action/);
  } else assert.equal(row.judge.pass, variant.expectedPass, JSON.stringify(row));
  const before = JSON.parse(
    await readFile(join(root, 'series', row.artifacts.before!), 'utf8'),
  ) as FileTree;
  const after = JSON.parse(
    await readFile(join(root, 'series', row.artifacts.after!), 'utf8'),
  ) as FileTree;
  assert.deepEqual(after, { ...before, ...variant.patch });
  const trace = JSON.parse(await readFile(join(root, 'series', row.artifacts.trace!), 'utf8')) as {
    noModelInvocation?: boolean;
  };
  assert.equal(trace.noModelInvocation, true);
  physical.push({
    task: row.task,
    lane: row.lane,
    sourceExpectedPass: variant.expectedPass,
    ownOutcome: row.outcome,
    semanticProofReached: !bootstrapUnavailable,
    bootstrapUnavailable,
    beforeAfterExact: true,
    noModelInvocation: true,
  });
}
await writeFile(
  join(root, 'physical-proof.json'),
  JSON.stringify({ retained: report.runs.length, physical }, null, 2),
);
console.log(
  JSON.stringify({
    root,
    retained: report.runs.length,
    outcomes: report.runs.reduce<Record<string, number>>((counts, row) => {
      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
      return counts;
    }, {}),
  }),
);
