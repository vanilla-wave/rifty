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

/** RFC4180 field decoding; exported LF/CRLF records, optional header/quoting. */
export function csvExportMatches(text: string, expected: readonly (readonly string[])[]): boolean {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) return false;
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (closed && c !== ',' && c !== '\r' && c !== '\n' && c !== undefined) return false;
    if (c === '"') {
      if (value.length || closed) return false;
      quoted = true;
    } else if (c === ',') {
      row.push(value);
      value = '';
      closed = false;
    } else if (c === '\r' || c === '\n' || c === undefined) {
      if (c === undefined && !row.length && !value.length && !closed) break;
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      closed = false;
    } else value += c;
  }
  if (rows[0]?.length === 2 && rows[0][0] === 'name' && rows[0][1] === 'email') rows.shift();
  return JSON.stringify(rows) === JSON.stringify(expected);
}

/** Visible text and live field values cover accessible output without choosing a caption/DOM. */
export async function outputTexts(ctx: JudgeContext): Promise<string[]> {
  const { view } = ctx;
  const values: string[] = [];
  for (const candidate of await field(ctx, /.*/).all())
    if (await candidate.isVisible()) values.push(await fieldValue(candidate));
  const texts = await view.locator('*').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          node.getClientRects().length > 0
        );
      })
      .map((node) => (node instanceof HTMLElement ? node.innerText : (node.textContent ?? ''))),
  );
  return [...new Set([...values, ...texts])].filter(Boolean);
}
