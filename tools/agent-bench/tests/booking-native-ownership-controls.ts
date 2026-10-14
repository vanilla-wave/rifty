import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { bookingReservationDisplay } from '../src/judge/booking-native-display.ts';
import { bookingWorkflowAction } from '../src/judge/booking-native-ownership.ts';
import { editableControl, workflowCandidates } from '../src/judge/context.ts';
import type { ReservationRecord } from '../src/judge/reservation-records.ts';

const browser = await chromium.launch({ handleSIGINT: false });
let checks = 0;
try {
  const page = await browser.newPage();
  const ctx = { view: page, previewUrl: 'about:blank' };
  await page.setContent(
    '<main><h1>Room reservations</h1><section><h2>Rooms</h2><form><label>Room name<input></label><button>Add room ↗</button></form></section><section><h2>Reserve a room</h2><form><label>Reservation room<select><option>Amber</option></select></label><label>Date<input></label><button>Add reservation ↗</button></form></section></main>',
  );
  const roomAction = await bookingWorkflowAction(
    ctx,
    'room',
    true,
    editableControl(ctx, /room name/i),
  );
  assert.match(await roomAction.ariaSnapshot(), /Add room/);
  checks++;
  await page.setContent(
    '<main><h1>Rooms</h1><label>Room name<input form="room"></label><form id="room"><button>Add room</button></form><form><label>Other<input></label><button>Add room</button></form></main>',
  );
  assert.equal(
    await (
      await bookingWorkflowAction(ctx, 'room', true, editableControl(ctx, /room name/i))
    ).evaluate((node) => node.closest('form')?.id),
    'room',
  );
  checks++;
  await page.setContent(
    '<section><h2>Rooms</h2><label>Room name<input></label><button>Add room</button></section>',
  );
  assert.match(
    await (
      await bookingWorkflowAction(ctx, 'room', true, editableControl(ctx, /room name/i))
    ).ariaSnapshot(),
    /Add room/,
  );
  checks++;

  await page.setContent(
    '<form><label>Room name<input></label><button>Add room</button><button>Create room</button></form>',
  );
  assert.equal(
    await (
      await bookingWorkflowAction(ctx, 'room', true, editableControl(ctx, /room name/i))
    ).count(),
    1,
  );
  checks++;
  await page.setContent(
    '<form><label>Room name<input></label><button>Add room</button><button>Save room</button></form>',
  );
  assert.match(
    await (
      await bookingWorkflowAction(ctx, 'room', true, editableControl(ctx, /room name/i))
    ).ariaSnapshot(),
    /Save room/,
  );
  checks++;

  const records: ReservationRecord[] = [
    { room: 'Amber', date: '2030-01-10', start: '09:00', end: '10:00', seats: 3 },
    { room: 'Bay', date: '2030-01-10', start: '09:00', end: '10:00', seats: 2 },
    { room: 'Amber', date: '2030-01-10', start: '10:00', end: '11:00', seats: 2 },
  ];
  const marked = { ...records[0]!, date: '2178-02-09' };
  const table = (values: ReservationRecord[], combined: boolean) =>
    `<table><thead><tr><th>Room</th><th>Date</th>${combined ? '<th>Time</th>' : '<th>Start</th><th>End</th>'}<th>Seats</th><th>Actions</th></tr></thead><tbody>${values.map((r) => `<tr><td><span>▦</span>${r.room}</td><td>${r.date}</td>${combined ? `<td>${r.start} – ${r.end}</td>` : `<td>${r.start}</td><td>${r.end}</td>`}<td><span>${r.seats} seats</span></td><td><button>Edit</button></td></tr>`).join('')}</tbody></table>`;
  for (const combined of [false, true]) {
    await page.setContent(table(records, combined));
    assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).present, true);
    checks++;
    await page.setContent(table([marked, ...records.slice(1)], combined));
    assert.equal(
      (await bookingReservationDisplay(ctx, records[0]!, [records[0]!, marked])).present,
      false,
    );
    checks++;
    assert.equal(
      (await bookingReservationDisplay(ctx, marked, [records[0]!, marked])).present,
      true,
    );
    checks++;
  }
  await page.setContent(table([records[0]!, records[0]!], true));
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).count, 2);
  checks++;
  await page.setContent(table([{ ...records[0]!, seats: 2 }], true));
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).present, false);
  checks++;
  await page.setContent(table([records[0]!], true));
  await page.locator('tbody tr').evaluate((row) => {
    row.style.display = 'none';
  });
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).present, false);
  checks++;
  await page.setContent(table([records[0]!], true));
  await page
    .locator('tbody td')
    .nth(1)
    .evaluate((cell) => {
      const input = document.createElement('input');
      cell.append(input);
    });
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).present, false);
  checks++;
  await page.locator('input').evaluate((input) => {
    input.style.display = 'none';
  });
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).present, true);
  checks++;

  const card = (record: ReservationRecord) =>
    `<article>${record.room} ${record.date} ${record.start} ${record.end} ${record.seats}</article>`;
  await page.setContent(table([records[0]!], true) + card(records[1]!));
  assert.equal((await bookingReservationDisplay(ctx, records[1]!, records)).present, true);
  checks++;
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).count, 1);
  checks++;
  await page.setContent(table([records[0]!], true) + card(records[0]!));
  assert.equal((await bookingReservationDisplay(ctx, records[0]!, records)).count, 2);
  checks++;
  await page.setContent(table([marked], true) + card(records[1]!));
  assert.equal(
    (await bookingReservationDisplay(ctx, records[0]!, [records[0]!, marked])).present,
    false,
  );
  checks++;
  await page.setContent(
    `${table([records[0]!], true)}<section><h2>Bay</h2><h3>2030-01-10</h3><article>09:00 10:00 2</article></section>`,
  );
  assert.equal((await bookingReservationDisplay(ctx, records[1]!, records)).present, true);
  checks++;

  await page.setContent(
    '<main><h1>Reservations</h1><div id="editor"></div><table aria-label="Reservations"><tr><td>A</td><td><button aria-label="Edit reservation A">Edit</button></td></tr><tr><td>Cancel</td><td><button aria-label="Edit reservation Cancel">Edit</button></td></tr></table></main>',
  );
  await page.evaluate(() => {
    document.querySelector('button')!.addEventListener('click', () => {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.setAttribute('aria-label', 'Cancel reservation edit');
      document.querySelector('#editor')!.append(cancel);
    });
  });
  const actions = await (await workflowCandidates(ctx, 'edit', 'reservation|booking')).all();
  assert.equal(actions.length, 2);
  await actions[0]!.click();
  assert.match(await actions[0]!.ariaSnapshot(), /Edit reservation A/);
  checks++;
  assert.match(await actions[1]!.ariaSnapshot(), /Edit reservation Cancel/);
  checks++;
  assert.equal(await (await workflowCandidates(ctx, 'edit', 'reservation|booking')).count(), 2);
  checks++;
  await page.locator('#editor button').evaluate((node) => {
    node.textContent = 'Cancel reservation edit';
  });
  assert.equal(await (await workflowCandidates(ctx, 'edit', 'reservation|booking')).count(), 2);
  checks++;
  await page.setContent(
    '<table aria-label="Reservations"><tr><td>Cancel</td><td><button aria-label="Cancel • Edit reservation">Edit</button></td></tr></table>',
  );
  assert.equal(await (await workflowCandidates(ctx, 'edit', 'reservation|booking')).count(), 1);
  checks++;
  console.log(
    JSON.stringify({
      checks,
      pass: true,
      boundary:
        'Real Chromium/production owners, authored foreign native form/table inputs; no model or mocked rifty package.',
    }),
  );
} finally {
  await browser.close();
}
