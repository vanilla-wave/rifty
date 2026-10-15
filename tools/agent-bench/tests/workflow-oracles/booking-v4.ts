import {
  actionCaption,
  choiceOption,
  describedEditableControl,
  editableControl,
  fieldValue,
  namedActions,
  renderedValue,
  selectChoices,
  selectedChoice,
  verdict,
} from '../../src/judge/context.ts';
import type { JudgeContext, JudgeProbe, TaskJudge } from '../../src/judge/context.ts';
import { fillNativeInput } from '../../src/judge/native-input.ts';

const controls = {
  name: /^(?!.*\bfilter\b)(?=.*\broom\b)(?=.*\bname\b)(?!(?:(?!\bname\b).)*\b(?:reservation|booking)\b)/i,
  capacity: /\bcapacity\b/i,
  room: /^(?!.*\bfilter\b)(?:(?:(?!\bname\b).)*\b(?:reservation|booking)\b.*\broom\b|(?!.*\bname\b).*\broom\b)/i,
  date: /^(?!.*\bfilter\b).*\bdate\b/i,
  start: /\bstart\b/i,
  end: /\bend\b/i,
  seats: /\bseats\b/i,
};
const input = (ctx: JudgeContext, name: keyof typeof controls) =>
  name === 'seats'
    ? describedEditableControl(ctx, name, { room: ['Room'], seats: ['Seats'] }).and(
        editableControl(ctx, controls[name]),
      )
    : editableControl(ctx, controls[name]);
async function click(ctx: JudgeContext, name: RegExp) {
  const matches = namedActions(ctx, name);
  for (const node of await matches.all())
    if (await node.isVisible()) {
      await node.click();
      return;
    }
  throw new Error(`Missing named action ${name}`);
}
async function saveRoom(ctx: JudgeContext) {
  const update = namedActions(ctx, actionCaption('save|update', 'room'));
  if (await update.count()) await click(ctx, actionCaption('save|update', 'room'));
  else await click(ctx, actionCaption('add|create', 'room'));
}
async function room(ctx: JudgeContext, name: string, capacity: number) {
  if (!(await input(ctx, 'name').isVisible()))
    await click(ctx, actionCaption('add|create|new', 'room'));
  await input(ctx, 'name').fill(name);
  await input(ctx, 'capacity').fill(String(capacity));
  await saveRoom(ctx);
}
async function chooseRoom(ctx: JudgeContext, name: string) {
  const picker = input(ctx, 'room');
  if ((await picker.evaluate((node) => node.tagName)) === 'SELECT')
    await selectChoices(picker, [name]);
  else {
    await picker.fill(name);
    if (await ctx.view.getByRole('option').count())
      await (await choiceOption(ctx.view, name)).click();
  }
}
async function saveBooking(ctx: JudgeContext) {
  const update = actionCaption('save|update', 'reservation|booking');
  if (await namedActions(ctx, update).count()) await click(ctx, update);
  else await click(ctx, actionCaption('add|create', 'reservation|booking'));
}
async function book(
  ctx: JudgeContext,
  room: string,
  date: string,
  start: string,
  end: string,
  seats: number,
) {
  const fresh = namedActions(ctx, actionCaption('new', 'reservation|booking'));
  if (await fresh.count()) await fresh.first().click();
  if (!(await input(ctx, 'date').isVisible()))
    await click(ctx, actionCaption('add|create|new', 'reservation|booking'));
  await chooseRoom(ctx, room);
  await fillNativeInput(input(ctx, 'date'), date);
  await fillNativeInput(input(ctx, 'start'), start);
  await fillNativeInput(input(ctx, 'end'), end);
  await input(ctx, 'seats').fill(String(seats));
  await saveBooking(ctx);
}
function edits(ctx: JudgeContext) {
  return namedActions(ctx, actionCaption('edit', 'reservation|booking'));
}
async function snapshot(ctx: JudgeContext) {
  const rows = [];
  const identities = (await rooms(ctx)).map((room) => room.name);
  const count = await edits(ctx).count();
  for (let index = 0; index < count; index++) {
    await edits(ctx).nth(index).click();
    const picker = input(ctx, 'room');
    const selectedRoom =
      (await picker.evaluate((node) => node.tagName)) === 'SELECT'
        ? await selectedChoice(picker, identities)
        : '';
    rows.push({
      room: selectedRoom || (await fieldValue(input(ctx, 'room'))),
      date: await fieldValue(input(ctx, 'date')),
      start: await fieldValue(input(ctx, 'start')),
      end: await fieldValue(input(ctx, 'end')),
      seats: Number(await fieldValue(input(ctx, 'seats'))),
    });
    await saveBooking(ctx);
  }
  return rows;
}
async function rooms(ctx: JudgeContext) {
  const result = [];
  const actions = namedActions(ctx, actionCaption('edit', 'room'));
  for (let index = 0; index < (await actions.count()); index++) {
    await actions.nth(index).click();
    result.push({
      name: await fieldValue(input(ctx, 'name')),
      capacity: Number(await fieldValue(input(ctx, 'capacity'))),
    });
    await saveRoom(ctx);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
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
    await click(ctx, actionCaption('edit', 'room', 'Bay'));
    await input(ctx, 'name').fill('');
    await input(ctx, 'capacity').fill('1.5');
    await saveRoom(ctx);
    await rejected('invalid room edit');
    const invalidRoomEdit = await rooms(ctx);
    probes.push({
      name: 'invalid room edit preserves prior room',
      pass: same(invalidRoomEdit, initialRooms),
      evidence: invalidRoomEdit,
    });
    await click(ctx, actionCaption('edit', 'room', 'Bay'));
    await input(ctx, 'name').fill('Bay East');
    await input(ctx, 'capacity').fill('3');
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
    await click(ctx, actionCaption('edit', 'room', 'Bay East'));
    await input(ctx, 'name').fill('Bay');
    await input(ctx, 'capacity').fill('2');
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
    await edits(ctx).nth(2).click();
    await input(ctx, 'end').fill('11:30');
    await input(ctx, 'seats').fill('1');
    await saveBooking(ctx);
    const changed = await snapshot(ctx);
    probes.push({
      name: 'valid reservation edit changes retained end/seats',
      pass: same(changed, [valid[0], valid[1], { ...valid[2], end: '11:30', seats: 1 }]),
      evidence: changed,
    });
    await edits(ctx).nth(2).click();
    await input(ctx, 'end').fill('11:00');
    await input(ctx, 'seats').fill('2');
    await saveBooking(ctx);
    await edits(ctx).nth(2).click();
    await input(ctx, 'start').fill('09:30');
    await input(ctx, 'end').fill('10:30');
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
    await namedActions(ctx, actionCaption('delete', 'reservation|booking')).nth(3).click();
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
    await edits(ctx).first().click();
    await input(ctx, 'seats').fill('9');
    await saveBooking(ctx);
    await rejected('overcapacity reservation edit');
    const afterEdit = await snapshot(ctx);
    probes.push({
      name: 'overcapacity edit preserves prior reservation',
      pass: same(valid, afterEdit),
      evidence: afterEdit,
    });
    await click(ctx, actionCaption('edit', 'room', 'Amber'));
    await input(ctx, 'capacity').fill('2');
    await saveRoom(ctx);
    await rejected('capacity reduction');
    await click(ctx, actionCaption('edit', 'room', 'Amber'));
    probes.push({
      name: 'capacity reduction guard preserves room and bookings',
      pass: (await fieldValue(input(ctx, 'capacity'))) === '4' && same(valid, await snapshot(ctx)),
      evidence: await fieldValue(input(ctx, 'capacity')),
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
      pass: (await edits(ctx).count()) === 0,
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
    await click(ctx, actionCaption('delete', 'room', 'Amber'));
    await rejected('referenced room deletion');
    probes.push({
      name: 'referenced room deletion preserves bookings',
      pass: same(valid, await snapshot(ctx)),
      evidence: await snapshot(ctx),
    });
    const deletion = namedActions(ctx, actionCaption('delete', 'reservation|booking'));
    await deletion.first().click();
    await ctx.view.goto(ctx.view.url());
    probes.push({
      name: 'reservation deletion persists',
      pass: (await snapshot(ctx)).length === 2,
      evidence: await snapshot(ctx),
    });
    await room(ctx, 'Unused', 1);
    await click(ctx, actionCaption('delete', 'room', 'Unused'));
    probes.push({
      name: 'unreferenced room deletion',
      pass: (await namedActions(ctx, actionCaption('edit', 'room', 'Unused')).count()) === 0,
      evidence: await ctx.view.locator('body').innerText(),
    });
  } catch (error) {
    probes.push({ name: 'booking workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
};
export default judge;
