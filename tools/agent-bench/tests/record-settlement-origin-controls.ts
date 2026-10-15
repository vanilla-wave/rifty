import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import { expenseRecords } from '../src/judge/expense-records.ts';
import { recordObservationError } from '../src/judge/record-observation.ts';
import { withRecordObservation } from '../src/judge/record-observation.ts';
import { reservationDisplay } from '../src/judge/reservation-display.ts';
import { createRoomRelation, reservationRecords } from '../src/judge/reservation-records.ts';
import type {
  ReservationRecord,
  ReservationRecordControls,
} from '../src/judge/reservation-records.ts';
import { roomRecords } from '../src/judge/room-records.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const parent = resolve('.cache/pr341');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'record-settlement-'));
const corpus = await loadCorpus('eval-v16');
const browser = await chromium.launch();
const rows: {
  mode: string;
  normalReturn: boolean;
  restored: boolean;
  error: string | null;
  records: unknown;
  before: string | null;
  after: string | null;
}[] = [];
const modes = [
  'expense-reference',
  'expense-zero-share-reference',
  'expense-noeffect-participants-zero-share',
  'expense-partial-apply',
  'expense-partial-restore',
  'expense-partial-payer',
  'expense-partial-participants',
  'expense-partial-participants-zero-share',
  'room-reference',
  'room-textbox-reference',
  'room-textbox-partial-apply',
  'room-partial-restore',
  'room-partial-apply',
  'reservation-reference',
  'reservation-peer-drop',
  'relation-reference',
  'relation-peer-drop',
];
function replace(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, `Fault seam: ${before}`);
  return source.replace(before, after);
}
try {
  for (const mode of modes) {
    const expense = mode.startsWith('expense');
    const task = corpus.find(
      (entry) => entry.family === (expense ? 'expense-conservation' : 'booking-constraints'),
    )!;
    const textbox = mode.includes('textbox');
    const file = expense ? 'src/App.svelte' : 'src/App.vue';
    let source = task.controls!.reference![file]!;
    if (textbox)
      source = replace(
        source,
        '<select v-model="booking.room"><option value="">Choose room</option><option v-for="r in state.rooms" :key="r.id" :value="r.id">{{r.name}}</option></select>',
        '<input :value="roomName(booking.room)" @input="booking.room = state.rooms.find(r => r.name === $event.target.value)?.id || \'\'">',
      );
    if (mode === 'expense-noeffect-participants-zero-share')
      source = replace(
        source,
        'description: description.trim(), payer, cents, participants: selected',
        'description: editId ? state.expenses.find(e => e.id === editId).description : description.trim(), payer, cents: editId ? state.expenses.find(e => e.id === editId).cents : cents, participants: editId ? state.people.map(p => p.id) : selected',
      );
    if (mode === 'expense-partial-apply')
      source = replace(
        source,
        'description: description.trim(), payer, cents, participants: selected',
        'description: description.trim(), payer, cents: editId ? state.expenses.find(e => e.id === editId).cents : cents, participants: selected',
      );
    if (mode === 'expense-partial-restore')
      source = replace(
        source,
        'description: description.trim(), payer, cents, participants: selected',
        "description: editId && state.expenses.find(e => e.id === editId).description.startsWith('Rifty observation ') ? state.expenses.find(e => e.id === editId).description : description.trim(), payer, cents, participants: selected",
      );
    if (mode === 'expense-partial-payer')
      source = replace(
        source,
        'payer, cents, participants: selected',
        'payer: editId ? state.people[0].id : payer, cents, participants: selected',
      );
    if (mode.startsWith('expense-partial-participants'))
      source = replace(
        source,
        'participants: selected };',
        'participants: editId ? state.people.map(p => p.id) : selected };',
      );
    if (mode === 'room-partial-restore')
      source = replace(
        source,
        'name, capacity };',
        'name, capacity: roomForm.id ? capacity + 1 : capacity };',
      );
    if (mode === 'reservation-peer-drop')
      source = replace(
        source,
        'booking.id ? state.value.bookings.map(b => b.id === row.id ? row : b)',
        'booking.id ? [row]',
      );
    if (mode === 'room-partial-apply' || mode === 'room-textbox-partial-apply')
      source = replace(
        source,
        'name, capacity };',
        'name: roomForm.id ? state.value.rooms.find(r => r.id === roomForm.id).name : name, capacity: roomForm.id ? capacity + 1 : capacity };',
      );
    if (mode === 'relation-peer-drop')
      source = replace(
        source,
        ': [...state.value.bookings, row] });',
        ': row.date >= "2090-01-01" ? [row] : [...state.value.bookings, row] });',
      );
    const directory = join(root, mode);
    await writeTree(directory, { ...task.files, ...task.controls!.reference!, [file]: source });
    await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: directory,
      timeoutMs: 300000,
    });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const server = spawnLoggedServer(
      join(directory, 'node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: directory, env: process.env, logPath: join(directory, 'server.log'), detached: true },
    );
    const context = await browser.newContext();
    try {
      await waitHttpReady(url, 30000, mode);
      const page = await context.newPage();
      page.setDefaultTimeout(4000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      const field = (name: string) =>
        expense
          ? page.getByRole('textbox', { name, exact: true })
          : name === 'Reservation room'
            ? textbox
              ? page.getByLabel('Reservation room', { exact: true })
              : page.getByRole('combobox', { name: /^Reservation room/ })
            : page.getByLabel(name, { exact: true });
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      const state = () =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          expense ? 'expense-settlement-v1' : 'booking-workflow-v1',
        );
      const ctx = { view: page, previewUrl: url };
      await page.goto(url);
      await page
        .getByRole('heading', {
          name: expense ? 'Shared expenses' : 'Room reservations',
          exact: true,
        })
        .waitFor();
      const bookings: ReservationRecord[] = [
        { room: 'Bay', date: '2030-01-10', start: '09:00', end: '10:00', seats: 1 },
        { room: 'Bay', date: '2030-01-10', start: '10:00', end: '11:00', seats: 1 },
      ];
      const writeBooking = async (value: ReservationRecord) => {
        if (textbox) await field('Reservation room').fill(value.room);
        else await field('Reservation room').selectOption({ label: value.room });
        for (const key of ['date', 'start', 'end', 'seats'] as const)
          await field(key[0]!.toUpperCase() + key.slice(1)).fill(String(value[key]));
      };
      if (expense) {
        await field('Person name').fill('Zed');
        await button('Add person').click();
        await field('Person name').fill('Ada');
        await button('Add person').click();
        await field('Expense description').fill('Original');
        await page
          .getByRole('combobox', { name: 'Payer', exact: true })
          .selectOption({ label: mode === 'expense-partial-payer' ? 'Ada' : 'Zed' });
        await field('Amount').fill(mode.includes('zero-share') ? '0.01' : '1.00');
        await page.getByRole('checkbox', { name: 'Zed', exact: true }).check();
        await button('Save expense').click();
      } else {
        await field('Room name').fill('Bay');
        await field('Capacity').fill('2');
        await button('Save room').click();
        if (mode.startsWith('reservation') || mode.startsWith('relation'))
          for (const booking of bookings) {
            await button('New reservation').click();
            await writeBooking(booking);
            await button('Save reservation').click();
          }
      }
      await page.reload();
      const before = await state();
      let records: unknown;
      let error: string | null = null;
      try {
        if (expense)
          records = await expenseRecords(ctx, {
            async load(action) {
              await action.click();
              const selected = await page
                .getByRole('combobox', { name: 'Payer', exact: true })
                .locator('option:checked')
                .innerText();
              const participants: string[] = [];
              for (const name of ['Zed', 'Ada'])
                if (await page.getByRole('checkbox', { name, exact: true }).isChecked())
                  participants.push(name);
              return {
                description: await field('Expense description').inputValue(),
                amount: await field('Amount').inputValue(),
                payer: selected === 'Choose payer' ? '' : selected,
                participants,
              };
            },
            async write(value) {
              await field('Expense description').fill(value.description);
              await field('Amount').fill(value.amount);
              await page
                .getByRole('combobox', { name: 'Payer', exact: true })
                .selectOption({ label: value.payer });
              for (const name of ['Zed', 'Ada'])
                await page
                  .getByRole('checkbox', { name, exact: true })
                  .setChecked(value.participants.includes(name));
            },
            async save() {
              await button('Save expense').click();
            },
            async paid() {
              let total = 0;
              for (const name of ['Zed', 'Ada']) {
                const text = await page
                  .getByRole('row')
                  .filter({ has: page.getByRole('cell', { name, exact: true }) })
                  .getByRole('cell')
                  .nth(1)
                  .innerText();
                const [whole, fraction] = text.split('.');
                total += Number(whole) * 100 + Number(fraction);
              }
              return total;
            },
            async effects() {
              const rows: string[][] = [];
              for (const row of await page.getByRole('row').all()) {
                const cells = await row.getByRole('cell').allTextContents();
                if (cells.length) rows.push(cells);
              }
              return JSON.stringify(rows.sort((a, b) => a[0]!.localeCompare(b[0]!)));
            },
          });
        else if (mode.startsWith('room'))
          records = await roomRecords(ctx, {
            async load(action) {
              await action.click();
              return {
                name: await field('Room name').inputValue(),
                capacity: Number(await field('Capacity').inputValue()),
              };
            },
            async write(value) {
              await field('Room name').fill(value.name);
              await field('Capacity').fill(String(value.capacity));
            },
            async save() {
              await button('Save room').click();
            },
            async reload() {
              await page.reload();
            },
            async labels() {
              return textbox
                ? null
                : field('Reservation room').getByRole('option').allTextContents();
            },
            async relation(scope, original) {
              return createRoomRelation(
                ctx,
                scope,
                original.name,
                {
                  async load(action) {
                    await action.click();
                    return {
                      room: await field('Reservation room').inputValue(),
                      date: await field('Date').inputValue(),
                      start: await field('Start').inputValue(),
                      end: await field('End').inputValue(),
                      seats: Number(await field('Seats').inputValue()),
                    };
                  },
                  write: writeBooking,
                  async save() {
                    await button('Save reservation').click();
                  },
                  async reload() {
                    await page.reload();
                  },
                  async display(value, known) {
                    return (await reservationDisplay(ctx, value, known)).present;
                  },
                  async create(value) {
                    await button('New reservation').click();
                    await writeBooking(value);
                    await button('Save reservation').click();
                  },
                },
                [],
              );
            },
            async label(name) {
              return name;
            },
          });
        else {
          const controls: ReservationRecordControls = {
            async load(action) {
              await action.click();
              const selected = await field('Reservation room')
                .locator('option:checked')
                .innerText();
              return {
                room: selected === 'Choose room' ? '' : selected,
                date: await field('Date').inputValue(),
                start: await field('Start').inputValue(),
                end: await field('End').inputValue(),
                seats: Number(await field('Seats').inputValue()),
              };
            },
            write: writeBooking,
            async save() {
              await button('Save reservation').click();
            },
            async reload() {
              await page.reload();
            },
            async display(value, known) {
              return (await reservationDisplay(ctx, value, known)).present;
            },
          };
          if (mode.startsWith('relation'))
            records = await withRecordObservation(async (scope) => {
              const relation = await createRoomRelation(
                ctx,
                scope,
                'Bay',
                {
                  ...controls,
                  async create(value) {
                    await button('New reservation').click();
                    await writeBooking(value);
                    await button('Save reservation').click();
                  },
                },
                bookings,
              );
              assert.equal(await relation.follows('Bay'), true);
              return bookings;
            });
          else records = await reservationRecords(ctx, controls);
        }
      } catch (cause) {
        error = recordObservationError(cause);
      }
      await page.reload();
      const after = await state();
      assert.deepEqual(errors, []);
      rows.push({
        mode,
        normalReturn: error === null,
        restored: before === after,
        error,
        records,
        before,
        after,
      });
      console.log(JSON.stringify(rows.at(-1)));
      if (mode.endsWith('reference')) {
        assert.equal(error, null);
        assert.equal(after, before);
        assert.deepEqual(
          records,
          expense
            ? [
                {
                  description: 'Original',
                  amount: mode.includes('zero-share') ? '0.01' : '1.00',
                  payer: 'Zed',
                  participants: ['Zed'],
                },
              ]
            : mode.startsWith('room')
              ? [{ name: 'Bay', capacity: 2 }]
              : bookings,
        );
      }
    } finally {
      await context.close();
      await killProcessGroup(server);
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'proof.json'), `${JSON.stringify({ root, rows }, null, 2)}\n`);
  console.log(`RECORD_SETTLEMENT_ROOT ${root}`);
}
for (const row of rows.filter((row) => !row.mode.endsWith('reference'))) {
  assert.equal(row.normalReturn, false, `${row.mode}: partial settlement cannot return normally`);
  assert.match(
    row.error!,
    row.mode.startsWith('expense')
      ? /Temporary expense rollback (?:left|lost|changed)/
      : row.mode.startsWith('room')
        ? /Temporary room rollback (?:left|lost|changed)/
        : /Reservation observation lost an original peer/,
  );
}
assert.equal(rows.length, 17);
console.log(
  'PASS: six real references settle exactly; eleven partial-write/peer-loss faults fail explicitly',
);
