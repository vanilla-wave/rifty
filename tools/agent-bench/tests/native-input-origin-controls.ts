import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import {
  type JudgeContext,
  type TaskJudge,
  action,
  actionCaption,
  editableControl,
  fieldValue,
  namedActions,
  selectChoices,
  verdict,
} from '../src/judge/context.ts';
import { fillNativeInput } from '../src/judge/native-input.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';

async function numberSeatsJudge(ctx: JudgeContext, base: TaskJudge) {
  const result = await base(ctx);
  if (!result.pass) return result;
  const probes = [...result.probes];
  const count = () => namedActions(ctx, actionCaption('edit', 'reservation|booking')).count();
  const initial = await count();
  for (const [date, invalid] of [
    ['2030-01-12', false],
    ['2030-01-13', true],
  ] as const) {
    await action(ctx, /New reservation/i).click();
    await selectChoices(editableControl(ctx, /^Reservation room\b/i), ['Amber']);
    await ctx.view.getByLabel('Date', { exact: true }).fill(date);
    await editableControl(ctx, /^Start\b/i).fill('12:00');
    await editableControl(ctx, /^End\b/i).fill('13:00');
    const seats = editableControl(ctx, /^Seats\b/i);
    const type = await seats.getAttribute('type');
    await fillNativeInput(seats, '3');
    if (invalid) await fillNativeInput(seats, 'abc');
    const applied = await fieldValue(seats);
    await action(ctx, /Save reservation/i).click();
    const records = await count();
    const validation = await ctx.view.getByLabel(/Validation/i).innerText();
    probes.push({
      name: invalid
        ? 'native Number unrepresentable request clears actual field and rejects without mutation'
        : 'native Number representable value commits through actual application',
      pass:
        type === 'number' &&
        applied === (invalid ? '' : '3') &&
        records === initial + 1 &&
        (!invalid || validation.trim().length > 0),
      evidence: {
        requested: invalid ? 'abc' : '3',
        applied,
        type,
        records,
        validation,
        scope:
          'directed helper consumer in actual reference Vue programme; not Svelte success/rescue',
      },
    });
  }
  await ctx.view.goto(ctx.view.url());
  probes.push({
    name: 'native Number rejection retains committed application state across reload',
    pass: (await count()) === initial + 1,
    evidence: await count(),
  });
  return verdict(probes);
}

const root = await mkdtemp(join(tmpdir(), 'rifty-native-input-origins-'));
const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const corpus = await loadCorpus('eval-v6');
const variants: {
  name: string;
  expectedPass: boolean;
  patch: FileTree;
  id: string;
  family: string;
}[] = [];
const tasks: Task[] = [];
for (const [index, family, expected] of [
  [2, 'booking-constraints', 10],
  [3, 'expense-conservation', 5],
] as const) {
  const original = corpus.find((task) => task.family === family)!;
  const rows = JSON.parse(await readFile(process.argv[index]!, 'utf8')) as {
    variant: string;
    source: FileTree;
    expectedPass: boolean;
  }[];
  assert.equal(rows.length, expected);
  const controls: { name: string; expectedPass: boolean; patch: FileTree; judge?: TaskJudge }[] = [
    { name: 'baseline', expectedPass: false, patch: {} as FileTree },
    { name: 'partial', expectedPass: false, patch: original.controls!.partial! },
    ...rows.map((row) => ({
      name: row.variant,
      expectedPass: row.expectedPass,
      patch: Object.fromEntries(
        Object.entries(row.source).filter(([path, text]) => original.files[path] !== text),
      ),
    })),
  ];
  if (family === 'booking-constraints') {
    const reference = original.controls!.reference!;
    const app = reference['src/App.vue']!;
    const field = 'v-model="booking.seats"';
    assert.ok(app.includes(field));
    controls.push({
      name: 'native-number-seats-probe',
      expectedPass: true,
      patch: { ...reference, 'src/App.vue': app.replace(field, `type="number" ${field}`) },
      judge: (ctx) => numberSeatsJudge(ctx, original.judge!),
    });
  }
  for (const control of controls) {
    const id = `${original.id}-${control.name}`;
    variants.push({
      name: control.name,
      expectedPass: control.expectedPass,
      patch: control.patch,
      id,
      family,
    });
    tasks.push({
      ...original,
      id,
      ...(control.judge
        ? {
            judge: control.judge,
            judgeFiles: [
              ...original.judgeFiles!,
              'tools/agent-bench/tests/native-input-origin-controls.ts',
            ],
          }
        : {}),
      controls: { ...original.controls, reference: control.patch },
    });
  }
}
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const supplementOnly = process.argv[4] === '--supplement-only';
const selectedTasks = supplementOnly
  ? tasks.filter((task) => task.id.endsWith('native-number-seats-probe'))
  : tasks;
const declaration = {
  purpose: supplementOnly
    ? 'directed native Number consumer, one real Vue programme/four hosts; no quality/model evidence'
    : 'controls only; twenty programmes/two families; no quality/model evidence',
  variants: supplementOnly
    ? variants.filter((variant) => variant.id.endsWith('native-number-seats-probe'))
    : variants,
  unavailableSourcePositiveHosts: ['reference', 'alternative', 'native-number-raw-value'].map(
    (name) => ({
      task: `expense-settlement-v3-${name}`,
      lane: 'rifty',
      reason:
        'independently observed exact style-import CORS/blank-preview bootstrap; actual own-host FAIL retained, Number not reached',
    }),
  ),
  sourceExpectationVsOwnOutcome:
    'Source positives do not manufacture environment success; I6 reference failures retained. Native Number COI exercised separately in actual Vue reference consumer.',
  plan: await resolvePlan(config, selectedTasks, lanes),
};
await writeFile(join(root, 'declared-input-plan.json'), JSON.stringify(declaration, null, 2));
const report = await run(config, selectedTasks, lanes, join(root, 'series'), 'reference');
assert.equal(report.runs.length, supplementOnly ? 4 : 80);
assert.deepEqual(report.header.plan, declaration.plan);
const physical = [];
for (const row of report.runs) {
  const variant = variants.find((variant) => variant.id === row.task)!;
  assert.equal(row.agentStatus, 'not-run');
  let bootstrapUnavailable = false;
  const browserTrace = row.artifacts.browserTrace;
  if (browserTrace && row.lane === 'rifty' && variant.family === 'expense-conservation') {
    const events = execFileSync('unzip', ['-p', join(root, 'series', browserTrace), '*.trace'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
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
      declaration.unavailableSourcePositiveHosts.some(
        (host) => host.task === row.task && host.lane === row.lane,
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
  const trace = JSON.parse(await readFile(join(root, 'series', row.artifacts.trace!), 'utf8'));
  assert.equal(trace.noModelInvocation, true);
  physical.push({
    task: row.task,
    lane: row.lane,
    physicalPatchExact: true,
    noModelInvocation: true,
    sourceExpectedPass: variant.expectedPass,
    ownHostPass: row.judge.pass,
    bootstrapUnavailable,
    semanticProofReached: !bootstrapUnavailable,
  });
}
await writeFile(
  join(root, 'evidence.json'),
  JSON.stringify({ declaration, report, physical }, null, 2),
);
console.log(`NATIVE_INPUT_ORIGIN_ARTIFACTS ${root}`);
