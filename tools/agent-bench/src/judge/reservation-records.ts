import { randomUUID } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { actionName, namedActions, workflowCandidates } from './context.ts';
import type { JudgeContext } from './context.ts';
import { observedRecordActions } from './record-action-binding.ts';
import { recordCandidates } from './record-candidates.ts';
import { withRecordObservation } from './record-observation.ts';
import type { RecordObservation } from './record-observation.ts';

export interface ReservationRecord {
  room: string;
  date: string;
  start: string;
  end: string;
  seats: number;
}
export interface ReservationRecordControls {
  load(action: Locator): Promise<ReservationRecord>;
  write(value: ReservationRecord): Promise<void>;
  save(): Promise<void>;
  reload(): Promise<void>;
  display(value: ReservationRecord, known: readonly ReservationRecord[]): Promise<boolean>;
}
export const reservationKey = (value: ReservationRecord) =>
  JSON.stringify([value.room, value.date, value.start]);
const same = (a: ReservationRecord, b: ReservationRecord) =>
  JSON.stringify(a) === JSON.stringify(b);
function freshDate() {
  const days = Number.parseInt(randomUUID().slice(0, 8), 16) % 36500;
  return new Date(Date.UTC(2090, 0, 1) + days * 86400000).toISOString().slice(0, 10);
}

async function witnessReservation(
  ctx: JudgeContext,
  controls: ReservationRecordControls,
  scope: RecordObservation,
  caption: string,
  original: ReservationRecord,
  originals: readonly ReservationRecord[],
) {
  const date = scope.reserveGenerated(
    freshDate,
    originals.map((value) => value.date),
  );
  const marked = { ...original, date };
  if (await controls.display(marked, [...originals, marked]))
    throw new Error('Temporary reservation key already displayed');
  if (!(await controls.display(original, [...originals, marked]))) return false;
  let update = false;
  await scope.apply(
    date,
    async () => {
      await controls.reload();
      const moved = await controls.display(marked, [...originals, marked]);
      const retained = await controls.display(original, [...originals, marked]);
      if (!moved) {
        if (!retained) throw new Error('Reservation observation lost both public keys');
        return;
      }
      if (retained) {
        const choices = await recordCandidates(
          ctx,
          'delete',
          'reservation|booking',
          date,
          originals.map((value) => value.date),
        );
        if (!(await choices.count()))
          throw new Error('Missing owned temporary reservation deletion');
        await choices.first().click();
      } else {
        const choices = await observedRecordActions(
          ctx,
          'edit',
          'reservation|booking',
          caption,
          original.date,
          date,
        );
        let loaded = false;
        for (const candidate of await choices.all()) {
          if (!same(await controls.load(candidate), marked)) continue;
          loaded = true;
          break;
        }
        if (!loaded) throw new Error('Missing confirmed moved reservation action');
        await controls.write(original);
        await controls.save();
      }
      await controls.reload();
      if (
        !(await controls.display(original, [...originals, marked])) ||
        (await controls.display(marked, [...originals, marked]))
      )
        throw new Error('Reservation observation failed to restore its public keys');
    },
    async () => {
      await controls.write(marked);
      await controls.save();
      await controls.reload();
      update =
        (await controls.display(marked, [...originals, marked])) &&
        !(await controls.display(original, [...originals, marked]));
    },
  );
  await scope.release(date);
  return update;
}

/** Unique room/date/start keys follow the public non-overlap constraint, not affordance count. */
export async function reservationRecords(
  ctx: JudgeContext,
  controls: ReservationRecordControls,
): Promise<ReservationRecord[]> {
  return withRecordObservation(async (scope) => {
    const initial = await workflowCandidates(ctx, 'edit', 'reservation|booking');
    const captions = [...new Set(await Promise.all((await initial.all()).map(actionName)))];
    const originals: ReservationRecord[] = [];
    for (const action of await initial.all()) {
      const value = await controls.load(action);
      if (value.room && value.date && value.start) originals.push(value);
    }
    const result = new Map<string, ReservationRecord>();
    for (const caption of captions) {
      const current = () =>
        workflowCandidates(ctx, 'edit', 'reservation|booking').then((choices) =>
          choices.and(namedActions(ctx, caption)),
        );
      const bound = await (await current()).count();
      for (let index = 0; index < bound; index++) {
        const action = (await current()).nth(index);
        if (!(await action.count())) continue;
        const original = await controls.load(action);
        if (!original.room || !original.date || !original.start) continue;
        if (!(await witnessReservation(ctx, controls, scope, caption, original, originals)))
          continue;
        const key = reservationKey(original);
        const prior = result.get(key);
        if (prior && !same(prior, original))
          throw new Error('Conflicting observed reservation key');
        result.set(key, original);
      }
    }
    return [...result.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
    );
  });
}

/** An owned reservation supplies room membership where no option inventory is exposed. */
export async function createRoomRelation(
  ctx: JudgeContext,
  scope: RecordObservation,
  room: string,
  controls: ReservationRecordControls & { create(value: ReservationRecord): Promise<void> },
  originals: readonly ReservationRecord[],
): Promise<{ follows(name: string): Promise<boolean> }> {
  const date = scope.reserveGenerated(
    freshDate,
    originals.map((value) => value.date),
  );
  const original: ReservationRecord = { room, date, start: '00:00', end: '00:01', seats: 1 };
  const names = new Set([room]);
  const follows = async (name: string) => {
    names.add(name);
    return controls.display({ ...original, room: name }, [
      ...originals,
      ...[...names].map((room) => ({ ...original, room })),
    ]);
  };
  if (await follows(room)) throw new Error('Room relation key already displayed');
  await scope.apply(
    date,
    async () => {
      await controls.reload();
      const present: string[] = [];
      for (const name of names) if (await follows(name)) present.push(name);
      if (!present.length) return;
      if (present.length !== 1) throw new Error('Ambiguous owned room relation');
      const deletion = await recordCandidates(
        ctx,
        'delete',
        'reservation|booking',
        date,
        originals.map((value) => value.date),
      );
      if (!(await deletion.count())) throw new Error('Missing owned room relation deletion');
      await deletion.first().click();
      await controls.reload();
      for (const name of names)
        if (await follows(name)) throw new Error('Owned room relation survived cleanup');
    },
    async () => {
      await controls.create(original);
      await controls.reload();
      if (!(await follows(room))) throw new Error('Owned room relation was not persisted');
    },
  );
  return { follows };
}

export async function editReservationRecord(
  ctx: JudgeContext,
  target: ReservationRecord,
  controls: ReservationRecordControls,
): Promise<void> {
  const candidates = await workflowCandidates(ctx, 'edit', 'reservation|booking');
  const originals: ReservationRecord[] = [];
  for (const action of await candidates.all()) {
    const value = await controls.load(action);
    if (value.date) originals.push(value);
  }
  const captions = [...new Set(await Promise.all((await candidates.all()).map(actionName)))];
  for (const caption of captions) {
    const current = () =>
      workflowCandidates(ctx, 'edit', 'reservation|booking').then((choices) =>
        choices.and(namedActions(ctx, caption)),
      );
    const bound = await (await current()).count();
    for (let index = 0; index < bound; index++) {
      const action = (await current()).nth(index);
      if (!(await action.count())) continue;
      const original = await controls.load(action);
      if (reservationKey(original) !== reservationKey(target)) continue;
      const update = await withRecordObservation((scope) =>
        witnessReservation(ctx, controls, scope, caption, original, originals),
      );
      if (!update) continue;
      for (const confirmed of await (await current()).all()) {
        if (reservationKey(await controls.load(confirmed)) === reservationKey(target)) return;
      }
      throw new Error('Confirmed reservation action changed its target');
    }
  }
  throw new Error(`Missing confirmed reservation edit: ${reservationKey(target)}`);
}
