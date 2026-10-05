import type { Frame, Locator, Page } from '@playwright/test';
export interface JudgeContext {
  view: Frame | Page;
  previewUrl: string;
}
export interface JudgeProbe {
  name: string;
  pass: boolean;
  evidence: unknown;
}
export interface JudgeVerdict {
  pass: boolean;
  probes: JudgeProbe[];
}
export type TaskJudge = (context: JudgeContext) => Promise<JudgeVerdict>;
export function verdict(probes: JudgeProbe[]): JudgeVerdict {
  return { pass: probes.length > 0 && probes.every((probe) => probe.pass), probes };
}
export async function issues({ view }: JudgeContext) {
  await view.getByRole('link', { name: 'Issues', exact: true }).click();
  await view.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
}
export async function ids({ view }: JudgeContext): Promise<number[]> {
  return view
    .locator('.issue-card')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        Number(node.querySelector('.issue-card__id')?.textContent?.replace('#', '')),
      ),
    );
}

/** Read an accessible editable control without prescribing input/textarea DOM. */
export async function fieldValue(field: Locator): Promise<string> {
  return field.evaluate((node) =>
    node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
      ? node.value
      : (node.textContent ?? ''),
  );
}
export function action({ view }: JudgeContext, name: string | RegExp) {
  return view
    .getByRole('button', { name, exact: typeof name === 'string' })
    .or(view.getByRole('link', { name, exact: typeof name === 'string' }))
    .first();
}

export function field({ view }: JudgeContext, name: string | RegExp) {
  return view
    .getByRole('textbox', { name })
    .or(view.getByRole('searchbox', { name }))
    .or(view.getByRole('combobox', { name }));
}
