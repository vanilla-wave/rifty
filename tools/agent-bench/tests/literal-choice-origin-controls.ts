import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { selectChoices, selectedChoice, verdict } from '../src/judge/context.ts';
import type { Lane } from '../src/lanes/types.ts';
import { resolvePlan } from '../src/plan.ts';
import { run } from '../src/runner.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const booking = (await loadCorpus('eval-v13')).find(
  (task) => task.family === 'booking-constraints',
)!;
const task = {
  ...booking,
  id: `${booking.id}-literal-choice`,
  judgeFiles: [...booking.judgeFiles!, 'tools/agent-bench/tests/literal-choice-origin-controls.ts'],
  judge: async ({ view }: Parameters<NonNullable<typeof booking.judge>>[0]) => {
    const probes = [];
    for (const name of ['Amber', '(Amber)']) {
      await view.getByRole('textbox', { name: 'Room name', exact: true }).fill(name);
      await view.getByRole('textbox', { name: 'Capacity', exact: true }).fill('2');
      await view.getByRole('button', { name: 'Save room', exact: true }).click();
    }
    const picker = view.getByRole('combobox', { name: 'Reservation room', exact: true });
    for (const [index, name] of ['Amber', '(Amber)'].entries()) {
      await selectChoices(picker, [name]);
      probes.push({
        name: `selected literal room ${name}`,
        pass: (await selectedChoice(picker, ['Amber', '(Amber)'])) === name,
        evidence: await picker.evaluate(
          (node) => (node as HTMLSelectElement).selectedOptions[0]?.label,
        ),
      });
      for (const [field, value] of [
        ['Date', '2030-01-10'],
        ['Start', `${10 + index}:00`],
        ['End', `${11 + index}:00`],
        ['Seats', '1'],
      ])
        await view.getByRole('textbox', { name: field, exact: true }).fill(value!);
      await view.getByRole('button', { name: 'Save reservation', exact: true }).click();
    }
    await view.goto(view.url());
    for (const [index, name] of ['Amber', '(Amber)'].entries()) {
      await view
        .getByRole('button', {
          name: `Edit reservation ${name} 2030-01-10 ${10 + index}:00`,
          exact: true,
        })
        .click();
      const selected = await selectedChoice(picker, ['Amber', '(Amber)']);
      probes.push({
        name: `persisted literal room ${name}`,
        pass: selected === name,
        evidence: selected,
      });
      await view.getByRole('button', { name: 'Save reservation', exact: true }).click();
    }
    return verdict(probes);
  },
};
const lanes: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'];
const root = await mkdtemp(join(resolve('.cache/pr341'), 'literal-choice-origins-'));
const declaration = { lanes, plan: await resolvePlan(config, [task], lanes) };
await writeFile(join(root, 'declaration.json'), `${JSON.stringify(declaration, null, 2)}\n`);
console.log(`LITERAL_CHOICE_ROOT ${root}`);
const report = await run(config, [task], lanes, join(root, 'series'), 'reference');
assert.equal(report.runs.length, 4);
assert.deepEqual(report.header.plan, declaration.plan);
const physical = [];
for (const trial of report.runs) {
  assert.equal(trial.agentStatus, 'not-run');
  assert.equal(trial.outcome, 'pass', JSON.stringify(trial));
  assert.equal(trial.judge.pass, true);
  const before = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.before!), 'utf8'),
  ) as FileTree;
  const after = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.after!), 'utf8'),
  ) as FileTree;
  assert.deepEqual(after, { ...before, ...booking.controls!.reference! });
  const trace = JSON.parse(
    await readFile(join(root, 'series', trial.artifacts.trace!), 'utf8'),
  ) as { noModelInvocation?: boolean };
  assert.equal(trace.noModelInvocation, true);
  physical.push({
    lane: trial.lane,
    pass: true,
    probes: trial.judge.probes,
    beforeAfterExact: true,
    noModelInvocation: true,
  });
}
await writeFile(
  join(root, 'physical-proof.json'),
  `${JSON.stringify({ root, physical }, null, 2)}\n`,
);
console.log(JSON.stringify({ root, physical }));
