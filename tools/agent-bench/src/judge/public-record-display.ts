import type { Locator } from '@playwright/test';
import type { JudgeContext } from './context.ts';

/** Browser-side read-only output projection, independent of editable values/action captions. */
function readOnlyScopes(root: Element) {
  const textByOwner = new Map<Element, string[]>();
  const outputs: { element: Element; value: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest(
        'button,a,input,textarea,select,script,style,[contenteditable],[role="button"],[role="link"]',
      )
    )
      continue;
    const style = getComputedStyle(parent);
    const range = document.createRange();
    range.selectNode(node);
    if (style.display !== 'none' && style.visibility !== 'hidden' && range.getClientRects().length)
      outputs.push({ element: parent, value: node.textContent ?? '' });
  }
  for (const input of root.querySelectorAll('input,textarea,select')) {
    const style = getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden' || !input.getClientRects().length)
      continue;
    if (
      input instanceof HTMLInputElement &&
      (input.readOnly || input.disabled) &&
      ['text', 'number', 'date', 'time'].includes(input.type)
    )
      outputs.push({ element: input, value: input.value });
    if (input instanceof HTMLTextAreaElement && (input.readOnly || input.disabled))
      outputs.push({ element: input, value: input.value });
    if (input instanceof HTMLSelectElement && input.disabled)
      outputs.push({
        element: input,
        value: [...input.selectedOptions].map((option) => option.label).join(' '),
      });
  }
  for (const output of outputs) {
    for (let owner: Element | null = output.element; owner; owner = owner.parentElement) {
      const text = textByOwner.get(owner) ?? [];
      text.push(output.value);
      textByOwner.set(owner, text);
      if (owner === root) break;
    }
  }
  return [...textByOwner].map(([owner, parts]) => {
    let rect = owner.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      const range = document.createRange();
      range.selectNodeContents(owner);
      rect = range.getBoundingClientRect();
    }
    return {
      text: parts.join(' '),
      root: owner === root,
      top: rect.top,
      left: rect.left,
      area: rect.width * rect.height,
    };
  });
}

export type PublicRecordValue = string | { calendarDate: string };

/** Calendar output may use a display format; names remain literal data. */
export function publicRecordValuePattern(value: PublicRecordValue): RegExp {
  const text = typeof value === 'string' ? value : value.calendarDate;
  const representations = new Set([text]);
  if (typeof value !== 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Invalid observed calendar date');
    const [year, month, day] = text.split('-');
    for (const separator of ['/', '.', '-']) {
      representations.add(`${day}${separator}${month}${separator}${year}`);
      representations.add(`${month}${separator}${day}${separator}${year}`);
      representations.add(`${Number(day)}${separator}${Number(month)}${separator}${year}`);
      representations.add(`${Number(month)}${separator}${Number(day)}${separator}${year}`);
    }
    representations.add(`${year}/${month}/${day}`);
    const date = new Date(`${text}T12:00:00Z`);
    for (const locale of ['en-US', 'en-GB'])
      for (const month of ['long', 'short'] as const)
        representations.add(
          date.toLocaleDateString(locale, {
            year: 'numeric',
            month,
            day: 'numeric',
            timeZone: 'UTC',
          }),
        );
  }
  const alternatives = [...representations].map((text) => {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `${/^\w/.test(text) ? '\\b' : ''}${escaped}${/\w$/.test(text) ? '\\b' : ''}`;
  });
  return new RegExp(`(?:${alternatives.join('|')})`, typeof value === 'string' ? undefined : 'i');
}
const matches = (text: string, values: readonly PublicRecordValue[]) =>
  values.every((value) => publicRecordValuePattern(value).test(text));
export async function publicReadOnlyText(scope: Locator): Promise<string> {
  return (await scope.evaluate(readOnlyScopes)).find((value) => value.root)?.text ?? '';
}
export async function publicRecordDisplay(
  ctx: JudgeContext,
  values: readonly PublicRecordValue[],
  excludedValues: readonly PublicRecordValue[],
): Promise<boolean> {
  return (await ctx.view.locator('body').evaluate(readOnlyScopes)).some(
    (scope) =>
      matches(scope.text, values) &&
      !excludedValues.some((value) => publicRecordValuePattern(value).test(scope.text)),
  );
}

/** Confirm visible chronology independently of action ordering; equal date/start order stays open. */
export async function publicRecordOrder(
  ctx: JudgeContext,
  values: readonly (readonly PublicRecordValue[])[],
): Promise<number[]> {
  const scopes = await ctx.view.locator('body').evaluate(readOnlyScopes);
  const positions = values.map((record, index) => {
    const candidates = scopes.filter(
      (scope) =>
        matches(scope.text, record) &&
        !values.some((other, otherIndex) => otherIndex !== index && matches(scope.text, other)),
    );
    candidates.sort((a, b) => a.area - b.area || a.text.length - b.text.length);
    const position = candidates[0];
    if (!position) throw new Error('Missing independent displayed record position');
    return { index, ...position };
  });
  return positions
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((position) => position.index);
}
