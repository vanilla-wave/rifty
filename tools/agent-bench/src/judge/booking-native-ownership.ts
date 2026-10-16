import type { Locator } from '@playwright/test';
import { actionName, workflowAction, workflowActions } from './context.ts';
import type { JudgeContext } from './context.ts';

/** Native form association outranks a farther caption containing another domain. */
export async function bookingWorkflowAction(
  ctx: JudgeContext,
  subjects: string,
  creation: boolean,
  purpose: Locator,
): Promise<Locator> {
  const fields = [];
  for (const field of await purpose.all())
    if (await field.isVisible()) {
      const handle = await field.elementHandle();
      if (handle) fields.push(handle);
    }
  try {
    type Choice = { action: Locator; fields: number[]; caption: string };
    const owned = { update: [] as Choice[], add: [] as Choice[] };
    for (const [kind, verbs] of [
      ['update', 'save|update'],
      ['add', 'add|create'],
    ] as const)
      for (const action of await (await workflowActions(ctx, verbs, subjects)).all()) {
        if (!(await action.isVisible())) continue;
        const associated = await action.evaluate((node, fields) => {
          const form =
            node instanceof HTMLButtonElement || node instanceof HTMLInputElement
              ? node.form
              : node.closest('form');
          return fields.flatMap((field, index) => {
            const owner =
              field instanceof HTMLInputElement ||
              field instanceof HTMLTextAreaElement ||
              field instanceof HTMLSelectElement
                ? field.form
                : field.closest('form');
            return form !== null && owner === form ? [index] : [];
          });
        }, fields);
        if (!associated.length) continue;
        const name = await actionName(action);
        const caption = name
          .replace(new RegExp(`\\b(?:${verbs})\\b\\s*`, 'i'), '')
          .replace(new RegExp(`\\b(?:${subjects})\\b\\s*`, 'i'), '')
          .trim();
        if (
          !owned[kind].some(
            (choice) =>
              choice.caption === caption &&
              associated.some((index) => choice.fields.includes(index)),
          )
        )
          owned[kind].push({ action, fields: associated, caption });
      }
    if (creation && owned.add.length === 1) {
      const commits = owned.update.filter((choice) =>
        choice.fields.some((index) => owned.add[0]!.fields.includes(index)),
      );
      if (commits.length === 1) return commits[0]!.action;
      if (commits.length > 1) throw new Error(`Ambiguous owned ${subjects} commit`);
    }
    if (owned.update.length || owned.add.length) {
      for (const choices of creation ? [owned.add, owned.update] : [owned.update, owned.add]) {
        if (choices.length === 1) return choices[0]!.action;
        if (choices.length > 1) throw new Error(`Ambiguous owned ${subjects} action`);
      }
    }
    return workflowAction(ctx, subjects, creation, purpose);
  } finally {
    await Promise.all(fields.map((field) => field.dispose()));
  }
}
