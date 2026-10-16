import type { Locator } from '@playwright/test';

/** Caption matching and record-context resolution shared by the workflow discovery APIs. */

export const escapeCaption = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function caption(name: string): RegExp {
  return new RegExp(
    `${/^\w/.test(name) ? '\\b' : ''}${escapeCaption(name)}${/\w$/.test(name) ? '\\b' : ''}`,
    'i',
  );
}

/** An editor's Cancel names its edit target; literal record identities are not verbs. */
export async function cancellationAction(
  action: Locator,
  name: string,
  verbs: string,
): Promise<boolean> {
  if (verbs.split('|').includes('cancel') || !/^\W*cancel\b/i.test(name)) return false;
  const visible = await action.evaluate((node) =>
    node instanceof HTMLElement ? node.innerText : (node.textContent ?? ''),
  );
  return /^\W*cancel\b/i.test(visible.trim());
}

/** Nearest ancestor owning exactly one requested action plus identity text outside any action caption. */
export async function recordScopeByIdentity(
  node: Locator,
  requested: RegExp,
  identityEvidence: RegExp | undefined,
): Promise<Locator | undefined> {
  if (!identityEvidence) return undefined;
  for (const scope of (await node.locator('xpath=ancestor::*').all()).reverse()) {
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
    if (identityEvidence.test(text)) return scope;
  }
  return undefined;
}
