import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const task = (await loadCorpus(process.argv[2] ?? 'eval-v6')).find(
  (t) => t.family === 'booking-constraints',
)!;
const root = await mkdtemp(join(tmpdir(), 'rifty-booking-native-calendar-controls-'));
const reference = task.controls!.reference!;
const source = reference['src/App.vue']!;
function nativeFields(date: boolean, time: boolean): FileTree {
  let text = source;
  if (date) text = text.replace('v-model="booking.date"', 'type="date" v-model="booking.date"');
  if (time)
    text = text
      .replace('v-model="booking.start"', 'type="time" v-model="booking.start"')
      .replace('v-model="booking.end"', 'type="time" v-model="booking.end"');
  return { ...reference, 'src/App.vue': text };
}
const both = nativeFields(true, true);
const native = both['src/App.vue']!;
function defect(from: string, to: string): FileTree {
  assert.ok(native.includes(from), from);
  return { ...both, 'src/App.vue': native.replace(from, to) };
}
const captured = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/booking-native-calendar-programme.json.gz'),
  ).toString(),
) as FileTree;
const variants = [
  { name: 'captured-missing-native-form-validation', files: captured, pass: false },
  { name: 'reference', files: reference, pass: true },
  {
    name: 'reservation-room-name-caption',
    files: {
      ...reference,
      'src/App.vue': source.replace('<label>Reservation room ', '<label>Reservation room name '),
    },
    pass: true,
  },
  { name: 'alternative', files: task.controls!.alternative!, pass: true },
  { name: 'native-date', files: nativeFields(true, false), pass: true },
  { name: 'native-time', files: nativeFields(false, true), pass: true },
  { name: 'native-date-time', files: both, pass: true },
  {
    name: 'accepts-empty-native-date',
    files: defect('!validDate(row.date)', 'false'),
    pass: false,
  },
  { name: 'accepts-invalid-interval', files: defect('row.start >= row.end', 'false'), pass: false },
  {
    name: 'missing-overlap-validation',
    files: defect('message.value = text;', "message.value = '';"),
    pass: false,
  },
];
await mkdir(root, { recursive: true });
await writeTree(root, task.files);
await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, timeoutMs: 300000 });
const browser = await chromium.launch();
const evidence = [];
try {
  for (const variant of variants.filter((v) => !process.argv[3] || v.name === process.argv[3])) {
    await writeTree(root, { ...task.files, ...variant.files });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const server = spawnLoggedServer(
      join(root, 'node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: root, env: process.env, logPath: join(root, 'server.log'), detached: true },
    );
    const context = await browser.newContext();
    try {
      await waitHttpReady(url, 30000, 'Booking native calendar control');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      const result = await task.judge!({ view: page, previewUrl: url });
      evidence.push({
        variant: variant.name,
        expectedPass: variant.pass,
        result,
        errors,
        source: variant.files,
      });
      console.log(
        JSON.stringify({ variant: variant.name, expectedPass: variant.pass, result, errors }),
      );
    } finally {
      await context.close();
      await killProcessGroup(server);
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`BOOKING_NATIVE_CALENDAR_ARTIFACTS ${root}`);
}
for (const row of evidence) {
  assert.equal(row.result.pass, row.expectedPass, row.variant);
  assert.deepEqual(row.errors, [], row.variant);
}
