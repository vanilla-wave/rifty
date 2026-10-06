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
export function namedActions({ view }: JudgeContext, name: string | RegExp) {
  return view
    .getByRole('button', { name, exact: typeof name === 'string' })
    .or(view.getByRole('link', { name, exact: typeof name === 'string' }));
}
export function action(ctx: JudgeContext, name: string | RegExp) {
  return namedActions(ctx, name).first();
}

/** Read rendered output; hidden descendants and editable source are not proof. */
export async function renderedValue(output: Locator): Promise<string> {
  if (!(await output.isVisible())) throw new Error('Output is hidden');
  return output.evaluate((node) => {
    if (
      !(node instanceof HTMLElement) ||
      node.matches(':read-write') ||
      node instanceof HTMLSelectElement
    )
      throw new Error('Missing read-only rendered output');
    return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
      ? node.value
      : node.innerText;
  });
}

export function field({ view }: JudgeContext, name: string | RegExp) {
  return view
    .getByRole('textbox', { name })
    .or(view.getByRole('searchbox', { name }))
    .or(view.getByRole('combobox', { name }));
}

/** Editing selects controls, even when read-only outputs share their purpose. */
const editableControls =
  'input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),select:not([disabled]),[contenteditable="true"],[role="combobox"]:not([aria-disabled="true"]):not([aria-readonly="true"])';
export function editableControl({ view }: JudgeContext, name: string | RegExp) {
  return view.getByLabel(name).and(view.locator(editableControls));
}

const escapeCaption = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function caption(name: string): RegExp {
  return new RegExp(`\\b${escapeCaption(name)}\\b`, 'i');
}

/** Display context is open; missing or ambiguous semantic choices are errors. */
export async function choiceOption(scope: JudgeContext['view'] | Locator, name: string) {
  const options = scope.getByRole('option', { name: caption(name) });
  if ((await options.count()) !== 1) throw new Error(`Missing/ambiguous choice: ${name}`);
  return options;
}

export async function selectChoices(field: Locator, names: readonly string[]) {
  const indices = [];
  for (const name of names) {
    const options = await choiceOption(field, name);
    indices.push(await options.evaluate((node) => (node as HTMLOptionElement).index));
  }
  await field.selectOption(indices.map((index) => ({ index })));
}

export async function selectedChoice(field: Locator, identities: readonly string[]) {
  const label = await field.evaluate((node) => {
    const option = (node as HTMLSelectElement).selectedOptions[0];
    return option?.getAttribute('aria-label') ?? option?.label ?? '';
  });
  const matches = identities.filter((name) => caption(name).test(label));
  if (matches.length !== 1) throw new Error(`Missing/ambiguous selected identity: ${label}`);
  return matches[0]!;
}

/** Named action meaning is independent of caption word order. */
export function actionCaption(verbs: string, subjects: string, identity?: string): RegExp {
  const words = [verbs.split('|'), subjects.split('|'), ...(identity ? [[identity]] : [])];
  return new RegExp(
    words.map((group) => `(?=.*\\b(?:${group.map(escapeCaption).join('|')})\\b)`).join(''),
    'i',
  );
}

function primaryPurpose(words: readonly string[], others: readonly string[]): string {
  const exclude = others.map(escapeCaption).join('|');
  const prefix = exclude ? `^(?:(?!\\b(?:${exclude})\\b).)*` : '^.*';
  return `${prefix}\\b(?:${words.map(escapeCaption).join('|')})\\b`;
}

/** Primary domain purpose distinguishes source/search descriptions from row/editor fields. */
function purposePattern(name: string, namespace: Readonly<Record<string, readonly string[]>>) {
  const own = namespace[name];
  if (!own?.length) throw new Error(`Unknown field purpose: ${name}`);
  const others = Object.entries(namespace)
    .filter(([key]) => key !== name)
    .flatMap(([, words]) => words);
  return new RegExp(primaryPurpose(own, others), 'i');
}

export function describedField(
  ctx: JudgeContext,
  name: string,
  namespace: Readonly<Record<string, readonly string[]>>,
) {
  return field(ctx, purposePattern(name, namespace)).and(ctx.view.locator(':read-write'));
}

export function describedEditableControl(
  ctx: JudgeContext,
  name: string,
  namespace: Readonly<Record<string, readonly string[]>>,
) {
  const purpose = purposePattern(name, namespace);
  return field(ctx, purpose)
    .or(ctx.view.getByRole('listbox', { name: purpose }))
    .or(ctx.view.getByRole('spinbutton', { name: purpose }))
    .and(ctx.view.locator(editableControls));
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

/** Current note identity uses visible caption components; legacy versions retain savedEntry. */
export async function savedNoteEntry(
  ctx: JudgeContext,
  title: string,
  otherTitles: readonly string[] = [],
) {
  const actions = namedActions(ctx, new RegExp(escapeCaption(title), 'i'));
  const exact = namedActions(ctx, new RegExp(`^${escapeCaption(title)}$`, 'i'));
  const legacy = savedEntry(ctx, title, otherTitles);
  const identities = [title, ...otherTitles, 'Delete', 'Remove'];
  let result = actions.and(ctx.view.locator(':not(*)'));
  for (const candidate of await actions.all()) {
    if ((await candidate.and(exact).count()) > 0) {
      result = result.or(candidate);
      continue;
    }
    const identity = await candidate.evaluate((node, identities) => {
      const explicitLabel = (node.getAttribute('aria-label') ?? '').trim().toLocaleLowerCase();
      const explicit = identities.findIndex((name) => name.toLocaleLowerCase() === explicitLabel);
      if (explicit >= 0) return explicit;
      const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let primary = -1;
      let deletion = false;
      let current: Node | null = node;
      while (current) {
        const element = current instanceof HTMLElement ? current : current.parentElement;
        if (element && !element.closest('input,textarea,[contenteditable],script,style')) {
          let visible = true;
          for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (
              parent.hidden ||
              parent.getAttribute('aria-hidden') === 'true' ||
              style.display === 'none' ||
              style.visibility === 'hidden'
            ) {
              visible = false;
              break;
            }
          }
          if (visible) {
            const text =
              current instanceof HTMLElement ? current.innerText : (current.nodeValue ?? '');
            const found = identities.findIndex(
              (name) => name.toLocaleLowerCase() === text.trim().toLocaleLowerCase(),
            );
            if (found >= identities.length - 2) deletion = true;
            else if (found >= 0 && primary < 0) primary = found;
          }
        }
        current = walker.nextNode();
      }
      return deletion ? identities.length - 1 : primary;
    }, identities);
    if (identity === 0 || (identity < 0 && (await candidate.and(legacy).count()) > 0))
      result = result.or(candidate);
  }
  return result;
}

export function wikiNoteTarget(ctx: JudgeContext, target: string, current: string) {
  return savedNoteEntry(ctx, target, current && current !== target ? [current] : []);
}

/** RFC4180 field decoding; exported LF/CRLF records, optional header/quoting. */
export function csvExportMatches(
  text: string,
  expected: readonly (readonly string[])[],
  unordered = false,
): boolean {
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
  if (unordered) {
    const keys = (records: readonly (readonly string[])[]) =>
      records.map((record) => JSON.stringify(record)).sort();
    return JSON.stringify(keys(rows)) === JSON.stringify(keys(expected));
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
