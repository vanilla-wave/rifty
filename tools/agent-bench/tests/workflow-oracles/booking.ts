import { actionCaption, fieldValue, namedActions, verdict } from '../../src/judge/context.ts';
import type { JudgeContext, JudgeProbe, TaskJudge } from '../../src/judge/context.ts';

const controls = {
  name: /^(?!.*\bfilter\b)(?=.*\broom\b)(?=.*\bname\b)/i,
  capacity: /\bcapacity\b/i,
  room: /^(?!.*\bfilter\b)(?!.*\bname\b).*\broom\b/i,
  date: /^(?!.*\bfilter\b).*\bdate\b/i,
  start: /\bstart\b/i,
  end: /\bend\b/i,
  seats: /\bseats\b/i,
};
const input = (ctx: JudgeContext, name: keyof typeof controls) =>
  ctx.view.getByLabel(controls[name]);
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
    await picker.selectOption({ label: name });
  else {
    await picker.fill(name);
    const option = ctx.view.getByRole('option', { name, exact: true });
    if (await option.count()) await option.click();
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
  await input(ctx, 'date').fill(date);
  await input(ctx, 'start').fill(start);
  await input(ctx, 'end').fill(end);
  await input(ctx, 'seats').fill(String(seats));
  await saveBooking(ctx);
}
function edits(ctx: JudgeContext) {
  return namedActions(ctx, actionCaption('edit', 'reservation|booking'));
}
async function snapshot(ctx: JudgeContext) {
  const rows = [];
  const count = await edits(ctx).count();
  for (let index = 0; index < count; index++) {
    await edits(ctx).nth(index).click();
    const selectedRoom = await input(ctx, 'room').evaluate((node) =>
      node instanceof HTMLSelectElement ? (node.selectedOptions[0]?.textContent?.trim() ?? '') : '',
    );
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const judge: TaskJudge = async (ctx) => {
  const probes: JudgeProbe[] = [];
  try {
    await room(ctx, 'Amber', 4);
    await room(ctx, 'Bay', 2);
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
    await book(ctx, 'Amber', '2030-01-10', '09:30', '10:30', 1);
    const afterOverlap = await snapshot(ctx);
    probes.push({
      name: 'overlap creation rejected without mutation',
      pass: same(valid, afterOverlap),
      evidence: afterOverlap,
    });
    await edits(ctx).first().click();
    await input(ctx, 'seats').fill('9');
    await saveBooking(ctx);
    const afterEdit = await snapshot(ctx);
    probes.push({
      name: 'overcapacity edit preserves prior reservation',
      pass: same(valid, afterEdit),
      evidence: afterEdit,
    });
    await click(ctx, actionCaption('edit', 'room', 'Amber'));
    await input(ctx, 'capacity').fill('2');
    await saveRoom(ctx);
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
