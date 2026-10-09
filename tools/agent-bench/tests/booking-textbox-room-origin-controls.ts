import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';

const config = await loadConfig('tools/agent-bench/configs/pilot-comparison.json');
config.runsPerTask = 1;
const book = (await loadCorpus('eval-v14')).find((task) => task.family === 'booking-constraints')!;
const file = 'src/App.vue';
const original = book.controls!.reference![file]!;
const picker =
  '<select v-model="booking.room"><option value="">Choose room</option><option v-for="r in state.rooms" :key="r.id" :value="r.id">{{r.name}}</option></select>';
assert.equal(original.split(picker).length, 2);
const source = original.replace(
  picker,
  '<input :value="roomName(booking.room)" @input="booking.room = state.rooms.find(r => r.name === $event.target.value)?.id || \'\'">',
);
const task = {
  ...book,
  id: `${book.id}-textbox-room`,
  controls: { ...book.controls, reference: { ...book.controls!.reference!, [file]: source } },
};
const root = await mkdtemp(join(resolve('.cache/pr341'), 'booking-textbox-room-'));
const report = await run(config, [task], ['local-reference'], join(root, 'series'), 'reference');
const row = report.runs[0]!;
console.log(
  JSON.stringify({
    root,
    outcome: row.outcome,
    failed: row.judge.probes.filter((probe) => !probe.pass),
  }),
);
assert.equal(report.runs.length, 1);
assert.equal(row.agentStatus, 'not-run');
assert.equal(row.outcome, 'pass', JSON.stringify(row.judge));
console.log('PASS: full public booking workflow accepts room textbox and owned relation witness');
