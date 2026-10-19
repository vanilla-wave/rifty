/**
 * Node global alias and JS Fetch classes (ADR-0541).
 *
 * (Node v24 does NOT expose a global `scheduler` — `require('node:timers/
 * promises').scheduler` is the only surface — so we deliberately do not install
 * one; doing so would diverge from real Node.)
 */

import { installNodeFetch } from './fetch/install.ts';

/** Install the Node global alias and Fetch classes before guest entry. */
export function installWebGlobals(target: Record<string, unknown> = globalThis): void {
  target.global = target;
  if (typeof target.fetch === 'function') installNodeFetch(target as { fetch: typeof fetch });
}
