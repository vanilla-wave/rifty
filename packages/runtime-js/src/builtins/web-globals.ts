/**
 * Web/CJS globals Node exposes on the global object that aren't a built-in
 * module: currently the `global` self-alias (`global === globalThis`, v12). It's
 * the highest-reach single unblock — CJS `global.X` / `typeof global !==
 * 'undefined'` is baked into process-polyfills, webpack-shimmed bundles, and
 * jest-style libs, all of which ReferenceError without it.
 *
 * (Node v24 does NOT expose a global `scheduler` — `require('node:timers/
 * promises').scheduler` is the only surface — so we deliberately do not install
 * one; doing so would diverge from real Node.)
 */

/** Install the `global` self-alias on `target` (defaults to the realm global). */
export function installWebGlobals(target: Record<string, unknown> = globalThis): void {
  target.global = target;
}
