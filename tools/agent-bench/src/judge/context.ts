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

const escapeCaption = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function caption(name: string): RegExp {
  return new RegExp(`\\b${escapeCaption(name)}\\b`, 'i');
}

/** Primary domain purpose distinguishes source/search descriptions from row/editor fields. */
export function describedField(
  ctx: JudgeContext,
  name: string,
  namespace: Readonly<Record<string, readonly string[]>>,
) {
  const own = namespace[name];
  if (!own?.length) throw new Error(`Unknown field purpose: ${name}`);
  const others = Object.entries(namespace)
    .filter(([key]) => key !== name)
    .flatMap(([, words]) => words)
    .map(escapeCaption);
  const prefix = others.length ? `^(?:(?!\\b(?:${others.join('|')})\\b).)*` : '';
  const token = own.map(escapeCaption).join('|');
  return field(ctx, new RegExp(`${prefix}\\b(?:${token})\\b`, 'i')).and(
    ctx.view.locator(':read-write'),
  );
}

export function savedEntry({ view }: JudgeContext, title: string) {
  const name = new RegExp(`^(?!.*\\b(?:delete|remove)\\b).*\\b${escapeCaption(title)}\\b`, 'i');
  return view.getByRole('button', { name }).or(view.getByRole('link', { name }));
}
