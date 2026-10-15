import {
  choiceOption,
  describedEditableControl,
  editableControl,
  editableControlForAction,
  fieldValue,
  optionLabel,
  renderedValue,
  selectChoices,
  selectedChoice,
  verdict,
  workflowAction,
  workflowActions,
  workflowCandidates,
} from '../../../src/judge/context.ts';
import type { JudgeContext, JudgeProbe, TaskJudge } from '../../../src/judge/context.ts';
import { fillNativeInput } from '../../../src/judge/native-input.ts';
import { recordKeyActions } from '../../../src/judge/record-action-binding.ts';
import { recordCandidates } from '../../../src/judge/record-candidates.ts';
import { recordObservationError } from '../../../src/judge/record-observation.ts';
import { reservationDisplay } from '../../../src/judge/reservation-display.ts';
import {
  createRoomRelation,
  editReservationRecord,
  reservationKey,
  reservationRecords,
} from '../../../src/judge/reservation-records.ts';
import type {
  ReservationRecord,
  ReservationRecordControls,
} from '../../../src/judge/reservation-records.ts';
import { editRoomRecord, roomRecords } from '../../../src/judge/room-records.ts';
import type { RoomRecordControls } from '../../../src/judge/room-records.ts';

const controls = {
  name: /^(?!.*\bfilter\b)(?=.*\broom\b)(?=.*\bname\b)(?!(?:(?!\bname\b).)*\b(?:reservation|booking)\b)/i,
  capacity: /\bcapacity\b/i,
  room: /^(?!.*\bfilter\b)(?:(?:(?!\bname\b).)*\b(?:reservation|booking)\b.*\broom\b|(?!.*\bname\b).*\broom\b)/i,
  date: /^(?!.*\bfilter\b).*\bdate\b/i,
  start: /\bstart\b/i,
  end: /\bend\b/i,
  seats: /\bseats\b/i,
};
async function input(ctx: JudgeContext, name: keyof typeof controls, creation = false) {
  const domain = name === 'name' || name === 'capacity' ? 'room' : 'reservation|booking';
  const target = await workflowAction(ctx, domain, creation, editableControl(ctx, controls[name]));
  const selected = await editableControlForAction(ctx, controls[name], target);
  return name === 'seats'
    ? selected.and(describedEditableControl(ctx, name, { room: ['Room'], seats: ['Seats'] }))
    : selected;
}
async function click(ctx: JudgeContext, verbs: string, subjects: string, identity?: string) {
  if (verbs === 'edit' && subjects === 'room' && identity) {
    await editRoomRecord(ctx, identity, roomControls(ctx));
    return;
  }
  if (verbs === 'delete' && subjects === 'room' && identity) {
    const records = await rooms(ctx);
    if (!records.some((record) => record.name === identity))
      throw new Error('Missing confirmed room deletion target');
    const choices = await recordCandidates(
      ctx,
      verbs,
      subjects,
      identity,
      records.filter((record) => record.name !== identity).map((record) => record.name),
    );
    if (!(await choices.count())) throw new Error('Missing bound room deletion');
    await choices.first().click();
    return;
  }
  const matches = await workflowActions(ctx, verbs, subjects, identity);
  for (const node of await matches.all())
    if (await node.isVisible()) {
      await node.click();
      return;
    }
  throw new Error(`Missing named action ${verbs}/${subjects}/${identity}`);
}
async function saveRoom(ctx: JudgeContext, creation = false) {
  if (creation) {
    await (await workflowAction(ctx, 'room', true, editableControl(ctx, controls.name))).click();
    return;
  }
  const update = await workflowActions(ctx, 'save|update', 'room');
  if (await update.count()) await click(ctx, 'save|update', 'room');
  else await click(ctx, 'add|create', 'room');
}
async function room(ctx: JudgeContext, name: string, capacity: number) {
  if (
    !(
      await Promise.all(
        (await editableControl(ctx, controls.name).all()).map((node) => node.isVisible()),
      )
    ).some(Boolean)
  )
    await click(ctx, 'add|create|new', 'room');
  await (await input(ctx, 'name', true)).fill(name);
  await (await input(ctx, 'capacity', true)).fill(String(capacity));
  await saveRoom(ctx, true);
}
async function chooseRoom(ctx: JudgeContext, name: string, creation = true) {
  const picker = await input(ctx, 'room', creation);
  if ((await picker.evaluate((node) => node.tagName)) === 'SELECT')
    await selectChoices(picker, [name]);
  else {
    await picker.fill(name);
    if (await ctx.view.getByRole('option').count())
      await (await choiceOption(ctx.view, name)).click();
  }
}
async function saveBooking(ctx: JudgeContext, creation = false) {
  if (creation) {
    await (
      await workflowAction(ctx, 'reservation|booking', true, editableControl(ctx, controls.date))
    ).click();
    return;
  }
  const update = await workflowActions(ctx, 'save|update', 'reservation|booking');
  if (await update.count()) await update.first().click();
  else await click(ctx, 'add|create', 'reservation|booking');
}
async function book(
  ctx: JudgeContext,
  room: string,
  date: string,
  start: string,
  end: string,
  seats: number,
) {
  const fresh = await workflowActions(ctx, 'new', 'reservation|booking');
  if (await fresh.count()) await fresh.first().click();
  if (
    !(
      await Promise.all(
        (await editableControl(ctx, controls.date).all()).map((node) => node.isVisible()),
      )
    ).some(Boolean)
  )
    await click(ctx, 'add|create|new', 'reservation|booking');
  await chooseRoom(ctx, room);
  await fillNativeInput(await input(ctx, 'date', true), date);
  await fillNativeInput(await input(ctx, 'start', true), start);
  await fillNativeInput(await input(ctx, 'end', true), end);
  await (await input(ctx, 'seats', true)).fill(String(seats));
  await saveBooking(ctx, true);
}
async function edits(ctx: JudgeContext) {
  return workflowCandidates(ctx, 'edit', 'reservation|booking');
}
async function reloadView(ctx: JudgeContext) {
  const roomFilter = ctx.view.getByLabel(/(?=.*\broom\b)(?=.*\bfilter\b)/i);
  const dateFilter = ctx.view.getByLabel(/(?=.*\bdate\b)(?=.*\bfilter\b)/i);
  const values = [await fieldValue(roomFilter), await fieldValue(dateFilter)];
  await ctx.view.goto(ctx.view.url());
  await roomFilter.fill(values[0]!);
  await dateFilter.fill(values[1]!);
}
async function displayRecord(
  ctx: JudgeContext,
  record: ReservationRecord,
  known: readonly ReservationRecord[],
) {
  const roomFilter = ctx.view.getByLabel(/(?=.*\broom\b)(?=.*\bfilter\b)/i);
  const dateFilter = ctx.view.getByLabel(/(?=.*\bdate\b)(?=.*\bfilter\b)/i);
  const values = [await fieldValue(roomFilter), await fieldValue(dateFilter)];
  try {
    await roomFilter.fill('');
    await dateFilter.fill('');
    return (await reservationDisplay(ctx, record, known)).present;
  } finally {
    await roomFilter.fill(values[0]!);
    await dateFilter.fill(values[1]!);
  }
}
function bookingControls(
  ctx: JudgeContext,
  identities = ['Amber', 'Bay'],
): ReservationRecordControls {
  return {
    async load(action) {
      await action.click();
      const picker = await input(ctx, 'room');
      const room =
        (await picker.evaluate((node) => node.tagName)) === 'SELECT'
          ? await selectedChoice(picker, [...new Set(identities)])
          : await fieldValue(picker);
      return {
        room,
        date: await fieldValue(await input(ctx, 'date')),
        start: await fieldValue(await input(ctx, 'start')),
        end: await fieldValue(await input(ctx, 'end')),
        seats: Number(await fieldValue(await input(ctx, 'seats'))),
      };
    },
    async write(value) {
      await chooseRoom(ctx, value.room, false);
      await fillNativeInput(await input(ctx, 'date'), value.date);
      await fillNativeInput(await input(ctx, 'start'), value.start);
      await fillNativeInput(await input(ctx, 'end'), value.end);
      await (await input(ctx, 'seats')).fill(String(value.seats));
    },
    save: () => saveBooking(ctx),
    reload: () => reloadView(ctx),
    display: (value, known) => displayRecord(ctx, value, known),
  };
}
async function snapshot(ctx: JudgeContext) {
  const records = await reservationRecords(ctx, bookingControls(ctx));
  const displayed = await Promise.all(
    records.map(async (record, index) => {
      const projection = await reservationDisplay(ctx, record, records);
      if (!projection.position) throw new Error('Missing independent displayed record position');
      return { index, ...projection.position };
    }),
  );
  const positions = displayed
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((value) => value.index);
  for (let index = 1; index < positions.length; index++) {
    const previous = records[positions[index - 1]!]!;
    const current = records[positions[index]!]!;
    if (
      previous.date > current.date ||
      (previous.date === current.date && previous.start > current.start)
    )
      throw new Error('Reservation display is not chronological');
  }
  return records.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.room.localeCompare(b.room),
  );
}
async function deleteBookingRecord(
  ctx: JudgeContext,
  target: ReservationRecord,
  records: ReservationRecord[],
) {
  const actions = await recordKeyActions(
    ctx,
    'delete',
    'reservation|booking',
    [target.room, { calendarDate: target.date }, target.start],
    records
      .filter((record) => reservationKey(record) !== reservationKey(target))
      .map((record) => [
        record.room,
        { calendarDate: record.date },
        record.start,
        record.end,
        String(record.seats),
      ]),
  );
  if (!(await actions.count())) throw new Error('Missing bound reservation deletion');
  await actions.first().click();
}
function roomControls(ctx: JudgeContext): RoomRecordControls {
  return {
    async load(action) {
      await action.click();
      return {
        name: await fieldValue(await input(ctx, 'name')),
        capacity: Number(await fieldValue(await input(ctx, 'capacity'))),
      };
    },
    async write(value) {
      await (await input(ctx, 'name')).fill(value.name);
      await (await input(ctx, 'capacity')).fill(String(value.capacity));
    },
    save: () => saveRoom(ctx),
    reload: () => reloadView(ctx),
    async labels() {
      const picker = await input(ctx, 'room', true);
      if (
        (await picker.evaluate((node) => node.tagName)) !== 'SELECT' &&
        !(await picker.getByRole('option').count())
      )
        return null;
      return Promise.all((await picker.getByRole('option').all()).map(optionLabel));
    },
    async relation(scope, original) {
      const controls = bookingControls(ctx, ['Amber', 'Bay', original.name]);
      const originals: ReservationRecord[] = [];
      for (const action of await (await edits(ctx)).all()) {
        originals.push(await controls.load(action));
      }
      return createRoomRelation(
        ctx,
        scope,
        original.name,
        {
          ...controls,
          create: (value) => book(ctx, value.room, value.date, value.start, value.end, value.seats),
        },
        originals,
      );
    },
    async label(name) {
      return optionLabel(await choiceOption(await input(ctx, 'room', true), name));
    },
  };
}
async function rooms(ctx: JudgeContext) {
  return roomRecords(ctx, roomControls(ctx));
}
async function validationVisible(ctx: JudgeContext) {
  for (const output of await ctx.view.getByLabel(/\bvalidation\b/i).all())
    if ((await output.isVisible()) && (await renderedValue(output)).trim()) return true;
  return false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const judge: TaskJudge = async (ctx) => {
  const probes: JudgeProbe[] = [];
  async function rejected(name: string) {
    probes.push({
      name: `${name}: visible named validation`,
      pass: await validationVisible(ctx),
      evidence: await ctx.view.locator('body').innerText(),
    });
  }
  try {
    await room(ctx, ' Amber ', 4);
    await room(ctx, 'Bay', 2);
    const initialRooms = await rooms(ctx);
    probes.push({
      name: 'room names trimmed; positive capacities retained',
      pass: same(initialRooms, [
        { name: 'Amber', capacity: 4 },
        { name: 'Bay', capacity: 2 },
      ]),
      evidence: initialRooms,
    });
    for (const [name, capacity] of [
      ['aMbEr', 3],
      ['', 2],
      ['Empty capacity', 0],
      ['Fraction capacity', 1.5],
    ] as const) {
      await room(ctx, name, capacity);
      await rejected(`invalid room ${name}/${capacity}`);
      const after = await rooms(ctx);
      probes.push({
        name: `invalid/duplicate room preserves state: ${name}/${capacity}`,
        pass: same(after, initialRooms),
        evidence: after,
      });
    }
    await click(ctx, 'edit', 'room', 'Bay');
    await (await input(ctx, 'name')).fill('');
    await (await input(ctx, 'capacity')).fill('1.5');
    await saveRoom(ctx);
    await rejected('invalid room edit');
    const invalidRoomEdit = await rooms(ctx);
    probes.push({
      name: 'invalid room edit preserves prior room',
      pass: same(invalidRoomEdit, initialRooms),
      evidence: invalidRoomEdit,
    });
    await click(ctx, 'edit', 'room', 'Bay');
    await (await input(ctx, 'name')).fill('Bay East');
    await (await input(ctx, 'capacity')).fill('3');
    await saveRoom(ctx);
    const renamed = await rooms(ctx);
    probes.push({
      name: 'valid room name/capacity edit',
      pass: same(renamed, [
        { name: 'Amber', capacity: 4 },
        { name: 'Bay East', capacity: 3 },
      ]),
      evidence: renamed,
    });
    await click(ctx, 'edit', 'room', 'Bay East');
    await (await input(ctx, 'name')).fill('Bay');
    await (await input(ctx, 'capacity')).fill('2');
    await saveRoom(ctx);
    await book(ctx, 'Amber', '2030-01-10', '10:00', '11:00', 2);
    await book(ctx, 'Amber', '2030-01-10', '09:00', '10:00', 3);
    await book(ctx, 'Bay', '2030-01-10', '09:00', '10:00', 2);
    const valid = await snapshot(ctx);
    probes.push({
      name: 'room/date independence, adjacency and chronological records',
      pass:
        valid.length === 3 &&
        valid[0]?.start === '09:00' &&
        valid[2]?.start === '10:00' &&
        valid.some((row) =>
          same(row, { room: 'Amber', date: '2030-01-10', start: '09:00', end: '10:00', seats: 3 }),
        ) &&
        valid.some((row) =>
          same(row, { room: 'Amber', date: '2030-01-10', start: '10:00', end: '11:00', seats: 2 }),
        ) &&
        valid.some((row) =>
          same(row, { room: 'Bay', date: '2030-01-10', start: '09:00', end: '10:00', seats: 2 }),
        ),
      evidence: valid,
    });
    await editReservationRecord(ctx, valid[2]!, bookingControls(ctx));
    await (await input(ctx, 'end')).fill('11:30');
    await (await input(ctx, 'seats')).fill('1');
    await saveBooking(ctx);
    const changed = await snapshot(ctx);
    probes.push({
      name: 'valid reservation edit changes retained end/seats',
      pass: same(changed, [valid[0], valid[1], { ...valid[2], end: '11:30', seats: 1 }]),
      evidence: changed,
    });
    await editReservationRecord(ctx, valid[2]!, bookingControls(ctx));
    await (await input(ctx, 'end')).fill('11:00');
    await (await input(ctx, 'seats')).fill('2');
    await saveBooking(ctx);
    await editReservationRecord(ctx, valid[2]!, bookingControls(ctx));
    await (await input(ctx, 'start')).fill('09:30');
    await (await input(ctx, 'end')).fill('10:30');
    await saveBooking(ctx);
    await rejected('overlap reservation edit');
    await ctx.view.goto(ctx.view.url());
    const rejectedOverlapEdit = await snapshot(ctx);
    probes.push({
      name: 'overlap edit preserves prior reservation through reload',
      pass: same(valid, rejectedOverlapEdit),
      evidence: rejectedOverlapEdit,
    });
    await book(ctx, 'Amber', '2030-01-11', '09:00', '10:00', 2);
    const nextDate = await snapshot(ctx);
    probes.push({
      name: 'same interval on different date accepted and sorted',
      pass: nextDate.length === 4 && nextDate[3]?.date === '2030-01-11',
      evidence: nextDate,
    });
    await deleteBookingRecord(ctx, nextDate[3]!, nextDate);
    for (const [date, start, end, seats] of [
      ['2030-02-30', '12:00', '13:00', 1],
      ['2030-01-10', '13:00', '12:00', 1],
      ['2030-01-10', '25:00', '26:00', 1],
      ['2030-01-10', '12:00', '13:00', 0],
      ['2030-01-10', '12:00', '13:00', 1.5],
    ] as const) {
      await book(ctx, 'Amber', date, start, end, seats);
      await rejected(`invalid reservation ${date}/${start}/${seats}`);
      const after = await snapshot(ctx);
      probes.push({
        name: `invalid calendar/interval/seats preserves records: ${date}/${start}/${seats}`,
        pass: same(valid, after),
        evidence: after,
      });
    }
    await book(ctx, 'Amber', '2030-01-10', '09:30', '10:30', 1);
    probes.push({
      name: 'rejected overlap has visible named validation',
      pass: await validationVisible(ctx),
      evidence: await ctx.view.locator('body').innerText(),
    });
    await ctx.view.goto(ctx.view.url());
    const afterOverlap = await snapshot(ctx);
    probes.push({
      name: 'overlap creation rejected without mutation',
      pass: same(valid, afterOverlap),
      evidence: afterOverlap,
    });
    await editReservationRecord(ctx, valid[0]!, bookingControls(ctx));
    await (await input(ctx, 'seats')).fill('9');
    await saveBooking(ctx);
    await rejected('overcapacity reservation edit');
    const afterEdit = await snapshot(ctx);
    probes.push({
      name: 'overcapacity edit preserves prior reservation',
      pass: same(valid, afterEdit),
      evidence: afterEdit,
    });
    await click(ctx, 'edit', 'room', 'Amber');
    await (await input(ctx, 'capacity')).fill('2');
    await saveRoom(ctx);
    await rejected('capacity reduction');
    await click(ctx, 'edit', 'room', 'Amber');
    probes.push({
      name: 'capacity reduction guard preserves room and bookings',
      pass:
        (await fieldValue(await input(ctx, 'capacity'))) === '4' &&
        same(valid, await snapshot(ctx)),
      evidence: await fieldValue(await input(ctx, 'capacity')),
    });
    await ctx.view.getByLabel(/(?=.*\broom\b)(?=.*\bfilter\b)/i).fill('AMBER');
    const filtered = await snapshot(ctx);
    probes.push({
      name: 'case-insensitive room filter',
      pass: filtered.length === 2 && filtered.every((row) => row.room === 'Amber'),
      evidence: filtered,
    });
    await ctx.view.getByLabel(/(?=.*\bdate\b)(?=.*\bfilter\b)/i).fill('2030-01-11');
    probes.push({
      name: 'combined date/room filters',
      pass: (await (await edits(ctx)).count()) === 0,
      evidence: await ctx.view.locator('body').innerText(),
    });
    await ctx.view.getByLabel(/(?=.*\broom\b)(?=.*\bfilter\b)/i).fill('');
    await ctx.view.getByLabel(/(?=.*\bdate\b)(?=.*\bfilter\b)/i).fill('');
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'rooms/reservations persist after reload',
      pass: same(valid, await snapshot(ctx)),
      evidence: await snapshot(ctx),
    });
    await click(ctx, 'delete', 'room', 'Amber');
    await rejected('referenced room deletion');
    probes.push({
      name: 'referenced room deletion preserves bookings',
      pass: same(valid, await snapshot(ctx)),
      evidence: await snapshot(ctx),
    });
    await deleteBookingRecord(ctx, valid[0]!, valid);
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'reservation deletion persists',
      pass: (await snapshot(ctx)).length === 2,
      evidence: await snapshot(ctx),
    });
    await room(ctx, 'Unused', 1);
    await click(ctx, 'delete', 'room', 'Unused');
    probes.push({
      name: 'unreferenced room deletion',
      pass: same(await rooms(ctx), initialRooms),
      evidence: await ctx.view.locator('body').innerText(),
    });
  } catch (error) {
    probes.push({
      name: 'booking workflow completed',
      pass: false,
      evidence: recordObservationError(error),
    });
  }
  return verdict(probes);
};
export default judge;
