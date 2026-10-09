import { randomUUID } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { actionName, workflowCandidates } from './context.ts';
import type { JudgeContext } from './context.ts';
import { observedRecordActions, recordActorCandidates } from './record-action-binding.ts';
import { recordCandidates } from './record-candidates.ts';
import { withRecordObservation } from './record-observation.ts';
import type { RecordObservation } from './record-observation.ts';

export interface ExpenseRecord {
  description: string;
  amount: string;
}
export interface ExpenseRecordControls {
  load(action: Locator): Promise<ExpenseRecord>;
  write(value: ExpenseRecord): Promise<void>;
  save(): Promise<void>;
  paid(): Promise<number>;
}

function cents(amount: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
    throw new Error(`Invalid observed expense amount: ${amount}`);
  const [whole, fraction = ''] = amount.split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid observed expense cents: ${amount}`);
  return value;
}
const money = (value: number) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;

async function witnessExpense(
  ctx: JudgeContext,
  controls: ExpenseRecordControls,
  scope: RecordObservation,
  original: ExpenseRecord,
  marker: string,
  observedCaption: string,
  others: readonly string[],
): Promise<boolean> {
  const amount = cents(original.amount);
  const step = amount === Number.MAX_SAFE_INTEGER ? -1 : 1;
  const paidBefore = await controls.paid();
  const reload = () => ctx.view.goto(ctx.view.url());
  let delta: number | undefined;
  await scope.apply(
    marker,
    async () => {
      await reload();
      const current = delta ?? (await controls.paid()) - paidBefore;
      if (current === 0) return;
      if (current === step) {
        const choices = (
          await observedRecordActions(
            ctx,
            'edit',
            'expense',
            observedCaption,
            original.description,
            marker,
          )
        ).and(await recordCandidates(ctx, 'edit', 'expense', marker, others));
        let loaded = false;
        for (const action of await choices.all()) {
          if ((await controls.load(action)).description !== marker) continue;
          loaded = true;
          break;
        }
        if (!loaded) throw new Error(`Missing saved temporary expense: ${marker}`);
        await controls.write(original);
        await controls.save();
      } else if (current === amount + step) {
        const choices = await recordCandidates(ctx, 'delete', 'expense', marker, others);
        if (!(await choices.count()))
          throw new Error(`Missing owned temporary expense deletion: ${marker}`);
        await choices.first().click();
      } else throw new Error(`Unsettled temporary expense effect: ${current}`);
      await reload();
      if ((await controls.paid()) !== paidBefore)
        throw new Error(`Temporary expense rollback changed Paid: ${marker}`);
    },
    async () => {
      await controls.write({ description: marker, amount: money(amount + step) });
      await controls.save();
      await reload();
      delta = (await controls.paid()) - paidBefore;
    },
  );
  return delta === step;
}

/** Locate an intended edit through fields AND saved effect, then reopen its literal action. */
export async function editExpenseRecord(
  ctx: JudgeContext,
  description: string,
  controls: ExpenseRecordControls,
): Promise<void> {
  const candidates = await workflowCandidates(ctx, 'edit', 'expense');
  const originals = new Set<string>();
  for await (const action of recordActorCandidates(ctx, 'edit', 'expense')) {
    const value = await controls.load(action);
    if (value.description) originals.add(value.description);
  }
  for await (const action of recordActorCandidates(ctx, 'edit', 'expense')) {
    const observedCaption = await actionName(action);
    const original = await controls.load(action);
    if (original.description !== description) continue;
    const update = await withRecordObservation(async (scope) => {
      const marker = scope.reserve(`Rifty observation ${randomUUID()}`, originals);
      return witnessExpense(ctx, controls, scope, original, marker, observedCaption, [
        ...originals,
      ]);
    });
    if (!update) continue;
    const loaded = await controls.load(action);
    if (loaded.description !== description)
      throw new Error('Confirmed expense action changed its target');
    return;
  }
  throw new Error(`Missing confirmed expense edit: ${description}`);
}

/** Saved description markers distinguish aliases from valid tuple-identical expenses. */
export async function expenseRecords(
  ctx: JudgeContext,
  controls: ExpenseRecordControls,
): Promise<ExpenseRecord[]> {
  return withRecordObservation(async (scope) => {
    const initial = await workflowCandidates(ctx, 'edit', 'expense');
    const bound = await initial.count();
    const originals = new Set<string>();
    for await (const action of recordActorCandidates(ctx, 'edit', 'expense')) {
      const value = await controls.load(action);
      if (value.description) originals.add(value.description);
    }
    const held = new Map<string, ExpenseRecord>();
    const before = await controls.paid();
    for (let round = 0; round <= bound; round++) {
      let discovered = false;
      for await (const action of recordActorCandidates(ctx, 'edit', 'expense')) {
        const observedCaption = await actionName(action);
        const original = await controls.load(action);
        if (!original.description || held.has(original.description)) continue;
        const marker = scope.reserve(`Rifty observation ${randomUUID()}`, originals);
        const update = await witnessExpense(
          ctx,
          controls,
          scope,
          original,
          marker,
          observedCaption,
          [...originals, ...held.keys()],
        );
        if (update) {
          held.set(marker, original);
          discovered = true;
          break;
        }
        await scope.release(marker);
      }
      if (!discovered) break;
      if (round === bound)
        throw new Error('Expense observation exceeded its finite candidate bound');
    }
    const result = [...held.values()];
    // Reverse settlement preserves each recorded baseline while earlier markers remain held.
    for (const marker of [...held.keys()].reverse()) await scope.release(marker);
    if ((await controls.paid()) !== before)
      throw new Error('Expense observation changed original Paid');
    return result;
  });
}
