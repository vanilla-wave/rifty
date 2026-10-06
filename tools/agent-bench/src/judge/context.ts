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

function primaryPurpose(words: readonly string[], others: readonly string[]): string {
  const exclude = others.map(escapeCaption).join('|');
  const prefix = exclude ? `^(?:(?!\\b(?:${exclude})\\b).)*` : '^.*';
  return `${prefix}\\b(?:${words.map(escapeCaption).join('|')})\\b`;
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
    .flatMap(([, words]) => words);
  return field(ctx, new RegExp(primaryPurpose(own, others), 'i')).and(
    ctx.view.locator(':read-write'),
  );
}

export function savedEntry(
  { view }: JudgeContext,
  title: string,
  otherTitles: readonly string[] = [],
) {
  const name = new RegExp(
    `^(?!.*\\b(?:delete|remove)\\b)${primaryPurpose([title], otherTitles).slice(1)}`,
    'i',
  );
  return view.getByRole('button', { name }).or(view.getByRole('link', { name }));
}

async function renderedCandidates(ctx: JudgeContext, text: string, exact: boolean) {
  const candidates: Locator[] = [];
  for (const node of await ctx.view.getByText(text, { exact }).all()) {
    if (
      (await node.isVisible()) &&
      (await node.evaluate(
        (element, { text, exact }) => {
          if (
            !(element instanceof HTMLElement) ||
            element.closest(
              'input,textarea,[contenteditable="true"],[role="textbox"],[role="searchbox"],[role="combobox"],script,style',
            )
          )
            return false;
          const visible = element.innerText.replace(/\s+/g, ' ').trim();
          const expected = text.replace(/\s+/g, ' ').trim();
          return exact ? visible === expected : visible.includes(expected);
        },
        { text, exact },
      ))
    )
      candidates.push(node);
  }
  return candidates;
}

/** Literal preview content may share a paragraph; editor source is not rendering proof. */
export async function renderedText(ctx: JudgeContext, text: string): Promise<boolean> {
  return (await renderedCandidates(ctx, text, false)).length > 0;
}

export async function renderedBold(ctx: JudgeContext, text: string): Promise<boolean> {
  for (const node of await renderedCandidates(ctx, text, true))
    if (
      await node.evaluate((element) => Number.parseInt(getComputedStyle(element).fontWeight) >= 600)
    )
      return true;
  return false;
}

/** Target caption before current title distinguishes Wiki actions from saved-entry excerpts. */
export function noteTarget(ctx: JudgeContext, target: string, current: string) {
  return savedEntry(ctx, target, current && current !== target ? [current] : []);
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
  const headers = rows[0]?.map((label) => {
    if (label.includes('@')) return undefined;
    const name = /\bname\b/i.test(label);
    const email = /\b(?:email|e-mail)\b/i.test(label);
    return name && !email ? 'name' : email && !name ? 'email' : undefined;
  });
  if (headers?.length === 2 && headers.includes('name') && headers.includes('email')) {
    rows.shift();
    if (rows.some((record) => record.length !== 2)) return false;
    const name = headers.indexOf('name');
    const email = headers.indexOf('email');
    for (let i = 0; i < rows.length; i++) rows[i] = [rows[i]![name]!, rows[i]![email]!];
  }
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
