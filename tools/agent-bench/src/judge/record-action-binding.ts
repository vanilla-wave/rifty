import type { Locator } from '@playwright/test';
import { actionName, namedActions, workflowCandidates } from './context.ts';
import type { JudgeContext } from './context.ts';
import type { PublicRecordValue } from './public-record-display.ts';
import { publicReadOnlyText, publicRecordValuePattern } from './public-record-display.ts';

/** Requery a causally observed actor's literal caption; loaded data still verifies its target. */
export async function observedRecordActions(
  ctx: JudgeContext,
  verbs: string,
  subjects: string,
  observedCaption: string,
  originalValue: string,
  temporaryValue: string,
): Promise<Locator> {
  let result = ctx.view.locator('xpath=//*[false()]');
  for (const action of await (await workflowCandidates(ctx, verbs, subjects)).all()) {
    const current = await actionName(action);
    if (current.replaceAll(temporaryValue, originalValue) === observedCaption)
      result = result.or(namedActions(ctx, current));
  }
  return result.and(await workflowCandidates(ctx, verbs, subjects));
}

/** Already-confirmed domain keys narrow an intended action; query itself grants no savedness. */
export async function recordKeyActions(
  ctx: JudgeContext,
  verbs: string,
  subjects: string,
  key: readonly PublicRecordValue[],
  otherKeys: readonly (readonly PublicRecordValue[])[],
): Promise<Locator> {
  const matches = (text: string, values: readonly PublicRecordValue[]) =>
    values.every((value) => publicRecordValuePattern(value).test(text));
  let result = ctx.view.locator('xpath=//*[false()]');
  for (const action of await (await workflowCandidates(ctx, verbs, subjects)).all()) {
    const name = await actionName(action);
    if (
      matches(name, key) &&
      !otherKeys.some((other) => matches(name, other.slice(0, key.length)))
    ) {
      result = result.or(action);
      continue;
    }
    for (const scope of (await action.locator('xpath=ancestor::*').all()).reverse()) {
      const text = await publicReadOnlyText(scope);
      if (!matches(text, key)) continue;
      if (!otherKeys.some((other) => matches(text, other))) result = result.or(action);
      break;
    }
  }
  return result;
}

/** Caption-group ordinals survive unrelated controls appearing between caller-owned loads. */
export async function* recordActorCandidates(
  ctx: JudgeContext,
  verbs: string,
  subjects: string,
): AsyncGenerator<Locator> {
  const initial = await workflowCandidates(ctx, verbs, subjects);
  const captions = [...new Set(await Promise.all((await initial.all()).map(actionName)))];
  const groups = await Promise.all(
    captions.map(async (caption) => ({
      caption,
      count: await initial.and(namedActions(ctx, caption)).count(),
    })),
  );
  for (const group of groups)
    for (let index = 0; index < group.count; index++) {
      const current = (await workflowCandidates(ctx, verbs, subjects)).and(
        namedActions(ctx, group.caption),
      );
      if (index < (await current.count())) yield current.nth(index);
    }
}
