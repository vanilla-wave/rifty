import { randomUUID } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { actionName, namedActions, workflowCandidates } from './context.ts';
import type { JudgeContext } from './context.ts';
import { observedRecordActions } from './record-action-binding.ts';
import { recordCandidates } from './record-candidates.ts';
import { withRecordObservation } from './record-observation.ts';
import type { RecordObservation } from './record-observation.ts';

export interface RoomRecord {
  name: string;
  capacity: number;
}
export interface RoomRecordControls {
  load(action: Locator): Promise<RoomRecord>;
  write(value: RoomRecord): Promise<void>;
  save(): Promise<void>;
  reload(): Promise<void>;
  labels(): Promise<string[] | null>;
  relation?(
    scope: RecordObservation,
    original: RoomRecord,
  ): Promise<{ follows(name: string): Promise<boolean> }>;
  label(name: string): Promise<string>;
}
const equalLabels = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function witnessRoom(
  ctx: JudgeContext,
  controls: RoomRecordControls,
  scope: RecordObservation,
  original: RoomRecord,
  observedCaption: string,
  forbidden: Iterable<string>,
) {
  const before = await controls.labels();
  const relation = before === null ? await controls.relation?.(scope, original) : undefined;
  if (before === null && !relation) throw new Error('Missing independent room membership witness');
  const originalLabel = before === null ? undefined : await controls.label(original.name);
  if (before === null) {
    const candidates = (await workflowCandidates(ctx, 'edit', 'room')).and(
      namedActions(ctx, observedCaption),
    );
    let loaded = false;
    for (const action of await candidates.all()) {
      if ((await controls.load(action)).name !== original.name) continue;
      loaded = true;
      break;
    }
    if (!loaded) throw new Error('Room relation observation lost its actor');
  }
  const marker = scope.reserve(`Rifty observation ${randomUUID()}`, [...forbidden, original.name]);
  const reload = () => controls.reload();
  const verifyPayload = async (required = true) => {
    const choices = await observedRecordActions(
      ctx,
      'edit',
      'room',
      observedCaption,
      original.name,
      marker,
    );
    let found = false;
    for (const action of await choices.all()) {
      const value = await controls.load(action);
      if (value.name === marker)
        throw new Error(`Temporary room rollback left its name: ${marker}`);
      if (value.name !== original.name) continue;
      if (value.capacity !== original.capacity)
        throw new Error(`Temporary room rollback changed its capacity: ${marker}`);
      found = true;
    }
    if (required && !found)
      throw new Error(`Temporary room rollback lost its original payload: ${marker}`);
  };
  let update = false;
  await scope.apply(
    marker,
    async () => {
      await reload();
      const labels = await controls.labels();
      if (before !== null && labels !== null && equalLabels(labels, before)) {
        await verifyPayload(update);
        return;
      }
      const retained =
        before !== null && labels !== null
          ? labels.includes(originalLabel!)
          : await relation!.follows(original.name);
      if (!retained) {
        const choices = (
          await observedRecordActions(ctx, 'edit', 'room', observedCaption, original.name, marker)
        ).and(await recordCandidates(ctx, 'edit', 'room', marker, before ?? [original.name]));
        let loaded = false;
        for (const action of await choices.all())
          if ((await controls.load(action)).name === marker) {
            loaded = true;
            break;
          }
        if (!loaded) throw new Error(`Missing owned temporary room: ${marker}`);
        await controls.write(original);
        await controls.save();
      } else {
        const choices = await recordCandidates(
          ctx,
          'delete',
          'room',
          marker,
          before ?? [original.name],
        );
        if (!(await choices.count())) {
          if (
            before === null &&
            (await relation!.follows(original.name)) &&
            !(await relation!.follows(marker))
          ) {
            if (update) await verifyPayload();
            return;
          }
          throw new Error(`Missing owned temporary room deletion: ${marker}`);
        }
        await choices.first().click();
      }
      await reload();
      const restored = await controls.labels();
      if (
        before !== null
          ? restored === null || !equalLabels(restored, before)
          : !(await relation!.follows(original.name)) || (await relation!.follows(marker))
      )
        throw new Error(`Temporary room rollback changed membership: ${marker}`);
      if (update) await verifyPayload();
    },
    async () => {
      await controls.write({ ...original, name: marker });
      await controls.save();
      await reload();
      const labels = await controls.labels();
      if (before === null)
        update = (await relation!.follows(marker)) && !(await relation!.follows(original.name));
      else {
        if (labels === null) throw new Error('Room membership reader changed');
        const markedLabel = await controls.label(marker);
        update =
          labels.includes(markedLabel) &&
          !labels.includes(originalLabel!) &&
          labels.length === before.length;
      }
    },
  );
  await scope.release(marker);
  return update;
}

/** Public unique room names identify records; picker membership independently proves Update. */
export async function roomRecords(
  ctx: JudgeContext,
  controls: RoomRecordControls,
): Promise<RoomRecord[]> {
  return withRecordObservation(async (scope) => {
    const result = new Map<string, RoomRecord>();
    const candidates = await workflowCandidates(ctx, 'edit', 'room');
    const names = [...new Set(await Promise.all((await candidates.all()).map(actionName)))];
    for (const caption of names) {
      const bound = await (await workflowCandidates(ctx, 'edit', 'room'))
        .and(namedActions(ctx, caption))
        .count();
      let index = 0;
      for (
        let attempt = 0;
        attempt <= bound &&
        index <
          (await (
            await workflowCandidates(ctx, 'edit', 'room')
          )
            .and(namedActions(ctx, caption))
            .count());
        attempt++
      ) {
        const current = (await workflowCandidates(ctx, 'edit', 'room')).and(
          namedActions(ctx, caption),
        );
        const count = await current.count();
        const original = await controls.load(current.nth(index));
        if (!original.name) {
          if (
            (await (
              await workflowCandidates(ctx, 'edit', 'room')
            )
              .and(namedActions(ctx, caption))
              .count()) >= count
          )
            index++;
          continue;
        }
        if (!Number.isSafeInteger(original.capacity) || original.capacity <= 0)
          throw new Error('Invalid observed room capacity');
        if (
          await witnessRoom(
            ctx,
            controls,
            scope,
            original,
            caption,
            [...result.values()].map((value) => value.name),
          )
        ) {
          const key = original.name.toLowerCase();
          const prior = result.get(key);
          if (prior && (prior.name !== original.name || prior.capacity !== original.capacity))
            throw new Error('Conflicting observed room identity');
          result.set(key, original);
        }
        index++;
      }
    }
    return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function editRoomRecord(
  ctx: JudgeContext,
  name: string,
  controls: RoomRecordControls,
): Promise<void> {
  const candidates = await workflowCandidates(ctx, 'edit', 'room');
  const names = [...new Set(await Promise.all((await candidates.all()).map(actionName)))];
  for (const caption of names) {
    const current = () =>
      workflowCandidates(ctx, 'edit', 'room').then((choices) =>
        choices.and(namedActions(ctx, caption)),
      );
    const bound = await (await current()).count();
    let index = 0;
    for (
      let attempt = 0;
      attempt <= bound && index < (await (await current()).count());
      attempt++
    ) {
      const count = await (await current()).count();
      const action = (await current()).nth(index);
      const original = await controls.load(action);
      if (original.name !== name) {
        if ((await (await current()).count()) >= count) index++;
        continue;
      }
      const update = await withRecordObservation((scope) =>
        witnessRoom(ctx, controls, scope, original, caption, [name]),
      );
      if (!update) {
        index++;
        continue;
      }
      if ((await controls.load((await current()).nth(index))).name !== name)
        throw new Error('Confirmed room action changed its target');
      return;
    }
  }
  throw new Error(`Missing confirmed room edit: ${name}`);
}
