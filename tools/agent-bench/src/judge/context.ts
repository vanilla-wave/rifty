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
export function editableControl(ctx: JudgeContext, name: string | RegExp) {
  const { view } = ctx;
  // Prefer accessible names over label text that includes control values.
  const labelledEditable = '[contenteditable][aria-label],[contenteditable][aria-labelledby]';
  return field(ctx, name)
    .or(view.getByRole('listbox', { name }))
    .or(view.getByRole('spinbutton', { name }))
    .or(view.getByRole('checkbox', { name }))
    .or(view.getByRole('radio', { name }))
    .or(view.getByRole('slider', { name }))
    .or(view.getByRole('button', { name }))
    .or(view.getByRole('switch', { name }))
    .or(view.getByRole('menuitemcheckbox', { name }))
    .or(view.getByRole('menuitemradio', { name }))
    .or(view.getByRole('option', { name }))
    .or(view.getByRole('gridcell', { name }))
    .or(view.getByRole('link', { name }))
    .or(view.getByRole('menuitem', { name }))
    .or(view.getByRole('separator', { name }))
    .or(view.getByRole('tab', { name }))
    .or(view.getByRole('treeitem', { name }))
    .or(view.getByLabel(name).and(view.locator(labelledEditable)))
    .and(view.locator(editableControls));
}

/** Native form association or closest action context owns the candidate set. */
async function controlsInAction(
  candidates: Locator,
  action: Locator,
  scalar: boolean,
  groups: readonly Locator[] = [],
): Promise<Locator> {
  if ((await action.count()) !== 1) throw new Error('Action context is missing or ambiguous');
  // A shared editor has one control for each observed participant purpose.
  if (
    !scalar &&
    groups.length &&
    (await Promise.all(groups.map((group) => group.count()))).every((count) => count === 1)
  )
    return candidates;
  const form = await action.evaluateHandle((node) =>
    node instanceof HTMLButtonElement || node instanceof HTMLInputElement
      ? node.form
      : node.closest('form'),
  );
  try {
    const indices = await candidates.evaluateAll(
      (nodes, owner) =>
        nodes.flatMap((node, index) => {
          const nativeOwner =
            node instanceof HTMLInputElement ||
            node instanceof HTMLTextAreaElement ||
            node instanceof HTMLSelectElement ||
            node instanceof HTMLButtonElement
              ? node.form
              : node.closest('form');
          return owner && nativeOwner === owner ? [index] : [];
        }),
      form,
    );
    if (scalar ? indices.length === 1 : indices.length > 0) {
      let owned = candidates.nth(indices[0]!);
      for (const index of indices.slice(1)) owned = owned.or(candidates.nth(index));
      return owned;
    }
  } finally {
    await form.dispose();
  }
  const scopes = await action.locator('xpath=ancestor::*').all();
  for (const scope of scopes.reverse()) {
    const contained = candidates.and(scope.locator('*'));
    const count = await contained.count();
    if (scalar ? count === 1 : count > 0) {
      if (
        scalar ||
        (await Promise.all(groups.map((group) => group.and(contained).count()))).every(
          (count) => count === 1,
        )
      )
        return contained;
    }
  }
  throw new Error('Control purpose is missing or ambiguous in the intended action context');
}

/** Scalar observation preserves shared singleton editors and rejects ambiguous sets. */
export async function controlForAction(candidates: Locator, action: Locator): Promise<Locator> {
  if ((await candidates.count()) === 1) return candidates;
  return controlsInAction(candidates, action, true);
}

/** Scope a heterogeneous participant set before selecting its representation or state. */
export async function controlsForAction(
  candidates: Locator,
  action: Locator,
  groups: readonly Locator[],
): Promise<Locator> {
  const observed: Locator[] = [];
  for (const group of groups) if (await group.count()) observed.push(group);
  return controlsInAction(candidates, action, false, observed);
}

export async function editableControlForAction(
  ctx: JudgeContext,
  name: string | RegExp,
  action: Locator,
): Promise<Locator> {
  return controlForAction(editableControl(ctx, name), action);
}

export async function workflowAction(
  ctx: JudgeContext,
  subjects: string,
  creation = false,
  purpose?: Locator,
): Promise<Locator> {
  const update = await workflowActions(ctx, 'save|update', subjects);
  const add = await workflowActions(ctx, 'add|create', subjects);
  const visible = async (choices: Locator, verbs: string) => {
    const verb = `(?:${verbs.split('|').map(escapeCaption).join('|')})`;
    const subject = `(?:${subjects.split('|').map(escapeCaption).join('|')})`;
    const actionVerb = new RegExp(`\\b${verb}\\b\\s*`, 'i');
    const actionSubject = new RegExp(`\\b${subject}\\b\\s*`, 'i');
    const result: Locator[] = [];
    const captions: (string | undefined)[] = [];
    for (const node of await choices.all()) {
      if (!(await node.isVisible())) continue;
      const name = accessibleRoot(await node.ariaSnapshot());
      const caption =
        name === undefined
          ? undefined
          : JSON.stringify(name.replace(actionVerb, '').replace(actionSubject, '').trim());
      let duplicate = -1;
      if (purpose && (await purpose.count()) && caption) {
        for (let index = 0; index < result.length; index++) {
          if (captions[index] !== caption) continue;
          const first = await controlForAction(purpose, result[index]!);
          const second = await controlForAction(purpose, node);
          if (await first.and(second).count()) {
            duplicate = index;
            break;
          }
        }
      }
      if (duplicate >= 0) {
        if (!(await result[duplicate]!.isEnabled()) && (await node.isEnabled()))
          result[duplicate] = node;
      } else {
        result.push(node);
        captions.push(caption);
      }
    }
    return result;
  };
  const updates = await visible(update, 'save|update');
  const additions = await visible(add, 'add|create');
  if (creation && additions.length === 1 && purpose && (await purpose.count())) {
    const creationControl = await controlForAction(purpose, additions[0]!);
    const commits: Locator[] = [];
    for (const candidate of updates) {
      const updateControl = await controlForAction(purpose, candidate);
      if (await creationControl.and(updateControl).count()) commits.push(candidate);
    }
    // Add can open/reset the same editor whose Save commits the filled draft.
    if (commits.length === 1) return commits[0]!;
    if (commits.length > 1) throw new Error(`Ambiguous intended ${subjects} commit`);
  }
  for (const choices of creation ? [additions, updates] : [updates, additions]) {
    if (choices.length === 1) return choices[0]!;
    if (choices.length > 1) throw new Error(`Ambiguous intended ${subjects} action`);
  }
  throw new Error(`Missing intended ${subjects} action`);
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
  const identities = [title, ...otherTitles];
  const boundary = `(?:\\b|(?:${identities.map(escapeCaption).join('|')}))`;
  const destructive = namedActions(ctx, new RegExp(`${boundary}(?:delete|remove)${boundary}`, 'i'));
  let result = actions.and(ctx.view.locator(':not(*)'));
  for (const candidate of await actions.all()) {
    if ((await candidate.and(exact).count()) > 0) {
      result = result.or(candidate);
      continue;
    }
    // Role names preserve descendant ARIA/image captions that innerText omits.
    if ((await candidate.and(destructive).count()) > 0) continue;
    const identity = await candidate.evaluate((node, identities) => {
      const explicitLabel = (node.getAttribute('aria-label') ?? '').trim().toLocaleLowerCase();
      const explicit = identities.findIndex((name) => name.toLocaleLowerCase() === explicitLabel);
      if (explicit >= 0) return explicit;
      const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let primary = -1;
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
            if (found >= 0 && primary < 0) primary = found;
          }
        }
        current = walker.nextNode();
      }
      return primary;
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

function accessibleRoot(snapshot: string): string | undefined {
  const heading = snapshot.split('\n')[0]?.slice(2) ?? '';
  const root = heading.startsWith("'")
    ? heading.slice(1, heading.lastIndexOf("'")).replace(/''/g, "'")
    : heading;
  const quoted = root.match(/^\S+ ("(?:\\.|[^"\\])*")/)?.[1];
  return quoted ? (JSON.parse(quoted) as string) : undefined;
}

/** Declared operation uses its accessible record/collection context. */
export async function workflowActions(
  ctx: JudgeContext,
  verbs: string,
  subjects: string,
  identity?: string,
): Promise<Locator> {
  const requested = new RegExp(
    `(?=.*\\b(?:${verbs.split('|').map(escapeCaption).join('|')})\\b)${identity ? `(?=.*\\b${escapeCaption(identity)}\\b)` : ''}`,
    'i',
  );
  const candidates = namedActions(ctx, requested);
  const subjectWords = subjects
    .split('|')
    .flatMap((word) => [word, word === 'person' ? 'people' : `${word}s`]);
  const domain = new RegExp(`\\b(?:${subjectWords.map(escapeCaption).join('|')})\\b`, 'i');
  const collections = ctx.view
    .getByRole('region', { name: domain })
    .or(ctx.view.getByRole('group', { name: domain }))
    .or(ctx.view.getByRole('form', { name: domain }))
    .or(ctx.view.getByRole('list', { name: domain }))
    .or(ctx.view.getByRole('table', { name: domain }));
  let result = ctx.view.locator('xpath=//*[false()]');
  for (const node of await candidates.all()) {
    if (!(await node.isVisible())) continue;
    const name = accessibleRoot(await node.ariaSnapshot());
    if (name === undefined) throw new Error('Missing computed operation caption');
    const identityText = name
      .replace(
        new RegExp(`\\b(?:${verbs.split('|').map(escapeCaption).join('|')})\\b\\s*`, 'i'),
        '',
      )
      .replace(
        new RegExp(`\\b(?:${subjects.split('|').map(escapeCaption).join('|')})\\b\\s*`, 'i'),
        '',
      )
      .trim();
    const scopes = (await node.locator('xpath=ancestor::*').all()).reverse();
    let record: Locator | undefined;
    if (identityText) {
      const opposite = new RegExp(
        `(?=.*\\b(?:${verbs.includes('delete') ? 'edit' : 'delete'})\\b)(?=.*\\b${escapeCaption(identityText)}\\b)`,
        'i',
      );
      for (const scope of scopes) {
        const local = scope
          .getByRole('button', { name: requested })
          .or(scope.getByRole('link', { name: requested }));
        const complement = scope
          .getByRole('button', { name: opposite })
          .or(scope.getByRole('link', { name: opposite }));
        if ((await complement.count()) && (await local.count()) === 1) {
          record = scope;
          break;
        }
      }
    }
    // Record operations need identity evidence outside their own action caption.
    if (/\b(?:edit|delete)\b/.test(verbs) && !record) {
      if (!identityText) continue;
      for (const scope of scopes) {
        const local = scope
          .getByRole('button', { name: requested })
          .or(scope.getByRole('link', { name: requested }));
        if ((await local.count()) !== 1) continue;
        const text = await scope.evaluate((owner) => {
          const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
          const values: string[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (
              !parent ||
              parent.closest(
                'button,a,input,textarea,select,[contenteditable], [role="button"],[role="link"]',
              )
            )
              continue;
            const style = getComputedStyle(parent);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              !parent.getClientRects().length
            )
              continue;
            values.push(node.textContent ?? '');
          }
          return values.join(' ').replace(/\s+/g, ' ').trim();
        });
        if (new RegExp(`\\b${escapeCaption(identityText)}\\b`, 'i').test(text)) {
          record = scope;
          break;
        }
      }
      if (!record) continue;
    }
    let accepted = actionCaption(verbs, subjects, identity).test(name);
    if (!accepted) {
      for (const scope of scopes) {
        if (await scope.and(collections).count()) {
          accepted = true;
          break;
        }
        const headings = scope.getByRole('heading');
        if ((await headings.count()) === 1 && domain.test(await renderedValue(headings.first()))) {
          accepted = true;
          break;
        }
      }
    }
    if (!accepted) continue;
    const owner = record ?? scopes[0];
    if (!owner) throw new Error('Operation has no observable context');
    result = result.or(
      owner
        .getByRole('button', { name, exact: true })
        .or(owner.getByRole('link', { name, exact: true })),
    );
  }
  return result;
}
