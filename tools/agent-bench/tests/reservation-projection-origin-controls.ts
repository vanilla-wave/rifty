import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import { reservationDisplay } from '../src/judge/reservation-display.ts';
import { reservationRecords } from '../src/judge/reservation-records.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const parent = resolve('.cache/pr341');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'reservation-projections-'));
const corpus = await loadCorpus('eval-v15');
const browser = await chromium.launch();
const evidence: unknown[] = [];
function replace(source: string, before: string, after: string) {
  assert.ok(source.includes(before), `Missing native fixture seam: ${before}`);
  return source.replace(before, after);
}
async function fixture(
  family: string,
  transform: (source: string) => string,
  probe: (page: Page, url: string) => Promise<unknown>,
  suffix = '',
) {
  const task = corpus.find((entry) => entry.family === family)!;
  const app = family === 'expense-conservation' ? 'src/App.svelte' : 'src/App.vue';
  const directory = join(root, `${family}${suffix}`);
  await writeTree(directory, {
    ...task.files,
    ...task.controls!.reference!,
    [app]: transform(task.controls!.reference![app]!),
  });
  await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], { cwd: directory, timeoutMs: 300000 });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawnLoggedServer(
    join(directory, 'node_modules/.bin/vite'),
    ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: directory, env: process.env, logPath: join(directory, 'server.log'), detached: true },
  );
  const context = await browser.newContext();
  try {
    await waitHttpReady(url, 30000, family);
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const result = await probe(page, url);
    assert.deepEqual(errors, []);
    evidence.push({ family, suffix, pass: true, result, errors });
    console.log(JSON.stringify(evidence.at(-1)));
  } finally {
    await context.close();
    await killProcessGroup(server);
  }
}
try {
  for (const mode of [
    'grouped-date',
    'grouped-room-date',
    'same-core-dates',
    'calendar-literal',
    'flat-month-scalar',
    'dynamic-cancel',
  ]) {
    await fixture(
      'booking-constraints',
      (original) => {
        let source = original;
        source = replace(
          source,
          'function editBooking(row)',
          'function cancelBooking(row) { Object.assign(booking, row, { id: "" }); }\nfunction editBooking(row)',
        );
        source = replace(
          source,
          '<button @click="editBooking(b)">',
          `<button ${mode === 'dynamic-cancel' ? 'v-if="booking.id" ' : ''}@click="cancelBooking(b)">Cancel reservation {{roomName(b.room)}} {{b.date}} {{b.start}} edit</button><button @click="editBooking(b)">`,
        );
        const row =
          '<article v-for="b in displayed" :key="b.id"><p>{{roomName(b.room)}} {{b.date}} {{b.start}}–{{b.end}}; {{b.seats}} seats</p>';
        if (mode === 'grouped-date' || mode === 'same-core-dates') {
          source = replace(
            source,
            row,
            '<section v-for="day in [...new Set(displayed.map(row => row.date))]" :key="day"><h3>{{day}}</h3><article v-for="b in displayed.filter(row => row.date === day)" :key="b.id"><p>{{roomName(b.room)}} {{b.start}}–{{b.end}}; {{b.seats}} seats</p>',
          );
          source = replace(source, '</article></section>', '</article></section></section>');
        } else if (mode === 'grouped-room-date' || mode === 'calendar-literal') {
          source = replace(
            source,
            row,
            '<section v-for="r in state.rooms" :key="r.id"><h3>{{r.name}}</h3><section v-for="day in [...new Set(displayed.filter(row => row.room === r.id).map(row => row.date))]" :key="day"><h4>{{day.split("-").reverse().join("/")}}</h4><article v-for="b in displayed.filter(row => row.date === day && row.room === r.id)" :key="b.id"><p>{{b.start}}–{{b.end}}; <span>{{b.seats}}</span> seats</p>',
          );
          source = replace(
            source,
            '</article></section>',
            '</article></section></section></section>',
          );
        } else if (mode === 'flat-month-scalar')
          source = replace(
            source,
            '{{b.date}}',
            '{{b.date.split("-").map(Number).reverse().join("/")}}',
          );
        return source;
      },
      async (page, url) => {
        const ctx = { view: page, previewUrl: url };
        const field = (name: string) =>
          name === 'Reservation room'
            ? page.getByRole('combobox', { name: /^Reservation room/ })
            : page.getByLabel(name, { exact: true });
        const button = (name: string) => page.getByRole('button', { name, exact: true });
        const room =
          mode === 'calendar-literal' ? '2030-01-10' : mode === 'grouped-room-date' ? '1' : 'Bay';
        const records = [
          { room, date: '2030-01-10', start: '09:00', end: '10:00', seats: 1 },
          { room, date: '2030-01-10', start: '10:00', end: '10:01', seats: 1 },
          {
            room,
            date: mode === 'same-core-dates' ? '2030-01-11' : '2030-01-10',
            start: mode === 'same-core-dates' ? '10:00' : '10:01',
            end: mode === 'same-core-dates' ? '10:01' : '11:00',
            seats: 1,
          },
        ];
        await page.goto(url);
        await page.getByRole('heading', { name: 'Room reservations', exact: true }).waitFor();
        await field('Room name').fill(room);
        await field('Capacity').fill('1');
        await button('Save room').click();
        const write = async (value: (typeof records)[number]) => {
          await field('Reservation room').selectOption({ label: value.room });
          for (const key of ['date', 'start', 'end', 'seats'] as const)
            await field(key[0]!.toUpperCase() + key.slice(1)).fill(String(value[key]));
        };
        for (const record of records) {
          await button('New reservation').click();
          await write(record);
          await button('Save reservation').click();
        }
        await page.reload();
        const before = await page.evaluate(() => localStorage.getItem('booking-workflow-v1'));
        const observed = await reservationRecords(ctx, {
          async load(action) {
            await action.click();
            const selected = await field('Reservation room').locator('option:checked').innerText();
            return {
              room: selected === 'Choose room' ? '' : selected,
              date: await field('Date').inputValue(),
              start: await field('Start').inputValue(),
              end: await field('End').inputValue(),
              seats: Number(await field('Seats').inputValue()),
            };
          },
          write,
          save: async () => {
            await button('Save reservation').click();
          },
          reload: async () => {
            await page.reload();
          },
          display: async (value, known) => (await reservationDisplay(ctx, value, known)).present,
        });
        assert.deepEqual(observed, records);
        await page.reload();
        assert.equal(
          await page.evaluate(() => localStorage.getItem('booking-workflow-v1')),
          before,
        );
        if (mode === 'calendar-literal')
          assert.equal(
            (await reservationDisplay(ctx, { ...records[1]!, room: '10/01/2030' }, records))
              .present,
            false,
          );
        return { mode, observed, cancelRetainsFieldsAndClearsId: true, savedBytesExact: true };
      },
      `-${mode}`,
    );
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'proof.json'), `${JSON.stringify({ root, evidence }, null, 2)}\n`);
  console.log(`RESERVATION_PROJECTION_ROOT ${root}`);
}
